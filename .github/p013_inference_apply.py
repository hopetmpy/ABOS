from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected block once, got {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")

# Return the canonical inference-cost row id so P-013 can reference it.
replace_once(
    "src/inference/budget.ts",
    '''  recordCost(cost: Omit<InferenceCostRow, "id" | "createdAt">): void {\n    inferenceInsertCost(this.db, cost);\n  }''',
    '''  recordCost(cost: Omit<InferenceCostRow, "id" | "createdAt">): string {\n    return inferenceInsertCost(this.db, cost);\n  }''',
)

# Durable pre-effect intent + explicit unknown settlement on provider failures +
# atomic canonical cost/evidence success persistence.
replace_once(
    "src/inference/router.ts",
    '''import { DEFAULT_ROUTING_MATRIX, TASK_TIMEOUTS } from "./types.js";''',
    '''import { DEFAULT_ROUTING_MATRIX, TASK_TIMEOUTS } from "./types.js";\nimport { appendEvidenceEvent, correlationIdFor } from "../observability/evidence.js";''',
)

replace_once(
    "src/inference/router.ts",
    '''    const preference = this.getPreference(tier, taskType);\n    const timeout = TASK_TIMEOUTS[taskType] || 120_000;\n    const estimatedTokens = messages.reduce(\n      (sum, message) => sum + (message.content?.length || 0) / 4,\n      0,\n    );''',
    '''    const preference = this.getPreference(tier, taskType);\n    const timeout = TASK_TIMEOUTS[taskType] || 120_000;\n    const estimatedTokens = messages.reduce(\n      (sum, message) => sum + (message.content?.length || 0) / 4,\n      0,\n    );\n    const correlationId = turnId\n      ? correlationIdFor("turn", turnId)\n      : sessionId\n        ? correlationIdFor("session", sessionId)\n        : correlationIdFor("inference_route", ulid());\n    const rootCausationId = turnId ? correlationIdFor("turn", turnId) : null;''',
)

replace_once(
    "src/inference/router.ts",
    '''      const startTime = Date.now();\n      let response: any;\n      const controller = new AbortController();\n      const timer = setTimeout(() => controller.abort(), timeout);''',
    '''      const attemptId = ulid();\n      // Critical inference evidence is persisted before the external call. If\n      // the process dies after dispatch, restart can distinguish an in-doubt\n      // attempt from a request that was never sent.\n      appendEvidenceEvent(this.db, {\n        correlationId,\n        causationId: rootCausationId,\n        eventType: "inference.attempt_started",\n        domain: "inference",\n        authorityType: "inference_attempt",\n        authorityId: attemptId,\n        turnId: turnId || null,\n        epistemicStatus: "observation",\n        payload: {\n          model: model.modelId,\n          expectedProvider,\n          taskType,\n          tier,\n          estimatedCostCents,\n          costUnit: "cent",\n          timeoutMs: timeout,\n        },\n        provenance: { source: "InferenceRouter" },\n      });\n\n      const startTime = Date.now();\n      let response: any;\n      const controller = new AbortController();\n      const timer = setTimeout(() => controller.abort(), timeout);''',
)

replace_once(
    "src/inference/router.ts",
    '''        if (controller.signal.aborted && error?.name === "AbortError") {\n          return {''',
    '''        if (controller.signal.aborted && error?.name === "AbortError") {\n          appendEvidenceEvent(this.db, {\n            correlationId,\n            causationId: attemptId,\n            eventType: "inference.local_timeout_external_settlement_unknown",\n            domain: "inference",\n            authorityType: "inference_attempt",\n            authorityId: attemptId,\n            turnId: turnId || null,\n            epistemicStatus: "unknown",\n            payload: {\n              model: model.modelId,\n              provider: expectedProvider,\n              latencyMs,\n              timeoutMs: timeout,\n              localOutcome: "timeout",\n              externalSettlement: "unknown",\n              accountedCostCents: 0,\n              costUnit: "cent",\n            },\n            provenance: { source: "InferenceRouter" },\n          });\n          return {''',
)

replace_once(
    "src/inference/router.ts",
    '''        lastError = error;\n        if (fallbackEnabled) continue;\n        throw error;''',
    '''        appendEvidenceEvent(this.db, {\n          correlationId,\n          causationId: attemptId,\n          eventType: "inference.provider_error_external_settlement_unknown",\n          domain: "inference",\n          authorityType: "inference_attempt",\n          authorityId: attemptId,\n          turnId: turnId || null,\n          epistemicStatus: "unknown",\n          payload: {\n            model: model.modelId,\n            provider: expectedProvider,\n            latencyMs,\n            localOutcome: "provider_error",\n            externalSettlement: "unknown",\n            error,\n          },\n          provenance: { source: "InferenceRouter" },\n        });\n        lastError = error;\n        if (fallbackEnabled) continue;\n        throw error;''',
)

old_cost = '''      this.budget.recordCost({\n        sessionId,\n        turnId: turnId || null,\n        model: model.modelId,\n        provider: actualProvider,\n        inputTokens,\n        outputTokens,\n        costCents: actualCostCents,\n        latencyMs,\n        tier,\n        taskType,\n        cacheHit: false,\n      });'''
new_cost = '''      this.db.transaction(() => {\n        const costId = this.budget.recordCost({\n          sessionId,\n          turnId: turnId || null,\n          model: model.modelId,\n          provider: actualProvider,\n          inputTokens,\n          outputTokens,\n          costCents: actualCostCents,\n          latencyMs,\n          tier,\n          taskType,\n          cacheHit: false,\n        });\n        appendEvidenceEvent(this.db, {\n          correlationId,\n          causationId: attemptId,\n          eventType: "inference.succeeded",\n          domain: "inference",\n          authorityType: "inference_cost",\n          authorityId: costId,\n          turnId: turnId || null,\n          epistemicStatus: "observation",\n          payload: {\n            attemptId,\n            model: model.modelId,\n            provider: actualProvider,\n            inputTokens,\n            outputTokens,\n            costCents: actualCostCents,\n            costUnit: "cent",\n            latencyMs,\n            finishReason: response.finishReason || "stop",\n          },\n          provenance: { source: "inference_costs" },\n        });\n      })();'''
replace_once("src/inference/router.ts", old_cost, new_cost)

# Existing inference-router unit DB needs the P-013 evidence table now that route
# has a critical durable evidence dependency.
replace_once(
    "src/__tests__/inference-router.test.ts",
    '''import { MIGRATION_V6 } from "../state/schema.js";''',
    '''import { MIGRATION_V6, MIGRATION_V18_EVIDENCE_FABRIC } from "../state/schema.js";''',
)
replace_once(
    "src/__tests__/inference-router.test.ts",
    '''  testDb.exec(MIGRATION_V6);\n  return testDb;''',
    '''  testDb.exec(MIGRATION_V6);\n  testDb.exec(MIGRATION_V18_EVIDENCE_FABRIC);\n  return testDb;''',
)

# Focused causal/durability tests on a production-shaped DB.
(ROOT / "src/__tests__/p013-inference-correlation.test.ts").write_text(r'''import { afterEach, describe, expect, it } from "vitest";
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
''', encoding="utf-8")

print("P013_INFERENCE_APPLY: PASS")
