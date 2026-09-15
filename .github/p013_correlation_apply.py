from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exact block once, got {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# Shared policy/tool causal context.
replace_once(
    "src/types.ts",
    '''    actorAddress?: string;\n    turnToolCallCount: number;\n    sessionSpend?: SpendTrackerInterface;''',
    '''    actorAddress?: string;\n    /** Durable identities propagated by P-013; none creates a second domain authority. */\n    correlationId?: string;\n    causationId?: string | null;\n    goalId?: string | null;\n    taskId?: string | null;\n    turnId?: string | null;\n    toolCallId?: string | null;\n    turnToolCallCount: number;\n    sessionSpend?: SpendTrackerInterface;''',
)

# Tool execution runs under one AsyncLocal evidence context and persists the real turn id.
replace_once(
    "src/agent/tools-core.ts",
    '''import { createLogger } from "../observability/logger.js";''',
    '''import { createLogger } from "../observability/logger.js";\nimport { correlationIdFor, runWithEvidenceContext } from "../observability/evidence.js";''',
)

old_execute_header = '''export async function executeTool(\n  toolName: string,\n  args: Record<string, unknown>,\n  tools: AbosTool[],\n  context: ToolContext,\n  policyEngine?: PolicyEngine,\n  turnContext?: {\n    inputSource: InputSource | undefined;\n    inputProvenance?: import("../types.js").TurnInputProvenance;\n    actorAddress?: string;\n    turnToolCallCount: number;\n    sessionSpend?: SpendTrackerInterface;\n  },\n): Promise<ToolCallResult> {'''
new_execute_header = '''export async function executeTool(\n  toolName: string,\n  args: Record<string, unknown>,\n  tools: AbosTool[],\n  context: ToolContext,\n  policyEngine?: PolicyEngine,\n  turnContext?: PolicyRequest["turnContext"],\n): Promise<ToolCallResult> {\n  const correlationId =\n    turnContext?.correlationId ??\n    (turnContext?.turnId ? correlationIdFor("turn", turnContext.turnId) : undefined);\n\n  if (!correlationId) {\n    return executeToolProtected(toolName, args, tools, context, policyEngine, turnContext);\n  }\n\n  return runWithEvidenceContext(\n    {\n      correlationId,\n      causationId: turnContext?.causationId ?? turnContext?.toolCallId ?? null,\n      goalId: turnContext?.goalId ?? null,\n      taskId: turnContext?.taskId ?? null,\n      turnId: turnContext?.turnId ?? null,\n      toolCallId: turnContext?.toolCallId ?? null,\n    },\n    () => executeToolProtected(toolName, args, tools, context, policyEngine, turnContext),\n  );\n}\n\nasync function executeToolProtected(\n  toolName: string,\n  args: Record<string, unknown>,\n  tools: AbosTool[],\n  context: ToolContext,\n  policyEngine?: PolicyEngine,\n  turnContext?: PolicyRequest["turnContext"],\n): Promise<ToolCallResult> {'''
replace_once("src/agent/tools-core.ts", old_execute_header, new_execute_header)
replace_once(
    "src/agent/tools-core.ts",
    '''    policyEngine.persistDecision(decision, request);''',
    '''    policyEngine.persistDecision(decision, request, turnContext.turnId ?? undefined);''',
)

# One turn identity now spans inference cost, AgentTurn, Policy and tool calls.
replace_once(
    "src/agent/loop.ts",
    '''import { createLogger } from "../observability/logger.js";''',
    '''import { createLogger } from "../observability/logger.js";\nimport { correlationIdFor } from "../observability/evidence.js";''',
)
replace_once(
    "src/agent/loop.ts",
    '''      const inferenceTools = toolsToInferenceFormat(tools);\n      const routerResult = await inferenceRouter.route(''',
    '''      const inferenceTools = toolsToInferenceFormat(tools);\n      // P-013: one durable turn identity must correlate inference cost, persisted\n      // turn state, policy decisions and every tool call spawned by this turn.\n      const turnId = ulid();\n      const routerResult = await inferenceRouter.route(''',
)
replace_once(
    "src/agent/loop.ts",
    '''          turnId: ulid(),''',
    '''          turnId,''',
)
replace_once(
    "src/agent/loop.ts",
    '''      const turn: AgentTurn = {\n        id: ulid(),''',
    '''      const turn: AgentTurn = {\n        id: turnId,''',
)
replace_once(
    "src/agent/loop.ts",
    '''              inputSource: currentInputSource,\n              inputProvenance: currentInput?.provenance,\n              turnToolCallCount: turn.toolCalls.filter(t => t.name === "transfer_credits").length,''',
    '''              inputSource: currentInputSource,\n              inputProvenance: currentInput?.provenance,\n              correlationId: correlationIdFor("turn", turn.id),\n              turnId: turn.id,\n              toolCallId: tc.id,\n              turnToolCallCount: turn.toolCalls.filter(t => t.name === "transfer_credits").length,''',
)

# Policy lifecycle/outcome events are atomic with the canonical policy row update.
replace_once(
    "src/agent/policy-authorization.ts",
    '''import type { PolicyDecision, PolicyRequest } from "../types.js";''',
    '''import type { PolicyDecision, PolicyRequest } from "../types.js";\nimport { appendEvidenceEvent, currentEvidenceContext } from "../observability/evidence.js";''',
)

insert_after = '''interface PolicyAuthorizationRow {\n  id: string;\n  tool_name: string;\n  scope_hash: string | null;\n  lifecycle_state: string;\n  authorization_json: string | null;\n}\n'''
policy_helper = insert_after + '''\nfunction appendPolicyCorrelationEvent(\n  db: Database.Database,\n  decisionId: string,\n  eventType: string,\n  payload: Record<string, unknown>,\n): void {\n  const context = currentEvidenceContext();\n  if (!context) return;\n  appendEvidenceEvent(db, {\n    correlationId: context.correlationId,\n    causationId: context.causationId ?? null,\n    eventType,\n    domain: "policy",\n    authorityType: "policy_decision",\n    authorityId: decisionId,\n    goalId: context.goalId ?? null,\n    taskId: context.taskId ?? null,\n    turnId: context.turnId ?? null,\n    toolCallId: context.toolCallId ?? null,\n    epistemicStatus: "observation",\n    payload,\n    provenance: { source: "policy_decisions" },\n  });\n}\n'''
replace_once("src/agent/policy-authorization.ts", insert_after, policy_helper)

replace_once(
    "src/agent/policy-authorization.ts",
    '''    if (result.changes !== 1) {\n      throw new Error(`Failed to materialize policy lifecycle for ${decision.id}`);\n    }\n  })();''',
    '''    if (result.changes !== 1) {\n      throw new Error(`Failed to materialize policy lifecycle for ${decision.id}`);\n    }\n    appendPolicyCorrelationEvent(db, decision.id, "policy.decision_persisted", {\n      action: decision.action,\n      lifecycleState,\n      toolName: decision.toolName,\n      reasonCode: decision.reasonCode,\n    });\n  })();''',
)

old_outcome = '''export function recordPolicyExecutionOutcome(\n  db: Database.Database,\n  decisionId: string,\n  state: Exclude<PolicyExecutionState, "not_started">,\n  details?: Record<string, unknown>,\n): void {\n  const completedAt = state === "running" ? null : new Date().toISOString();\n  const result = db.prepare(\n    `UPDATE policy_decisions\n     SET execution_state = ?, execution_json = COALESCE(?, execution_json), completed_at = ?\n     WHERE id = ?`,\n  ).run(\n    state,\n    details ? canonicalPolicyJson(details) : null,\n    completedAt,\n    decisionId,\n  );\n  if (result.changes !== 1) {\n    throw new Error(`Failed to persist policy execution state ${state} for ${decisionId}`);\n  }\n}'''
new_outcome = '''export function recordPolicyExecutionOutcome(\n  db: Database.Database,\n  decisionId: string,\n  state: Exclude<PolicyExecutionState, "not_started">,\n  details?: Record<string, unknown>,\n): void {\n  db.transaction(() => {\n    const completedAt = state === "running" ? null : new Date().toISOString();\n    const result = db.prepare(\n      `UPDATE policy_decisions\n       SET execution_state = ?, execution_json = COALESCE(?, execution_json), completed_at = ?\n       WHERE id = ?`,\n    ).run(\n      state,\n      details ? canonicalPolicyJson(details) : null,\n      completedAt,\n      decisionId,\n    );\n    if (result.changes !== 1) {\n      throw new Error(`Failed to persist policy execution state ${state} for ${decisionId}`);\n    }\n    appendPolicyCorrelationEvent(db, decisionId, `policy.execution_${state}`, {\n      state,\n      details: details ?? null,\n    });\n  })();\n}'''
replace_once("src/agent/policy-authorization.ts", old_outcome, new_outcome)

# Self-mod journal transitions emit correlation evidence in the same SQLite transaction.
replace_once(
    "src/self-mod/transaction.ts",
    '''import { RUNTIME_ROOT } from "../runtime-root.js";''',
    '''import { RUNTIME_ROOT } from "../runtime-root.js";\nimport { appendEvidenceEvent, currentEvidenceContext } from "../observability/evidence.js";''',
)

replace_once(
    "src/self-mod/transaction.ts",
    '''function isoNow(nowMs = Date.now()): string {\n  return new Date(nowMs).toISOString();\n}\n''',
    '''function isoNow(nowMs = Date.now()): string {\n  return new Date(nowMs).toISOString();\n}\n\nfunction appendSelfModCorrelationEvent(\n  db: Database.Database,\n  transaction: SelfModTransactionRecord,\n): void {\n  const context = currentEvidenceContext();\n  if (!context) return;\n  appendEvidenceEvent(db, {\n    correlationId: context.correlationId,\n    causationId: context.causationId ?? null,\n    eventType: `self_mod.${transaction.status}`,\n    domain: "self_mod",\n    authorityType: "self_mod_transaction",\n    authorityId: transaction.id,\n    goalId: context.goalId ?? null,\n    taskId: context.taskId ?? null,\n    turnId: context.turnId ?? null,\n    toolCallId: context.toolCallId ?? null,\n    epistemicStatus: "observation",\n    payload: {\n      operation: transaction.operation,\n      status: transaction.status,\n      baseSha: transaction.baseSha,\n      candidateSha: transaction.candidateSha,\n      error: transaction.error,\n    },\n    provenance: { source: "self_mod_transactions" },\n  });\n}\n''',
)

old_create_tx = '''  const id = input.id ?? randomUUID();\n  const now = isoNow(input.nowMs);\n  db.prepare(\n    `INSERT INTO self_mod_transactions\n      (id, operation, status, base_sha, request_json, evidence_json, created_at, updated_at)\n     VALUES (?, ?, 'proposed', ?, ?, '[]', ?, ?)`,\n  ).run(id, input.operation, input.baseSha, JSON.stringify(input.request ?? {}), now, now);\n  return getSelfModTransaction(db, id)!;'''
new_create_tx = '''  const id = input.id ?? randomUUID();\n  const now = isoNow(input.nowMs);\n  return db.transaction(() => {\n    db.prepare(\n      `INSERT INTO self_mod_transactions\n        (id, operation, status, base_sha, request_json, evidence_json, created_at, updated_at)\n       VALUES (?, ?, 'proposed', ?, ?, '[]', ?, ?)`,\n    ).run(id, input.operation, input.baseSha, JSON.stringify(input.request ?? {}), now, now);\n    const transaction = getSelfModTransaction(db, id)!;\n    appendSelfModCorrelationEvent(db, transaction);\n    return transaction;\n  })();'''
replace_once("src/self-mod/transaction.ts", old_create_tx, new_create_tx)

replace_once(
    "src/self-mod/transaction.ts",
    '''    ).run(\n      next,\n      patch.candidateSha ?? null,\n      patch.workspacePath === undefined ? null : "set",\n      patch.workspacePath ?? null,\n      patch.evidence === undefined ? null : "set",\n      patch.evidence === undefined ? null : JSON.stringify(patch.evidence),\n      patch.error === undefined ? null : "set",\n      patch.error ?? null,\n      patch.rollback === undefined ? null : "set",\n      patch.rollback === undefined ? null : JSON.stringify(patch.rollback),\n      now,\n      completedAt,\n      id,\n    );\n    return getSelfModTransaction(db, id)!;''',
    '''    ).run(\n      next,\n      patch.candidateSha ?? null,\n      patch.workspacePath === undefined ? null : "set",\n      patch.workspacePath ?? null,\n      patch.evidence === undefined ? null : "set",\n      patch.evidence === undefined ? null : JSON.stringify(patch.evidence),\n      patch.error === undefined ? null : "set",\n      patch.error ?? null,\n      patch.rollback === undefined ? null : "set",\n      patch.rollback === undefined ? null : JSON.stringify(patch.rollback),\n      now,\n      completedAt,\n      id,\n    );\n    const transaction = getSelfModTransaction(db, id)!;\n    appendSelfModCorrelationEvent(db, transaction);\n    return transaction;''',
)

# E2E proof: one protected tool call spans policy and self-mod authorities.
test_path = ROOT / "src/__tests__/p013-policy-selfmod-correlation.test.ts"
test_path.write_text(r'''import { afterEach, describe, expect, it } from "vitest";
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
''', encoding="utf-8")

print("P013_CORRELATION_APPLY: PASS")
