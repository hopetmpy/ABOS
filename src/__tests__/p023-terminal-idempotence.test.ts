import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AdaptivePathEngine } from "../intelligence/adaptive-engine.js";
import type { PathCandidate } from "../intelligence/types.js";
import { getEvidenceByAuthority } from "../observability/evidence.js";

function prepareDb(): Database.Database {
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

function candidate(): PathCandidate {
  return {
    goalId: "goal-1",
    taskId: "task-1",
    hypothesis: "The route can satisfy the objective",
    strategy: "Execute the route",
    assumptions: ["The route remains viable"],
    requiredCapabilities: [],
    environment: "local",
    executor: "local://worker",
    sequence: ["Execute", "Verify"],
    expectedOutcome: "The objective is satisfied",
    expectedCostCents: 0,
    evidence: [],
  };
}

describe("P-023 terminal learning idempotence", () => {
  it("does not duplicate terminal resolution or re-apply assumption learning on replay", () => {
    const db = prepareDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const pathCandidate = candidate();
      const selected = engine.selectCandidate(pathCandidate);

      engine.recordSuccess({
        candidate: pathCandidate,
        pathId: selected.path.id,
        markPathSucceeded: false,
        observations: ["Execution step completed"],
      });

      engine.completePath(selected.path.id, ["Expected outcome observed"]);
      const firstAssumption = engine.store.listAssumptions("goal-1", selected.path.id)[0];
      expect(firstAssumption?.status).toBe("validated");
      expect(engine.store.getPath(selected.path.id)?.status).toBe("succeeded");

      engine.completePath(selected.path.id, ["Replay of the same terminal observation"]);

      const resolutions = getEvidenceByAuthority(db, "adaptive_path", selected.path.id)
        .filter((event) => event.eventType === "adaptive.prediction_resolved");
      expect(resolutions).toHaveLength(1);
      expect(engine.store.getPath(selected.path.id)?.status).toBe("succeeded");

      const replayedAssumption = engine.store.listAssumptions("goal-1", selected.path.id)[0];
      expect(replayedAssumption?.status).toBe("validated");
      expect(replayedAssumption?.confidence).toBe(firstAssumption?.confidence);
    } finally {
      db.close();
    }
  });
});