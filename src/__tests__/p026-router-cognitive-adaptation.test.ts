import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbosDatabase, InferenceClient } from "../types.js";
import type { InferenceRouter } from "../inference/router.js";
import { RouterBackedOrchestrationInferenceClient } from "../inference/router-orchestration-client.js";
import { CognitiveCostController } from "../intelligence/cognitive-cost-controller.js";
import { createTestDb } from "./mocks.js";

function routedResult(tier: string) {
  return {
    content: "{}",
    model: `model-${tier}`,
    provider: "codex",
    inputTokens: tier === "low_compute" ? 40 : 100,
    outputTokens: tier === "low_compute" ? 10 : 50,
    costCents: tier === "low_compute" ? 2 : 10,
    latencyMs: tier === "low_compute" ? 40 : 100,
    finishReason: "stop",
    toolCalls: undefined,
  };
}

function insertInferenceSample(
  db: AbosDatabase,
  id: string,
  tier: "high" | "normal" | "low_compute",
  costCents: number,
  latencyMs: number,
  inputTokens: number,
  outputTokens: number,
): void {
  db.raw.prepare(
    `INSERT INTO inference_costs
     (id, session_id, turn_id, model, provider, input_tokens, output_tokens,
      cost_cents, latency_ms, tier, task_type, cache_hit, created_at)
     VALUES (?, 'p026', NULL, ?, 'codex', ?, ?, ?, ?, ?, 'planning', 0, ?)`,
  ).run(
    id,
    `model-${tier}`,
    inputTokens,
    outputTokens,
    costCents,
    latencyMs,
    tier,
    `2026-09-25T20:00:0${id.length}.000Z`,
  );
}

function seedQuality(
  controller: CognitiveCostController,
  routeId: string,
  success: boolean,
  score: number,
  actualCostCents: number,
  latencyMs: number,
  contextTokens: number,
): void {
  const decision = controller.decide({
    taskClass: "orchestration:planning",
    candidates: [{
      id: routeId,
      kind: "inference",
      availability: "available",
      expectedCostCents: actualCostCents,
      expectedLatencyMs: latencyMs,
      expectedContextTokens: contextTokens,
    }],
    baselineRouteId: routeId,
  });
  controller.recordExecution(decision.id, {
    actualCostCents,
    latencyMs,
    contextTokens,
  });
  controller.recordOutcome(decision.id, {
    success,
    qualityValidated: true,
    qualityScore: score,
    actualCostCents,
    latencyMs,
    contextTokens,
    reworkCount: success ? 0 : 1,
  });
}

describe("P-026 router-backed cognitive adaptation", () => {
  let db: AbosDatabase;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  function makeClient(route: ReturnType<typeof vi.fn>, selectModel: ReturnType<typeof vi.fn>) {
    return new RouterBackedOrchestrationInferenceClient({
      db: db.raw,
      router: { route, selectModel } as unknown as InferenceRouter,
      runtime: { chat: vi.fn() } as unknown as InferenceClient,
      getConnectionProvider: () => "codex",
      getSessionId: () => "session-p026",
    });
  }

  it("preserves the requested reasoning tier when cheaper tiers lack validated quality", async () => {
    insertInferenceSample(db, "h1", "high", 10, 100, 100, 50);
    insertInferenceSample(db, "l1", "low_compute", 2, 40, 40, 10);
    const route = vi.fn(async (request: any) => routedResult(request.tier));
    const selectModel = vi.fn((tier: string) => ({ modelId: `model-${tier}` }));

    const response = await makeClient(route, selectModel).chat({
      tier: "reasoning",
      messages: [{ role: "user", content: "plan" }],
      responseFormat: { type: "json_object" },
      trace: { goalId: "goal-a", taskType: "planning" },
    });

    expect(route.mock.calls[0]?.[0]?.tier).toBe("high");
    expect(response.metadata).toMatchObject({
      tier: "reasoning",
      effectiveTier: "reasoning",
    });
  });

  it("de-escalates reasoning to cheap only after durable quality evidence and lower observed resources", async () => {
    insertInferenceSample(db, "h1", "high", 10, 100, 100, 50);
    insertInferenceSample(db, "l1", "low_compute", 2, 40, 40, 10);
    const cognitive = new CognitiveCostController(db.raw);
    for (let i = 0; i < 2; i += 1) {
      seedQuality(
        cognitive,
        "inference:planning:cheap",
        true,
        0.95,
        2,
        40,
        50,
      );
    }
    const route = vi.fn(async (request: any) => routedResult(request.tier));
    const selectModel = vi.fn((tier: string) => ({ modelId: `model-${tier}` }));

    const response = await makeClient(route, selectModel).chat({
      tier: "reasoning",
      messages: [{ role: "user", content: "plan" }],
      responseFormat: { type: "json_object" },
      trace: { goalId: "goal-b", taskType: "planning" },
    });

    expect(route.mock.calls[0]?.[0]).toMatchObject({
      tier: "low_compute",
      connectionProvider: "codex",
      taskType: "planning",
    });
    expect(response.metadata).toMatchObject({
      tier: "reasoning",
      effectiveTier: "cheap",
    });
    expect(response.metadata?.cognitiveDecisionId).toBeTruthy();
  });

  it("escalates a repeatedly low-quality cheap baseline to the designated reasoning fallback", async () => {
    insertInferenceSample(db, "h1", "high", 10, 100, 100, 50);
    insertInferenceSample(db, "l1", "low_compute", 2, 40, 40, 10);
    const cognitive = new CognitiveCostController(db.raw);
    for (let i = 0; i < 2; i += 1) {
      seedQuality(
        cognitive,
        "inference:planning:cheap",
        false,
        0.2,
        2,
        40,
        50,
      );
    }
    const route = vi.fn(async (request: any) => routedResult(request.tier));
    const selectModel = vi.fn((tier: string) => ({ modelId: `model-${tier}` }));

    const response = await makeClient(route, selectModel).chat({
      tier: "cheap",
      messages: [{ role: "user", content: "repair plan" }],
      responseFormat: { type: "json_object" },
      trace: { goalId: "goal-c", taskType: "planning" },
    });

    expect(route.mock.calls[0]?.[0]?.tier).toBe("high");
    expect(response.metadata).toMatchObject({
      tier: "cheap",
      effectiveTier: "reasoning",
    });
  });
});
