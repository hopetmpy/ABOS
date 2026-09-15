import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase, inferenceGetSessionCosts } from "../state/database.js";
import { ModelRegistry } from "../inference/registry.js";
import { InferenceRouter } from "../inference/router.js";
import { InferenceBudgetTracker } from "../inference/budget.js";
import { DEFAULT_MODEL_STRATEGY_CONFIG } from "../inference/types.js";
import { getEvidenceByCorrelation } from "../observability/evidence.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p013-inference-"));
  roots.push(root);
  const db = createDatabase(path.join(root, "state.db"));
  const registry = new ModelRegistry(db.raw);
  registry.initialize();
  const budget = new InferenceBudgetTracker(db.raw, {
    ...DEFAULT_MODEL_STRATEGY_CONFIG,
    enableModelFallback: false,
  });
  return { db, router: new InferenceRouter(db.raw, registry, budget) };
}

describe("P-013 inference correlation", () => {
  it("persists pre-effect intent and atomically links success to canonical inference_cost", async () => {
    const { db, router } = setup();
    const result = await router.route(
      {
        messages: [{ role: "user", content: "evidence please" }],
        taskType: "agent_turn",
        tier: "normal",
        sessionId: "session-p013-success",
        turnId: "turn-p013-success",
      },
      async () => ({
        provider: "openai",
        message: { role: "assistant", content: "ok" },
        usage: { promptTokens: 20, completionTokens: 10 },
        finishReason: "stop",
      }),
    );

    expect(result.content).toBe("ok");
    const costs = inferenceGetSessionCosts(db.raw, "session-p013-success");
    expect(costs).toHaveLength(1);
    expect(costs[0].turnId).toBe("turn-p013-success");

    const events = getEvidenceByCorrelation(db.raw, "turn:turn-p013-success");
    expect(events.map((event) => event.eventType)).toEqual([
      "inference.attempt_started",
      "inference.succeeded",
    ]);
    expect(events[1].authorityType).toBe("inference_cost");
    expect(events[1].authorityId).toBe(costs[0].id);
    expect(events[1].causationId).toBe(events[0].authorityId);
    db.close();
  });

  it("records provider failure as externally in-doubt and does not invent a cost", async () => {
    const { db, router } = setup();
    await expect(router.route(
      {
        messages: [{ role: "user", content: "fail after dispatch" }],
        taskType: "agent_turn",
        tier: "normal",
        sessionId: "session-p013-failure",
        turnId: "turn-p013-failure",
      },
      async () => { throw new Error("provider connection ended"); },
    )).rejects.toThrow("provider connection ended");

    expect(inferenceGetSessionCosts(db.raw, "session-p013-failure")).toHaveLength(0);
    const events = getEvidenceByCorrelation(db.raw, "turn:turn-p013-failure");
    expect(events.map((event) => event.eventType)).toEqual([
      "inference.attempt_started",
      "inference.provider_error_external_settlement_unknown",
    ]);
    expect(events[1].epistemicStatus).toBe("unknown");
    expect((events[1].payload as any).externalSettlement).toBe("unknown");
    db.close();
  });

  it("rolls back canonical cost when durable success evidence cannot commit", async () => {
    const { db, router } = setup();
    await expect(router.route(
      {
        messages: [{ role: "user", content: "atomic persistence" }],
        taskType: "agent_turn",
        tier: "normal",
        sessionId: "session-p013-atomic",
        turnId: "turn-p013-atomic",
      },
      async () => {
        db.raw.exec(`
          CREATE TRIGGER reject_inference_success_evidence
          BEFORE INSERT ON evidence_events
          WHEN NEW.event_type = 'inference.succeeded'
          BEGIN
            SELECT RAISE(ABORT, 'intentional evidence persistence failure');
          END;
        `);
        return {
          provider: "openai",
          message: { role: "assistant", content: "provider succeeded" },
          usage: { promptTokens: 20, completionTokens: 10 },
          finishReason: "stop",
        };
      },
    )).rejects.toThrow("intentional evidence persistence failure");

    expect(inferenceGetSessionCosts(db.raw, "session-p013-atomic")).toHaveLength(0);
    const events = getEvidenceByCorrelation(db.raw, "turn:turn-p013-atomic");
    expect(events.map((event) => event.eventType)).toEqual(["inference.attempt_started"]);
    expect(events[0].authorityType).toBe("inference_attempt");
    db.close();
  });
});
