import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CognitiveCostController,
  type CognitiveOutcomeInput,
  type CognitiveRouteCandidate,
} from "../intelligence/cognitive-cost-controller.js";
import {
  MIGRATION_V6,
  MIGRATION_V18_EVIDENCE_FABRIC,
} from "../state/schema.js";

let db: BetterSqlite3.Database;
let controller: CognitiveCostController;

const reasoning: CognitiveRouteCandidate = {
  id: "inference:planning:reasoning",
  kind: "inference",
  availability: "available",
  expectedCostCents: 10,
  expectedLatencyMs: 100,
  expectedContextTokens: 1_000,
};

const cheap: CognitiveRouteCandidate = {
  id: "inference:planning:cheap",
  kind: "inference",
  availability: "available",
  expectedCostCents: 2,
  expectedLatencyMs: 40,
  expectedContextTokens: 400,
};

function seedOutcome(
  route: CognitiveRouteCandidate,
  outcome: CognitiveOutcomeInput,
): string {
  const decision = controller.decide({
    taskClass: "orchestration:planning",
    candidates: [route],
    baselineRouteId: route.id,
  });
  controller.recordExecution(decision.id, {
    actualCostCents: outcome.actualCostCents,
    latencyMs: outcome.latencyMs,
    contextTokens: outcome.contextTokens,
  });
  return controller.recordOutcome(decision.id, outcome).id;
}

function outcomePayload(decisionId: string): Record<string, unknown> {
  const row = db.prepare(
    `SELECT payload_json
     FROM evidence_events
     WHERE authority_type = 'cognitive_decision'
       AND authority_id = ?
       AND event_type = 'cognitive.outcome_recorded'`,
  ).get(decisionId) as { payload_json: string };
  return JSON.parse(row.payload_json) as Record<string, unknown>;
}

