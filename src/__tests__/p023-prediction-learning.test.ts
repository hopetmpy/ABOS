import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AdaptivePathEngine, STRATEGIC_PATH_BELIEF_KEY } from "../intelligence/adaptive-engine.js";
import { classifyFailure } from "../intelligence/failure-classifier.js";
import { recordPredictionComparison } from "../intelligence/prediction-learning.js";
import type { PathCandidate } from "../intelligence/types.js";
import { getEvidenceByAuthority } from "../observability/evidence.js";

function candidate(overrides: Partial<PathCandidate> = {}): PathCandidate {
  return {
    goalId: "goal-1",
    taskId: "task-1",
    hypothesis: "The selected route can satisfy the objective",
    strategy: "Execute the evidence-backed route",
    assumptions: ["The provider can return a valid result"],
    requiredCapabilities: ["provider-api"],
    environment: "local",
    executor: "local://worker",
    sequence: ["Execute", "Observe outcome"],
    expectedOutcome: "A valid provider result is observed",
    expectedCostCents: 10,
    evidence: [],
    ...overrides,
  };
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      strategy TEXT,
      expected_revenue_cents INTEGER DEFAULT 0,
      actual_revenue_cents INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      deadline TEXT,
      completed_at TEXT
    );
  `);
  db.prepare(
    "INSERT INTO goals (id, title, description, created_at) VALUES (?, ?, ?, ?)",
  ).run("goal-1", "Goal", "Description", new Date().toISOString());
  return db;
}

function payload(event: { payload: unknown } | undefined): Record<string, unknown> {
  return event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
}

describe("P-023 prediction → outcome → error → learning", () => {
  it("preserves unmatched failure evidence as UNKNOWN instead of inventing strategic failure", () => {
    const diagnosis = classifyFailure("Opaque executor response without a discriminating error signal");
    expect(diagnosis.classification).toBe("unknown");
    expect(diagnosis.terminalForPath).toBe(false);

    const explicit = classifyFailure("The proposed approach produced an invalid result");
    expect(explicit.classification).toBe("strategic_failure");
    expect(explicit.terminalForPath).toBe(true);
  });

  it("keeps UNKNOWN outcome inconclusive and does not invalidate the strategic belief", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const selected = engine.selectCandidate(candidate(), { providerState: "observed" });
      const decision = engine.recordFailure({
        candidate: candidate(),
        pathId: selected.path.id,
        error: "Opaque executor response without a discriminating error signal",
        conditions: { providerState: "observed" },
      });

      expect(decision.diagnosis.classification).toBe("unknown");
      expect(decision.diagnosis.terminalForPath).toBe(false);
      expect(decision.attempt.outcome).toBe("inconclusive");
      expect(decision.path.status).toBe("unknown");

      const activeBeliefs = engine.store.listActiveBeliefs("goal-1", {
        key: STRATEGIC_PATH_BELIEF_KEY,
      });
      expect(activeBeliefs.some((belief) => belief.source === `path:${selected.path.id}`)).toBe(true);

      const events = getEvidenceByAuthority(db, "adaptive_attempt", decision.attempt.id);
      const comparison = events.find((event) => event.eventType === "adaptive.prediction_compared");
      expect(payload(comparison).comparison).toBe("inconclusive");
      expect(payload(comparison).attribution).toBe("unknown");

      const pathEvents = getEvidenceByAuthority(db, "adaptive_path", selected.path.id);
      expect(pathEvents.some((event) => event.eventType === "adaptive.prediction_resolved")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("distinguishes measurement failure from model error without terminating the path belief", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const selected = engine.selectCandidate(candidate());
      const decision = engine.recordFailure({
        candidate: candidate(),
        pathId: selected.path.id,
        error: "Unable to verify the outcome because measurement is unavailable",
      });

      expect(decision.diagnosis.classification).toBe("unknown");
      expect(decision.attempt.outcome).toBe("inconclusive");

      const comparison = getEvidenceByAuthority(db, "adaptive_attempt", decision.attempt.id)
        .find((event) => event.eventType === "adaptive.prediction_compared");
      expect(payload(comparison).comparison).toBe("inconclusive");
      expect(payload(comparison).attribution).toBe("measurement_failure");
      expect(engine.store.listActiveBeliefs("goal-1", { key: STRATEGIC_PATH_BELIEF_KEY }))
        .toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("attributes transient and capability failures without contradicting the strategic prediction", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);

      const transientPath = engine.selectCandidate(candidate({ strategy: "Route transient" }));
      const transient = engine.recordFailure({
        candidate: candidate({ strategy: "Route transient" }),
        pathId: transientPath.path.id,
        error: "ETIMEDOUT contacting provider",
      });
      const transientComparison = getEvidenceByAuthority(db, "adaptive_attempt", transient.attempt.id)
        .find((event) => event.eventType === "adaptive.prediction_compared");
      expect(payload(transientComparison).comparison).toBe("inconclusive");
      expect(payload(transientComparison).attribution).toBe("execution_failure");

      const capabilityCandidate = candidate({
        strategy: "Route capability",
        requiredCapabilities: ["terraform"],
      });
      const capabilityPath = engine.selectCandidate(capabilityCandidate);
      const capability = engine.recordFailure({
        candidate: capabilityCandidate,
        pathId: capabilityPath.path.id,
        error: "command not found: terraform",
      });
      const capabilityComparison = getEvidenceByAuthority(db, "adaptive_attempt", capability.attempt.id)
        .find((event) => event.eventType === "adaptive.prediction_compared");
      expect(payload(capabilityComparison).comparison).toBe("inconclusive");
      expect(payload(capabilityComparison).attribution).toBe("capability_mismatch");
    } finally {
      db.close();
    }
  });

  it("records explicit strategic contradiction and preserves the existing terminal learning", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const selected = engine.selectCandidate(candidate());
      const decision = engine.recordFailure({
        candidate: candidate(),
        pathId: selected.path.id,
        error: "The proposed approach produced an invalid result",
        evidence: ["artifact://invalid-result"],
      });

      expect(decision.diagnosis.classification).toBe("strategic_failure");
      expect(decision.diagnosis.terminalForPath).toBe(true);
      expect(decision.attempt.outcome).toBe("failed");
      expect(decision.path.status).toBe("failed");
      expect(engine.store.listActiveBeliefs("goal-1", { key: STRATEGIC_PATH_BELIEF_KEY }))
        .toHaveLength(0);

      const comparison = getEvidenceByAuthority(db, "adaptive_attempt", decision.attempt.id)
        .find((event) => event.eventType === "adaptive.prediction_compared");
      expect(payload(comparison).comparison).toBe("contradicted");
      expect(payload(comparison).attribution).toBe("model_or_strategy_error");

      const resolution = getEvidenceByAuthority(db, "adaptive_path", selected.path.id)
        .find((event) => event.eventType === "adaptive.prediction_resolved");
      expect(payload(resolution).resolution).toBe("contradicted");
    } finally {
      db.close();
    }
  });

  it("does not confirm a multi-task strategic prediction on intermediate task success", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const strategicCandidate = candidate({
        taskId: null,
        strategy: "Multi-task route",
        sequence: ["Task A", "Task B"],
        expectedOutcome: "Both route tasks complete",
      });
      const selected = engine.selectCandidate(strategicCandidate);
      engine.store.setPathStatus(selected.path.id, "executing");

      engine.recordSuccess({
        candidate: candidate({
          taskId: "task-a",
          strategy: "Task A execution",
          sequence: ["Task A"],
        }),
        pathId: selected.path.id,
        markPathSucceeded: false,
        observations: ["Task A complete"],
      });

      const attempt = engine.store.latestAttempt(selected.path.id, "task-a");
      expect(attempt).toBeDefined();
      const comparison = getEvidenceByAuthority(db, "adaptive_attempt", attempt!.id)
        .find((event) => event.eventType === "adaptive.prediction_compared");
      expect(payload(comparison).comparison).toBe("inconclusive");
      expect(engine.store.getPath(selected.path.id)?.status).toBe("executing");
      expect(getEvidenceByAuthority(db, "adaptive_path", selected.path.id)
        .some((event) => event.eventType === "adaptive.prediction_resolved")).toBe(false);

      engine.completePath(selected.path.id, ["Task A and Task B completed"]);
      const resolution = getEvidenceByAuthority(db, "adaptive_path", selected.path.id)
        .find((event) => event.eventType === "adaptive.prediction_resolved");
      expect(payload(resolution).resolution).toBe("confirmed");
      expect(engine.store.getPath(selected.path.id)?.status).toBe("succeeded");
    } finally {
      db.close();
    }
  });

  it("deduplicates comparison evidence for the same canonical outcome attempt", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const selected = engine.selectCandidate(candidate());
      engine.recordSuccess({
        candidate: candidate(),
        pathId: selected.path.id,
        markPathSucceeded: false,
        observations: ["Execution step completed"],
      });
      const attempt = engine.store.latestAttempt(selected.path.id, "task-1")!;

      const first = recordPredictionComparison(db, {
        path: selected.path,
        attempt,
      });
      const second = recordPredictionComparison(db, {
        path: selected.path,
        attempt,
      });

      expect(second.id).toBe(first.id);
      expect(getEvidenceByAuthority(db, "adaptive_attempt", attempt.id)
        .filter((event) => event.eventType === "adaptive.prediction_compared"))
        .toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
