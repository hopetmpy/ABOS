import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AdaptivePathEngine, STRATEGIC_PATH_BELIEF_KEY } from "../intelligence/adaptive-engine.js";
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

function prepareGoals(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS goals (
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
    "INSERT OR IGNORE INTO goals (id, title, description, created_at) VALUES (?, ?, ?, ?)",
  ).run("goal-1", "Goal", "Description", new Date().toISOString());
}

function payload(event: { payload: unknown } | undefined): Record<string, unknown> {
  return event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
}

describe("P-023 attribution and recovery invariants", () => {
  it("attributes an invalid assumption to stale_assumption and updates only related adaptive state", () => {
    const db = new Database(":memory:");
    try {
      prepareGoals(db);
      const engine = new AdaptivePathEngine(db);
      const pathCandidate = candidate();
      const selected = engine.selectCandidate(pathCandidate);

      const decision = engine.recordFailure({
        candidate: pathCandidate,
        pathId: selected.path.id,
        error: "assumption invalid: the provider can return a valid result",
      });

      expect(decision.diagnosis.classification).toBe("assumption_invalid");
      expect(decision.diagnosis.terminalForPath).toBe(true);
      const [assumption] = engine.store.listAssumptions("goal-1", selected.path.id);
      expect(assumption?.status).toBe("invalidated");

      const comparison = getEvidenceByAuthority(db, "adaptive_attempt", decision.attempt.id)
        .find((event) => event.eventType === "adaptive.prediction_compared");
      expect(payload(comparison).comparison).toBe("contradicted");
      expect(payload(comparison).attribution).toBe("stale_assumption");
      expect(engine.store.listActiveBeliefs("goal-1", {
        key: STRATEGIC_PATH_BELIEF_KEY,
      })).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("keeps authorization failure external and non-terminal for the strategic prediction", () => {
    const db = new Database(":memory:");
    try {
      prepareGoals(db);
      const engine = new AdaptivePathEngine(db);
      const pathCandidate = candidate();
      const selected = engine.selectCandidate(pathCandidate);

      const decision = engine.recordFailure({
        candidate: pathCandidate,
        pathId: selected.path.id,
        error: "401 Unauthorized while calling provider",
      });

      expect(decision.diagnosis.classification).toBe("authorization");
      expect(decision.diagnosis.terminalForPath).toBe(false);
      expect(decision.attempt.outcome).toBe("unavailable");
      expect(decision.path.status).toBe("unavailable");

      const comparison = getEvidenceByAuthority(db, "adaptive_attempt", decision.attempt.id)
        .find((event) => event.eventType === "adaptive.prediction_compared");
      expect(payload(comparison).comparison).toBe("inconclusive");
      expect(payload(comparison).attribution).toBe("external_condition");
      expect(engine.store.listActiveBeliefs("goal-1", {
        key: STRATEGIC_PATH_BELIEF_KEY,
      })).toHaveLength(1);
      expect(getEvidenceByAuthority(db, "adaptive_path", selected.path.id)
        .some((event) => event.eventType === "adaptive.prediction_resolved")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("preserves path-attempt comparison causation across restart and deduplicates replay", () => {
    const dir = mkdtempSync(join(tmpdir(), "abos-p023-"));
    const dbPath = join(dir, "state.db");
    let db = new Database(dbPath);

    try {
      prepareGoals(db);
      const firstEngine = new AdaptivePathEngine(db);
      const pathCandidate = candidate();
      const selected = firstEngine.selectCandidate(pathCandidate);
      const decision = firstEngine.recordFailure({
        candidate: pathCandidate,
        pathId: selected.path.id,
        error: "Opaque executor response without a discriminating error signal",
      });
      const attemptId = decision.attempt.id;
      db.close();

      db = new Database(dbPath);
      const reopenedEngine = new AdaptivePathEngine(db);
      const reopenedPath = reopenedEngine.store.getPath(selected.path.id);
      const reopenedAttempt = reopenedEngine.store.latestAttempt(selected.path.id, "task-1");
      expect(reopenedPath?.status).toBe("unknown");
      expect(reopenedAttempt?.id).toBe(attemptId);

      const attemptEvents = getEvidenceByAuthority(db, "adaptive_attempt", attemptId);
      const recorded = attemptEvents.find((event) => event.eventType === "adaptive.attempt_recorded");
      const comparison = attemptEvents.find((event) => event.eventType === "adaptive.prediction_compared");
      expect(recorded).toBeDefined();
      expect(comparison).toBeDefined();
      expect(comparison?.causationId).toBe(recorded?.id);
      expect(payload(comparison).pathId).toBe(selected.path.id);
      expect(payload(comparison).attemptId).toBe(attemptId);

      const replay = recordPredictionComparison(db, {
        path: reopenedPath!,
        attempt: reopenedAttempt!,
      });
      expect(replay.id).toBe(comparison?.id);
      expect(getEvidenceByAuthority(db, "adaptive_attempt", attemptId)
        .filter((event) => event.eventType === "adaptive.prediction_compared"))
        .toHaveLength(1);
    } finally {
      if (db.open) db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});