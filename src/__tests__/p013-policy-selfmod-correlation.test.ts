import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AbosTool, ToolContext } from "../types.js";
import { createDatabase } from "../state/database.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { executeTool } from "../agent/tools.js";
import {
  createSelfModTransaction,
  transitionSelfModTransaction,
} from "../self-mod/transaction.js";
import { getEvidenceByCorrelation } from "../observability/evidence.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function dbForTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p013-correlation-"));
  roots.push(root);
  return createDatabase(path.join(root, "state.db"));
}

describe("P-013 policy -> tool -> self-mod correlation", () => {
  it("reconstructs one protected self-mod execution across canonical authorities", async () => {
    const db = dbForTest();
    const policy = new PolicyEngine(db.raw, []);
    let transactionId = "";

    const tool: AbosTool = {
      name: "self_mod_probe",
      description: "test-only self-mod correlation probe",
      parameters: { type: "object", properties: {} },
      riskLevel: "safe",
      category: "self_mod",
      execute: async (_args, context) => {
        const transaction = createSelfModTransaction(context.db.raw, {
          operation: "correlation_probe",
          baseSha: "probe-base-sha",
        });
        transactionId = transaction.id;
        transitionSelfModTransaction(context.db.raw, transaction.id, "failed", {
          error: "intentional probe terminal state",
        });
        return transaction.id;
      },
    };

    const context = {
      identity: { sandboxId: "" },
      config: { creatorAddress: "0x0000000000000000000000000000000000000001" },
      db,
      conway: {},
      inference: {},
    } as unknown as ToolContext;

    const result = await executeTool(
      tool.name,
      {},
      [tool],
      context,
      policy,
      {
        inputSource: "system",
        correlationId: "turn:turn-p013",
        turnId: "turn-p013",
        toolCallId: "tool-call-p013",
        turnToolCallCount: 0,
      },
    );

    expect(result.error).toBeUndefined();
    expect(transactionId).not.toBe("");

    const policyRow = db.raw.prepare(
      "SELECT id, turn_id, execution_state FROM policy_decisions ORDER BY created_at DESC LIMIT 1",
    ).get() as { id: string; turn_id: string | null; execution_state: string };
    expect(policyRow.turn_id).toBe("turn-p013");
    expect(policyRow.execution_state).toBe("succeeded");

    const events = getEvidenceByCorrelation(db.raw, "turn:turn-p013");
    expect(events.map((event) => event.eventType)).toEqual([
      "policy.decision_persisted",
      "policy.execution_running",
      "self_mod.proposed",
      "self_mod.failed",
      "policy.execution_succeeded",
    ]);
    expect(events.every((event) => event.turnId === "turn-p013")).toBe(true);
    expect(events.every((event) => event.toolCallId === "tool-call-p013")).toBe(true);

    const policyEvents = events.filter((event) => event.authorityType === "policy_decision");
    expect(policyEvents.every((event) => event.authorityId === policyRow.id)).toBe(true);

    const selfModEvents = events.filter((event) => event.authorityType === "self_mod_transaction");
    expect(selfModEvents).toHaveLength(2);
    expect(selfModEvents.every((event) => event.authorityId === transactionId)).toBe(true);

    db.close();
  });
});
