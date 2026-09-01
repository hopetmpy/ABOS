import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATION_V12 } from "../state/schema.js";
import { pathSignature } from "../intelligence/path-signature.js";
import { assessPathNovelty } from "../intelligence/novelty.js";
import { classifyFailure } from "../intelligence/failure-classifier.js";
import { AdaptivePathEngine } from "../intelligence/adaptive-engine.js";
import type { PathCandidate, PersistedPath } from "../intelligence/types.js";

function candidate(overrides: Partial<PathCandidate> = {}): PathCandidate {
  return {
    goalId: "goal-1",
    taskId: "task-1",
    hypothesis: "Direct API access can satisfy the objective",
    strategy: "Use the provider API",
    assumptions: ["Credentials are valid"],
    requiredCapabilities: ["api"],
    environment: "local",
    executor: "local://worker",
    sequence: ["Call API", "Validate response"],
    expectedOutcome: "Provider returns the requested data",
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
  db.exec(MIGRATION_V12);
  db.prepare(
    "INSERT INTO goals (id, title, description, created_at) VALUES (?, ?, ?, ?)",
  ).run("goal-1", "Goal", "Description", new Date().toISOString());
  return db;
}

describe("adaptive path identity", () => {
  it("ignores evidence changes when identifying the conceptual path", () => {
    const first = candidate({ evidence: ["timeout"] });
    const second = candidate({ evidence: ["different observation"] });
    expect(pathSignature(first)).toBe(pathSignature(second));
  });

  it("treats a different environment as a materially different path", () => {
    expect(pathSignature(candidate({ environment: "local" })))
      .not.toBe(pathSignature(candidate({ environment: "aws" })));
  });

  it("permits an equivalent path when material conditions changed", () => {
    const path = candidate();
    const persisted: PersistedPath = {
      ...path,
      id: "path-1",
      signature: pathSignature(path),
      status: "failed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const unchanged = assessPathNovelty({
      candidate: path,
      previousPaths: [persisted],
      previousConditionFingerprints: new Map([["path-1", "conditions:none"]]),
    });
    expect(unchanged.novel).toBe(false);

    const changed = assessPathNovelty({
      candidate: path,
      previousPaths: [persisted],
      previousConditionFingerprints: new Map([["path-1", "old"]]),
      conditions: { credentials: "refreshed" },
    });
    expect(changed.novel).toBe(true);
    expect(changed.conditionChanged).toBe(true);
  });
});

describe("failure intelligence", () => {
  it("separates transient failures from strategic failures", () => {
    expect(classifyFailure("ETIMEDOUT contacting provider").classification).toBe("transient");
    expect(classifyFailure("401 Unauthorized: token expired").classification).toBe("authorization");
    expect(classifyFailure("command not found: terraform").classification).toBe("capability_missing");
    expect(classifyFailure("policy denied: forbidden operation").classification).toBe("prohibited");
    expect(classifyFailure("The proposed approach produced an invalid result").classification)
      .toBe("strategic_failure");
  });
});

describe("adaptive path persistence", () => {
  it("records evidence and blocks unchanged strategic repetition", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const first = engine.recordFailure({
        candidate: candidate(),
        error: "The proposed approach produced an invalid result",
        conditions: { credentials: "same" },
      });

      expect(first.action).toBe("explore_new_path");
      expect(first.novelty.novel).toBe(true);

      const second = engine.recordFailure({
        candidate: candidate(),
        error: "The proposed approach produced an invalid result again",
        conditions: { credentials: "same" },
      });

      expect(second.novelty.novel).toBe(false);
      expect(second.attempt.retryEligible).toBe(false);
      expect(engine.store.listAttempts("goal-1")).toHaveLength(2);
      expect(engine.store.listOpenOpportunities("goal-1").length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("allows reconsidering the same path after a material condition change", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      engine.recordFailure({
        candidate: candidate(),
        error: "401 Unauthorized: token expired",
        conditions: { credentialVersion: 1 },
      });

      const assessment = engine.isCandidateEligible(
        candidate(),
        { credentialVersion: 2 },
      );
      expect(assessment.novel).toBe(true);
      expect(assessment.conditionChanged).toBe(true);
    } finally {
      db.close();
    }
  });
});
