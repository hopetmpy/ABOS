import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../state/database.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { getEvidenceByCorrelation } from "../observability/evidence.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p013-environment-"));
  roots.push(root);
  const db = createDatabase(path.join(root, "state.db"));
  return { db, store: new EnvironmentResourceStore(db.raw) };
}

describe("P-013 environment correlation", () => {
  it("references canonical environment events without copying sensitive domain payload", () => {
    const { db, store } = setup();
    try {
      const now = new Date().toISOString();
      db.raw.prepare(
        "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, 'active', ?)",
      ).run("goal-p013-env", "Environment correlation", "P-013 fixture", now);
      db.raw.prepare(
        "INSERT INTO task_graph (id, goal_id, title, description, status, priority, dependencies, created_at) VALUES (?, ?, ?, ?, 'pending', 50, '[]', ?)",
      ).run("task-p013-env", "goal-p013-env", "Environment task", "P-013 fixture", now);

      const resource = store.create({
        id: "env-p013",
        provider: "test-provider",
        externalId: "provider-resource-1",
        type: "sandbox",
        goalId: "goal-p013-env",
        taskId: "task-p013-env",
        credentialsReference: "credential-ref-sensitive-p013",
        evidence: ["sensitive-domain-evidence-p013"],
        metadata: { accessToken: "sensitive-metadata-token-p013" },
      });
      expect(resource.status).toBe("requested");

      store.transition(resource.id, "ready", {
        operation: "provision",
        reason: "sensitive-reason-p013",
        evidence: ["sensitive-transition-evidence-p013"],
        metadata: { privateNote: "sensitive-private-note-p013" },
      });

      const domainEvents = store.listEvents(resource.id);
      expect(domainEvents).toHaveLength(2);

      const evidence = getEvidenceByCorrelation(db.raw, "goal:goal-p013-env");
      expect(evidence).toHaveLength(2);
      expect(evidence.every((event) => event.eventType === "environment.resource_event")).toBe(true);
      expect(evidence.every((event) => event.authorityType === "environment_resource_event")).toBe(true);
      expect(evidence.map((event) => event.authorityId)).toEqual(domainEvents.map((event) => event.id));
      expect(evidence.every((event) => event.taskId === "task-p013-env")).toBe(true);
      expect(evidence.every((event) => event.causationId === null)).toBe(true);

      const serialized = JSON.stringify(evidence);
      for (const secret of [
        "credential-ref-sensitive-p013",
        "sensitive-domain-evidence-p013",
        "sensitive-metadata-token-p013",
        "sensitive-reason-p013",
        "sensitive-transition-evidence-p013",
        "sensitive-private-note-p013",
      ]) {
        expect(serialized).not.toContain(secret);
      }
    } finally {
      db.close();
    }
  });

  it("rolls back resource state and domain event when the causal evidence reference cannot commit", () => {
    const { db, store } = setup();
    try {
      const resource = store.create({
        id: "env-p013-rollback",
        provider: "test-provider",
        type: "sandbox",
      });
      expect(store.listEvents(resource.id)).toHaveLength(1);

      db.raw.exec(`
        CREATE TRIGGER reject_environment_causal_event
        BEFORE INSERT ON evidence_events
        WHEN NEW.event_type = 'environment.resource_event'
        BEGIN
          SELECT RAISE(ABORT, 'intentional environment evidence failure');
        END;
      `);

      expect(() => store.transition(resource.id, "ready", {
        operation: "provision",
      })).toThrow("intentional environment evidence failure");

      expect(store.get(resource.id)?.status).toBe("requested");
      expect(store.listEvents(resource.id)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("uses resource identity as a durable correlation root when no goal exists", () => {
    const { db, store } = setup();
    try {
      const resource = store.create({
        id: "env-p013-standalone",
        provider: "test-provider",
        type: "sandbox",
      });
      const evidence = getEvidenceByCorrelation(
        db.raw,
        "environment_resource:env-p013-standalone",
      );
      expect(evidence).toHaveLength(1);
      expect(evidence[0].authorityId).toBe(store.listEvents(resource.id)[0].id);
    } finally {
      db.close();
    }
  });
});
