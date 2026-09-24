import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATION_V12 } from "../state/schema.js";
import { AdaptiveStore } from "../intelligence/store.js";
import { AdaptivePathEngine } from "../intelligence/adaptive-engine.js";
import { getEvidenceByCorrelation } from "../observability/evidence.js";

function prepareDb(filename = ":memory:"): Database.Database {
  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  db.exec(`
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
  db.exec(MIGRATION_V12);
  db.prepare(
    "INSERT OR IGNORE INTO goals (id, title, description, created_at) VALUES (?, ?, ?, ?)",
  ).run("goal-1", "Goal 1", "World-model test", new Date().toISOString());
  db.prepare(
    "INSERT OR IGNORE INTO goals (id, title, description, created_at) VALUES (?, ?, ?, ?)",
  ).run("goal-2", "Goal 2", "Isolation test", new Date().toISOString());
  return db;
}

describe("P-022 world beliefs", () => {
  it("keeps competing beliefs and preserves uncalibrated UNKNOWN as first-class state", () => {
    const db = prepareDb();
    try {
      const engine = new AdaptivePathEngine(db);
      engine.store.recordBelief({
        goalId: "goal-1",
        key: "provider.reachable",
        value: "likely",
        epistemicStatus: "inference",
        confidence: 0.7,
        source: "probe-a",
        evidenceRefs: ["evidence:a"],
        falsificationConditions: ["direct probe returns timeout"],
      });
      engine.store.recordBelief({
        goalId: "goal-1",
        key: "provider.reachable",
        value: "unknown",
        epistemicStatus: "unknown",
        confidence: null,
        source: "probe-b",
        evidenceRefs: ["evidence:b"],
        falsificationConditions: ["authenticated health check succeeds"],
      });

      const active = engine.store.listActiveBeliefs("goal-1", {
        key: "provider.reachable",
      });
      expect(active).toHaveLength(2);
      expect(active.map((belief) => belief.value).sort()).toEqual(["likely", "unknown"]);
      expect(active.find((belief) => belief.value === "unknown")?.confidence).toBeNull();

      const snapshot = engine.possibilities.snapshot("goal-1");
      expect(snapshot.beliefs).toHaveLength(2);
      expect(snapshot.unknownCount).toBeGreaterThanOrEqual(1);

      const context = engine.buildPlannerContext("goal-1");
      expect(context).toContain("Active world beliefs and competing hypotheses");
      expect(context).toContain("provider.reachable=likely");
      expect(context).toContain("provider.reachable=unknown");
      expect(context).toContain("confidence=uncalibrated");
      expect(context).toContain("direct probe returns timeout");
    } finally {
      db.close();
    }
  });

  it("excludes expired beliefs from current world state without deleting history", () => {
    const db = prepareDb();
    try {
      const store = new AdaptiveStore(db);
      const belief = store.recordBelief({
        goalId: "goal-1",
        key: "credential.valid",
        value: "true",
        epistemicStatus: "observation",
        confidence: 1,
        source: "credential-probe",
        expiresAt: "2025-01-01T00:00:00.000Z",
      });

      expect(store.listActiveBeliefs("goal-1")).toEqual([]);
      expect(store.listBeliefs("goal-1")).toEqual([
        expect.objectContaining({ id: belief.id, lifecycleStatus: "active" }),
      ]);
    } finally {
      db.close();
    }
  });

  it("invalidates and supersedes claims while retaining durable history", () => {
    const db = prepareDb();
    try {
      const store = new AdaptiveStore(db);
      const first = store.recordBelief({
        goalId: "goal-1",
        key: "network.state",
        value: "degraded",
        epistemicStatus: "estimate",
        confidence: 0.6,
        source: "telemetry-a",
      });
      const second = store.recordBelief({
        goalId: "goal-1",
        key: "network.state",
        value: "healthy",
        epistemicStatus: "observation",
        confidence: 1,
        source: "telemetry-b",
        evidenceRefs: ["evidence:health-check"],
        invalidateBeliefIds: [first.id],
      });

      expect(store.getBelief(first.id)).toEqual(
        expect.objectContaining({
          lifecycleStatus: "invalidated",
          invalidationReason: "Contradicted by a newer world-model update.",
          evidenceRefs: ["evidence:health-check"],
        }),
      );
      expect(store.listActiveBeliefs("goal-1", { key: "network.state" }))
        .toEqual([expect.objectContaining({ id: second.id, value: "healthy" })]);

      store.supersedeBelief(second.id, "New telemetry epoch started", ["evidence:new-epoch"]);
      expect(store.listActiveBeliefs("goal-1", { key: "network.state" })).toEqual([]);
      expect(store.listBeliefs("goal-1", "network.state")).toHaveLength(2);
      expect(store.getBelief(second.id)?.lifecycleStatus).toBe("superseded");
    } finally {
      db.close();
    }
  });

  it("correlates belief lifecycle in Evidence Fabric without copying canonical key/value", () => {
    const db = prepareDb();
    try {
      const store = new AdaptiveStore(db);
      const secretValue = "canonical-only-belief-value-p022";
      const belief = store.recordBelief({
        goalId: "goal-1",
        key: "provider.mode",
        value: secretValue,
        epistemicStatus: "inference",
        confidence: null,
        source: "world-model-test",
        evidenceRefs: ["evidence:1"],
      });
      store.invalidateBelief(belief.id, "Discriminating evidence arrived", ["evidence:2"]);

      const events = getEvidenceByCorrelation(db, "goal:goal-1")
        .filter((event) => event.authorityType === "adaptive_world_belief");
      expect(events.map((event) => event.eventType)).toEqual([
        "adaptive.world_belief_recorded",
        "adaptive.world_belief_status_changed",
      ]);
      expect(events.every((event) => event.authorityId === belief.id)).toBe(true);
      expect(events[0]?.epistemicStatus).toBe("inference");
      expect(JSON.stringify(events)).not.toContain("provider.mode");
      expect(JSON.stringify(events)).not.toContain(secretValue);
      expect(store.getBelief(belief.id)?.value).toBe(secretValue);
    } finally {
      db.close();
    }
  });

  it("rolls back a new claim when a requested cross-goal transition is invalid", () => {
    const db = prepareDb();
    try {
      const store = new AdaptiveStore(db);
      const goalOneBelief = store.recordBelief({
        goalId: "goal-1",
        key: "scope",
        value: "goal-one",
        epistemicStatus: "observation",
        source: "scope-test",
      });

      expect(() => store.recordBelief({
        goalId: "goal-2",
        key: "scope",
        value: "goal-two",
        epistemicStatus: "inference",
        source: "scope-test",
        invalidateBeliefIds: [goalOneBelief.id],
      })).toThrow("Cannot transition belief across goals");

      expect(store.listBeliefs("goal-2")).toEqual([]);
      expect(store.getBelief(goalOneBelief.id)?.lifecycleStatus).toBe("active");
    } finally {
      db.close();
    }
  });

  it("survives database restart with nullable confidence and lifecycle intact", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p022-world-model-"));
    const dbPath = path.join(dir, "state.db");
    let beliefId = "";

    try {
      {
        const db = prepareDb(dbPath);
        const store = new AdaptiveStore(db);
        const belief = store.recordBelief({
          goalId: "goal-1",
          key: "external.state",
          value: "unknown",
          epistemicStatus: "unknown",
          confidence: null,
          source: "restart-test",
          falsificationConditions: ["authoritative API returns a value"],
        });
        beliefId = belief.id;
        db.close();
      }

      {
        const db = prepareDb(dbPath);
        const store = new AdaptiveStore(db);
        expect(store.getBelief(beliefId)).toEqual(
          expect.objectContaining({
            id: beliefId,
            epistemicStatus: "unknown",
            confidence: null,
            lifecycleStatus: "active",
            falsificationConditions: ["authoritative API returns a value"],
          }),
        );
        db.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects fabricated confidence and malformed temporal inputs before persistence", () => {
    const db = prepareDb();
    try {
      const store = new AdaptiveStore(db);
      expect(() => store.recordBelief({
        goalId: "goal-1",
        key: "invalid.confidence",
        value: "x",
        epistemicStatus: "estimate",
        confidence: 1.1,
        source: "validation-test",
      })).toThrow("belief confidence must be between 0 and 1");

      expect(() => store.recordBelief({
        goalId: "goal-1",
        key: "invalid.time",
        value: "x",
        epistemicStatus: "estimate",
        source: "validation-test",
        expiresAt: "not-a-timestamp",
      })).toThrow("expiresAt must be a valid timestamp");

      expect(store.listBeliefs("goal-1")).toEqual([]);
    } finally {
      db.close();
    }
  });
});
