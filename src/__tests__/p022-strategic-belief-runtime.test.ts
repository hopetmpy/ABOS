import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATION_V12 } from "../state/schema.js";
import {
  AdaptivePathEngine,
  STRATEGIC_PATH_BELIEF_KEY,
} from "../intelligence/adaptive-engine.js";
import type { PathCandidate } from "../intelligence/types.js";

function prepareDb(): Database.Database {
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
  ).run("goal-1", "Goal", "Runtime world-model producer", new Date().toISOString());
  return db;
}

function candidate(overrides: Partial<PathCandidate> = {}): PathCandidate {
  return {
    goalId: "goal-1",
    hypothesis: "Provider A can satisfy the goal through the registered runtime.",
    strategy: "Use provider A",
    assumptions: ["Provider A remains authorized"],
    requiredCapabilities: ["provider-a"],
    environment: "provider-a",
    executor: "local",
    sequence: ["probe", "execute", "verify"],
    expectedOutcome: "The goal is completed and verified.",
    evidence: [],
    ...overrides,
  };
}

describe("P-022 runtime strategic-belief producer", () => {
  it("materializes exactly one uncalibrated belief when the same path is selected repeatedly", () => {
    const db = prepareDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const pathCandidate = candidate();

      const first = engine.selectCandidate(pathCandidate);
      const second = engine.selectCandidate(pathCandidate);

      expect(second.path.id).toBe(first.path.id);
      const beliefs = engine.store.listActiveBeliefs("goal-1", {
        key: STRATEGIC_PATH_BELIEF_KEY,
      });
      expect(beliefs).toHaveLength(1);
      expect(beliefs[0]).toEqual(expect.objectContaining({
        value: pathCandidate.hypothesis,
        epistemicStatus: "inference",
        confidence: null,
        source: `path:${first.path.id}`,
        lifecycleStatus: "active",
      }));
      expect(beliefs[0]?.falsificationConditions[0]).toContain(
        pathCandidate.expectedOutcome,
      );
    } finally {
      db.close();
    }
  });

  it("invalidates the path belief only when failure evidence is terminal for the path", () => {
    const db = prepareDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const pathCandidate = candidate();
      const selected = engine.selectCandidate(pathCandidate);

      const decision = engine.recordFailure({
        candidate: pathCandidate,
        pathId: selected.path.id,
        error: "Execution produced an unrecoverable strategic mismatch.",
      });

      expect(decision.diagnosis.terminalForPath).toBe(true);
      const [belief] = engine.store.listBeliefs("goal-1", STRATEGIC_PATH_BELIEF_KEY);
      expect(belief).toEqual(expect.objectContaining({
        source: `path:${selected.path.id}`,
        lifecycleStatus: "invalidated",
      }));
      expect(belief?.evidenceRefs).toHaveLength(1);

      const failureEvidence = db.prepare(
        "SELECT id, content FROM adaptive_evidence WHERE id = ?",
      ).get(belief?.evidenceRefs[0]) as { id: string; content: string } | undefined;
      expect(failureEvidence?.content).toBe(
        "Execution produced an unrecoverable strategic mismatch.",
      );
    } finally {
      db.close();
    }
  });

  it("preserves a non-terminal hypothesis and exposes a newly selected route as a competitor", () => {
    const db = prepareDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const firstCandidate = candidate();
      const first = engine.selectCandidate(firstCandidate);

      const decision = engine.recordFailure({
        candidate: firstCandidate,
        pathId: first.path.id,
        error: "401 unauthorized: current credential expired",
      });
      expect(decision.diagnosis.classification).toBe("authorization");
      expect(decision.diagnosis.terminalForPath).toBe(false);

      const secondCandidate = candidate({
        hypothesis: "Provider B can satisfy the same goal without the unavailable credential.",
        strategy: "Use provider B",
        assumptions: ["Provider B is reachable"],
        requiredCapabilities: ["provider-b"],
        environment: "provider-b",
      });
      engine.selectCandidate(secondCandidate);

      const beliefs = engine.store.listActiveBeliefs("goal-1", {
        key: STRATEGIC_PATH_BELIEF_KEY,
      });
      expect(beliefs).toHaveLength(2);
      expect(beliefs.map((belief) => belief.value)).toEqual(expect.arrayContaining([
        firstCandidate.hypothesis,
        secondCandidate.hypothesis,
      ]));

      const context = engine.buildPlannerContext("goal-1");
      expect(context).toContain(firstCandidate.hypothesis);
      expect(context).toContain(secondCandidate.hypothesis);
    } finally {
      db.close();
    }
  });
});