describe("P-026 CognitiveCostController", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(MIGRATION_V6);
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    controller = new CognitiveCostController(db);
  });

  afterEach(() => {
    db.close();
  });

  it("preserves the baseline when a cheaper challenger has no validated quality evidence", () => {
    const decision = controller.decide({
      taskClass: "orchestration:planning",
      candidates: [reasoning, cheap],
      baselineRouteId: reasoning.id,
    });

    expect(decision.selectedRouteId).toBe(reasoning.id);
    expect(decision.expectedSavingsCents).toBeNull();
  });

  it("de-escalates only after the cheaper route has validated quality and a Pareto resource improvement", () => {
    for (let i = 0; i < 2; i += 1) {
      seedOutcome(cheap, {
        success: true,
        qualityValidated: true,
        qualityScore: 0.95,
        actualCostCents: 2,
        latencyMs: 40,
        contextTokens: 400,
        retryCostCents: 0,
        reworkCount: 0,
      });
    }

    const decision = controller.decide({
      taskClass: "orchestration:planning",
      candidates: [reasoning, cheap],
      baselineRouteId: reasoning.id,
    });

    expect(decision.selectedRouteId).toBe(cheap.id);
    expect(decision.expectedSavingsCents).toBe(8);
  });

  it("does not reinterpret UNKNOWN availability as a cheap executable route", () => {
    const unknownMemory: CognitiveRouteCandidate = {
      id: "memory:direct-answer",
      kind: "memory",
      availability: "unknown",
      expectedCostCents: 0,
      expectedLatencyMs: 1,
      expectedContextTokens: 10,
      qualityValidated: true,
      qualityConfidence: 1,
    };

    const decision = controller.decide({
      taskClass: "agent:answer",
      candidates: [reasoning, unknownMemory],
      baselineRouteId: reasoning.id,
    });

    expect(decision.selectedRouteId).toBe(reasoning.id);
    expect(decision.action).toBe("execute");
  });

  it("escalates to a designated quality fallback when the baseline has repeated validated quality failures", () => {
    for (let i = 0; i < 2; i += 1) {
      seedOutcome(cheap, {
        success: false,
        qualityValidated: true,
        qualityScore: 0.2,
        actualCostCents: 2,
        latencyMs: 40,
        contextTokens: 400,
        retryCostCents: 1,
        reworkCount: 1,
      });
    }

    const decision = controller.decide({
      taskClass: "orchestration:planning",
      candidates: [
        cheap,
        { ...reasoning, qualityFallback: true },
      ],
      baselineRouteId: cheap.id,
    });

    expect(decision.selectedRouteId).toBe(reasoning.id);
    expect(decision.rationale.join(" ")).toContain("quality fallback");
  });

  it("never records material savings for an unvalidated outcome", () => {
    const decision = controller.decide({
      taskClass: "orchestration:planning",
      candidates: [
        reasoning,
        {
          ...cheap,
          qualityValidated: true,
          qualityConfidence: 0.95,
        },
      ],
      baselineRouteId: reasoning.id,
    });
    expect(decision.selectedRouteId).toBe(cheap.id);

    controller.recordOutcome(decision.id, {
      success: true,
      qualityValidated: false,
      actualCostCents: 2,
      latencyMs: 40,
      contextTokens: 400,
    });

    expect(outcomePayload(decision.id).savingsCents).toBeNull();
  });

  it("reconstructs learned route quality after controller restart from durable Evidence Fabric", () => {
    for (let i = 0; i < 2; i += 1) {
      seedOutcome(cheap, {
        success: true,
        qualityValidated: true,
        qualityScore: 0.9,
        actualCostCents: 2,
        latencyMs: 40,
        contextTokens: 400,
        reworkCount: 0,
      });
    }

    const restarted = new CognitiveCostController(db);
    const decision = restarted.decide({
      taskClass: "orchestration:planning",
      candidates: [reasoning, cheap],
      baselineRouteId: reasoning.id,
    });

    expect(decision.selectedRouteId).toBe(cheap.id);
    expect(restarted.getRouteStats("orchestration:planning", cheap.id)).toMatchObject({
      validatedOutcomes: 2,
      validatedSuccesses: 2,
      successRate: 1,
    });
  });

  it("makes execution and outcome receipts idempotent per cognitive decision", () => {
    const decision = controller.decide({
      taskClass: "orchestration:planning",
      candidates: [reasoning],
      baselineRouteId: reasoning.id,
    });

    const executionA = controller.recordExecution(decision.id, {
      actualCostCents: 10,
    });
    const executionB = controller.recordExecution(decision.id, {
      actualCostCents: 999,
    });
    const outcomeA = controller.recordOutcome(decision.id, {
      success: true,
      qualityValidated: true,
      qualityScore: 1,
      actualCostCents: 10,
    });
    const outcomeB = controller.recordOutcome(decision.id, {
      success: false,
      qualityValidated: true,
      qualityScore: 0,
      actualCostCents: 999,
    });

    expect(executionB.id).toBe(executionA.id);
    expect(outcomeB.id).toBe(outcomeA.id);
    const counts = db.prepare(
      `SELECT event_type, COUNT(*) AS count
       FROM evidence_events
       WHERE authority_type = 'cognitive_decision' AND authority_id = ?
       GROUP BY event_type`,
    ).all(decision.id) as Array<{ event_type: string; count: number }>;
    expect(Object.fromEntries(counts.map((row) => [row.event_type, row.count]))).toEqual({
      "cognitive.outcome_recorded": 1,
      "cognitive.route_executed": 1,
      "cognitive.route_selected": 1,
    });
  });

  it("reads inference resource estimates from the existing inference ledger instead of duplicating it", () => {
    const insert = db.prepare(
      `INSERT INTO inference_costs
       (id, session_id, turn_id, model, provider, input_tokens, output_tokens,
        cost_cents, latency_ms, tier, task_type, cache_hit, created_at)
       VALUES (?, 's', NULL, 'm', 'p', ?, ?, ?, ?, 'high', 'planning', 0, ?)`,
    );
    insert.run("a", 100, 50, 10, 100, "2026-09-25T20:00:00.000Z");
    insert.run("b", 200, 100, 20, 300, "2026-09-25T20:01:00.000Z");

    expect(controller.estimateInferenceResources("planning", "high")).toEqual({
      sampleCount: 2,
      averageCostCents: 15,
      averageLatencyMs: 200,
      averageTokens: 225,
    });
  });
});
