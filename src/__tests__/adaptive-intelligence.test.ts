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
    expect(
      classifyFailure("assumption invalid: authentication is not valid").classification,
    ).toBe("assumption_invalid");
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

  it("keeps a strategic path executing during a justified transient retry", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const decision = engine.recordFailure({
        candidate: candidate(),
        error: "ETIMEDOUT contacting provider",
        conditions: { network: "degraded" },
      });

      expect(decision.action).toBe("technical_retry");
      expect(decision.attempt.retryEligible).toBe(true);
      expect(engine.store.getPath(decision.path.id)?.status).toBe("executing");
    } finally {
      db.close();
    }
  });

  it("marks a capability-missing path blocked rather than impossible", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const decision = engine.recordFailure({
        candidate: candidate(),
        error: "command not found: terraform",
      });

      expect(decision.action).toBe("acquire_capability");
      expect(engine.store.getPath(decision.path.id)?.status).toBe("blocked");
    } finally {
      db.close();
    }
  });

  it("attaches task attempts to the originating strategic path when a binding supplies pathId", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const strategic = engine.selectCandidate(
        candidate({
          taskId: null,
          strategy: "Strategic route A",
          sequence: ["Task A", "Task B"],
        }),
        { environment: "local" },
      );

      engine.store.setPathStatus(strategic.path.id, "executing");

      const taskCandidate = candidate({
        taskId: "task-bound-1",
        strategy: "Task A execution",
        sequence: ["Execute Task A"],
      });

      const decision = engine.recordFailure({
        candidate: taskCandidate,
        pathId: strategic.path.id,
        error: "The task implementation produced an invalid result",
        conditions: { environment: "local" },
      });

      expect(decision.path.id).toBe(strategic.path.id);
      expect(engine.store.listPaths("goal-1")).toHaveLength(1);
      expect(decision.attempt.pathId).toBe(strategic.path.id);
      expect(engine.store.getPath(strategic.path.id)?.status).toBe("failed");
    } finally {
      db.close();
    }
  });

  it("does not mark a multi-task strategic path succeeded until explicit path completion", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const strategic = engine.selectCandidate(
        candidate({
          taskId: null,
          strategy: "Multi-task route",
          sequence: ["Task A", "Task B"],
        }),
      );
      engine.store.setPathStatus(strategic.path.id, "executing");

      engine.recordSuccess({
        candidate: candidate({
          taskId: "task-bound-1",
          strategy: "Task A",
          sequence: ["Task A"],
        }),
        pathId: strategic.path.id,
        markPathSucceeded: false,
        observations: ["Task A complete"],
      });

      expect(engine.store.getPath(strategic.path.id)?.status).toBe("executing");

      engine.completePath(strategic.path.id, ["All route tasks complete"]);
      expect(engine.store.getPath(strategic.path.id)?.status).toBe("succeeded");
    } finally {
      db.close();
    }
  });

  it("tracks assumptions and validates them when a path succeeds", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      engine.recordSuccess({
        candidate: candidate({ assumptions: ["Credentials are valid", "Provider is reachable"] }),
        evidence: ["validated response"],
        conditions: { credentialVersion: 1 },
      });

      const assumptions = engine.store.listAssumptions("goal-1");
      expect(assumptions).toHaveLength(2);
      expect(assumptions.every((entry) => entry.status === "validated")).toBe(true);
      expect(assumptions.every((entry) => entry.evidence.includes("validated response"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("invalidates a matched assumption when failure evidence contradicts it", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      engine.recordFailure({
        candidate: candidate({ assumptions: ["Provider authentication is valid"] }),
        error: "assumption invalid: authentication is not valid",
        evidence: ["401 from provider"],
      });

      const assumptions = engine.store.listAssumptions("goal-1");
      expect(assumptions[0]?.status).toBe("invalidated");
      expect(assumptions[0]?.evidence.join(" ")).toContain("authentication");
    } finally {
      db.close();
    }
  });

  it("persists typed evidence linked to the exact failed attempt", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      const decision = engine.recordFailure({
        candidate: candidate(),
        error: "ETIMEDOUT contacting provider",
        observations: ["request started"],
        evidence: ["artifact://trace/123"],
        learnedFacts: [{ key: "provider.reachable", value: "unknown", confidence: 0.6 }],
        conditions: { network: "degraded" },
      });

      const evidence = engine.store.listEvidence("goal-1", {
        attemptId: decision.attempt.id,
      });

      expect(evidence.every((entry) => entry.pathId === decision.path.id)).toBe(true);
      expect(evidence.map((entry) => entry.kind).sort()).toEqual([
        "artifact",
        "condition",
        "error",
        "fact",
        "observation",
      ]);
      expect(evidence.find((entry) => entry.kind === "error")?.content)
        .toContain("ETIMEDOUT");
      expect(evidence.find((entry) => entry.kind === "fact")?.confidence).toBe(0.6);
    } finally {
      db.close();
    }
  });

  it("persists success observations, artifacts, and runtime conditions as evidence", () => {
    const db = memoryDb();
    try {
      const engine = new AdaptivePathEngine(db);
      engine.recordSuccess({
        candidate: candidate(),
        observations: ["provider returned 200"],
        evidence: ["artifact://response/200"],
        conditions: { credentialVersion: 2 },
      });

      const evidence = engine.store.listEvidence("goal-1");
      expect(evidence.map((entry) => entry.kind).sort()).toEqual([
        "artifact",
        "condition",
        "observation",
      ]);
      expect(evidence.every((entry) => !!entry.attemptId)).toBe(true);
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
