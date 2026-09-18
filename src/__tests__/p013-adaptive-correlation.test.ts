import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MIGRATION_V12 } from "../state/schema.js";
import { AdaptivePathEngine } from "../intelligence/adaptive-engine.js";
import type { PathCandidate } from "../intelligence/types.js";
import { getEvidenceByCorrelation } from "../observability/evidence.js";

function dbForTest(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
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
  db.exec(MIGRATION_V12);
  db.prepare(
    "INSERT INTO goals (id, title, description, created_at) VALUES (?, ?, ?, ?)",
  ).run("goal-p013", "Goal", "Correlation test", new Date().toISOString());
  return db;
}

function candidate(): PathCandidate {
  return {
    goalId: "goal-p013",
    taskId: "task-p013",
    hypothesis: "Provider path can satisfy the task",
    strategy: "Use provider",
    assumptions: ["Provider is reachable"],
    requiredCapabilities: ["api"],
    environment: "local",
    executor: "local://worker",
    sequence: ["attempt provider"],
    expectedOutcome: "result",
    expectedCostCents: 5,
    evidence: [],
  };
}

describe("P-013 adaptive correlation", () => {
  it("reconstructs path, attempt and learning references under the goal correlation", () => {
    const db = dbForTest();
    try {
      const engine = new AdaptivePathEngine(db);
      const selected = engine.selectCandidate(candidate(), { network: "degraded" });
      engine.store.bindTask({
        taskId: "task-p013",
        goalId: "goal-p013",
        pathId: selected.path.id,
      });
      const decision = engine.recordFailure({
        candidate: candidate(),
        pathId: selected.path.id,
        error: "The provider returned an invalid result",
        observations: ["provider response failed validation"],
        evidence: ["artifact://validation-result"],
        learnedFacts: [{ key: "provider.validation", value: "canonical-only-value-p013", confidence: 0.9 }],
        conditions: { network: "degraded" },
      });

      const events = getEvidenceByCorrelation(db, "goal:goal-p013");
      const types = events.map((event) => event.eventType);
      expect(types).toContain("adaptive.path_created");
      expect(types).toContain("adaptive.path_status_changed");
      expect(types).toContain("adaptive.task_bound");
      expect(types).toContain("adaptive.fact_upserted");
      expect(types).toContain("adaptive.attempt_recorded");
      expect(types).toContain("adaptive.evidence_recorded");
      expect(types).toContain("adaptive.opportunity_opened");

      const attemptEvent = events.find((event) => event.eventType === "adaptive.attempt_recorded");
      expect(attemptEvent?.authorityType).toBe("adaptive_attempt");
      expect(attemptEvent?.authorityId).toBe(decision.attempt.id);
      expect(attemptEvent?.taskId).toBe("task-p013");
      expect(attemptEvent?.causationId).toBeTruthy();
      const attemptCause = events.find((event) => event.id === attemptEvent?.causationId);
      expect(attemptCause?.authorityType).toBe("adaptive_path");
      expect(attemptCause?.authorityId).toBe(selected.path.id);

      const evidenceRows = db.prepare(
        "SELECT id FROM adaptive_evidence WHERE attempt_id = ? ORDER BY created_at",
      ).all(decision.attempt.id) as Array<{ id: string }>;
      expect(evidenceRows.length).toBeGreaterThan(0);
      for (const row of evidenceRows) {
        expect(events.some((event) =>
          event.authorityType === "adaptive_evidence" && event.authorityId === row.id
        )).toBe(true);
      }

      // The fabric indexes facts; canonical values stay in adaptive_world_facts.
      expect(JSON.stringify(events)).not.toContain("provider.validation");
      expect(JSON.stringify(events)).not.toContain("canonical-only-value-p013");
      expect(engine.store.getFact("goal-p013", "provider.validation")?.value).toBe("canonical-only-value-p013");
    } finally {
      db.close();
    }
  });

  it("rolls back the canonical attempt row when its critical evidence reference cannot commit", () => {
    const db = dbForTest();
    try {
      const engine = new AdaptivePathEngine(db);
      const selected = engine.selectCandidate(candidate());
      db.exec(`
        CREATE TRIGGER reject_adaptive_attempt_evidence
        BEFORE INSERT ON evidence_events
        WHEN NEW.event_type = 'adaptive.attempt_recorded'
        BEGIN
          SELECT RAISE(ABORT, 'intentional adaptive evidence failure');
        END;
      `);

      expect(() => engine.store.recordAttempt({
        pathId: selected.path.id,
        goalId: "goal-p013",
        taskId: "task-p013",
        outcome: "failed",
        failureClass: "strategic_failure",
        failureReason: "probe",
        conditionFingerprint: "conditions:none",
        noveltyScore: 1,
        retryEligible: false,
      })).toThrow("intentional adaptive evidence failure");

      const count = db.prepare(
        "SELECT COUNT(*) AS count FROM adaptive_attempts WHERE goal_id = ?",
      ).get("goal-p013") as { count: number };
      expect(count.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
