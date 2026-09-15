from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected block once, got {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")

replace_once(
    "src/environments/resource-store.ts",
    '''} from "./types.js";''',
    '''} from "./types.js";\nimport { appendEvidenceEvent, correlationIdFor } from "../observability/evidence.js";''',
)

old_create = '''  create(input: CreateEnvironmentResourceInput): EnvironmentResource {\n    const now = new Date().toISOString();\n    const id = input.id ?? ulid();\n    const status = input.status ?? "requested";\n\n    this.db.prepare(\n      `INSERT INTO environment_resources (\n        id, provider, external_id, type, goal_id, path_id, task_id, status,\n        region, capabilities, estimated_cost_cents, actual_cost_cents,\n        credentials_reference, retention_policy, provider_state, evidence,\n        metadata, created_at, updated_at, last_health_check\n      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,\n    ).run(\n      id,\n      input.provider,\n      input.externalId ?? null,\n      input.type,\n      input.goalId ?? null,\n      input.pathId ?? null,\n      input.taskId ?? null,\n      status,\n      input.region ?? null,\n      JSON.stringify(input.capabilities ?? []),\n      input.estimatedCostCents ?? null,\n      Math.max(0, input.actualCostCents ?? 0),\n      input.credentialsReference ?? null,\n      input.retentionPolicy ?? "until_goal_complete",\n      input.providerState ?? null,\n      JSON.stringify(input.evidence ?? []),\n      JSON.stringify(input.metadata ?? {}),\n      now,\n      now,\n    );\n\n    this.recordEvent({\n      resourceId: id,\n      provider: input.provider,\n      operation: "create",\n      fromStatus: null,\n      toStatus: status,\n      reason: "Resource ownership registered before lifecycle execution.",\n      evidence: input.evidence ?? [],\n      metadata: input.metadata ?? {},\n    });\n\n    return this.get(id)!;\n  }'''
new_create = '''  create(input: CreateEnvironmentResourceInput): EnvironmentResource {\n    const now = new Date().toISOString();\n    const id = input.id ?? ulid();\n    const status = input.status ?? "requested";\n\n    return this.db.transaction(() => {\n      this.db.prepare(\n        `INSERT INTO environment_resources (\n          id, provider, external_id, type, goal_id, path_id, task_id, status,\n          region, capabilities, estimated_cost_cents, actual_cost_cents,\n          credentials_reference, retention_policy, provider_state, evidence,\n          metadata, created_at, updated_at, last_health_check\n        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,\n      ).run(\n        id,\n        input.provider,\n        input.externalId ?? null,\n        input.type,\n        input.goalId ?? null,\n        input.pathId ?? null,\n        input.taskId ?? null,\n        status,\n        input.region ?? null,\n        JSON.stringify(input.capabilities ?? []),\n        input.estimatedCostCents ?? null,\n        Math.max(0, input.actualCostCents ?? 0),\n        input.credentialsReference ?? null,\n        input.retentionPolicy ?? "until_goal_complete",\n        input.providerState ?? null,\n        JSON.stringify(input.evidence ?? []),\n        JSON.stringify(input.metadata ?? {}),\n        now,\n        now,\n      );\n\n      this.recordEvent({\n        resourceId: id,\n        provider: input.provider,\n        operation: "create",\n        fromStatus: null,\n        toStatus: status,\n        reason: "Resource ownership registered before lifecycle execution.",\n        evidence: input.evidence ?? [],\n        metadata: input.metadata ?? {},\n      });\n\n      return this.get(id)!;\n    })();\n  }'''
replace_once("src/environments/resource-store.ts", old_create, new_create)

old_transition = '''    this.db.prepare(\n      `UPDATE environment_resources\n       SET status = ?, provider_state = COALESCE(?, provider_state),\n           evidence = ?, metadata = ?, updated_at = ?\n       WHERE id = ?`,\n    ).run(\n      toStatus,\n      options.providerState ?? null,\n      JSON.stringify(evidence),\n      JSON.stringify(metadata),\n      now,\n      id,\n    );\n\n    this.recordEvent({\n      resourceId: id,\n      provider: current.provider,\n      operation: options.operation ?? "transition",\n      fromStatus: current.status,\n      toStatus,\n      reason: options.reason ?? null,\n      evidence: options.evidence ?? [],\n      metadata: options.metadata ?? {},\n    });\n\n    return this.get(id)!;'''
new_transition = '''    return this.db.transaction(() => {\n      this.db.prepare(\n        `UPDATE environment_resources\n         SET status = ?, provider_state = COALESCE(?, provider_state),\n             evidence = ?, metadata = ?, updated_at = ?\n         WHERE id = ?`,\n      ).run(\n        toStatus,\n        options.providerState ?? null,\n        JSON.stringify(evidence),\n        JSON.stringify(metadata),\n        now,\n        id,\n      );\n\n      this.recordEvent({\n        resourceId: id,\n        provider: current.provider,\n        operation: options.operation ?? "transition",\n        fromStatus: current.status,\n        toStatus,\n        reason: options.reason ?? null,\n        evidence: options.evidence ?? [],\n        metadata: options.metadata ?? {},\n      });\n\n      return this.get(id)!;\n    })();'''
replace_once("src/environments/resource-store.ts", old_transition, new_transition)

old_mutation = '''    this.upsert(next);\n    this.recordEvent({\n      resourceId: id,\n      provider: current.provider,\n      operation,\n      fromStatus: current.status,\n      toStatus: nextStatus,\n      reason: reason ?? null,\n      evidence: patch.evidence ?? [],\n      metadata: patch.metadata ?? {},\n    });\n    return this.get(id)!;'''
new_mutation = '''    return this.db.transaction(() => {\n      this.upsert(next);\n      this.recordEvent({\n        resourceId: id,\n        provider: current.provider,\n        operation,\n        fromStatus: current.status,\n        toStatus: nextStatus,\n        reason: reason ?? null,\n        evidence: patch.evidence ?? [],\n        metadata: patch.metadata ?? {},\n      });\n      return this.get(id)!;\n    })();'''
replace_once("src/environments/resource-store.ts", old_mutation, new_mutation)

old_record = '''  private recordEvent(input: {\n    resourceId: string;\n    provider: string;\n    operation: string;\n    fromStatus: EnvironmentResourceStatus | null;\n    toStatus: EnvironmentResourceStatus | null;\n    reason: string | null;\n    evidence: string[];\n    metadata: Record<string, unknown>;\n  }): void {\n    this.db.prepare(\n      `INSERT INTO environment_resource_events (\n        id, resource_id, provider, operation, from_status, to_status,\n        reason, evidence, metadata, created_at\n      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n    ).run(\n      ulid(),\n      input.resourceId,\n      input.provider,\n      input.operation,\n      input.fromStatus,\n      input.toStatus,\n      input.reason,\n      JSON.stringify(input.evidence),\n      JSON.stringify(input.metadata),\n      new Date().toISOString(),\n    );\n  }'''
new_record = '''  private recordEvent(input: {\n    resourceId: string;\n    provider: string;\n    operation: string;\n    fromStatus: EnvironmentResourceStatus | null;\n    toStatus: EnvironmentResourceStatus | null;\n    reason: string | null;\n    evidence: string[];\n    metadata: Record<string, unknown>;\n  }): string {\n    const eventId = ulid();\n    this.db.prepare(\n      `INSERT INTO environment_resource_events (\n        id, resource_id, provider, operation, from_status, to_status,\n        reason, evidence, metadata, created_at\n      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n    ).run(\n      eventId,\n      input.resourceId,\n      input.provider,\n      input.operation,\n      input.fromStatus,\n      input.toStatus,\n      input.reason,\n      JSON.stringify(input.evidence),\n      JSON.stringify(input.metadata),\n      new Date().toISOString(),\n    );\n\n    const resource = this.get(input.resourceId);\n    const correlationId = resource?.goalId\n      ? correlationIdFor("goal", resource.goalId)\n      : correlationIdFor("environment_resource", input.resourceId);\n    appendEvidenceEvent(this.db, {\n      correlationId,\n      causationId: resource?.pathId\n        ? correlationIdFor("adaptive_path", resource.pathId)\n        : null,\n      eventType: "environment.resource_event",\n      domain: "environment",\n      authorityType: "environment_resource_event",\n      authorityId: eventId,\n      goalId: resource?.goalId ?? null,\n      taskId: resource?.taskId ?? null,\n      epistemicStatus: "observation",\n      payload: {\n        resourceId: input.resourceId,\n        provider: input.provider,\n        operation: input.operation,\n        fromStatus: input.fromStatus,\n        toStatus: input.toStatus,\n      },\n      provenance: { source: "environment_resource_events" },\n    });\n    return eventId;\n  }'''
replace_once("src/environments/resource-store.ts", old_record, new_record)

(ROOT / "src/__tests__/p013-environment-correlation.test.ts").write_text(r'''import { afterEach, describe, expect, it } from "vitest";
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
      const resource = store.create({
        id: "env-p013",
        provider: "test-provider",
        externalId: "provider-resource-1",
        type: "sandbox",
        goalId: "goal-p013-env",
        pathId: "path-p013-env",
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
      expect(evidence.every((event) => event.causationId === "adaptive_path:path-p013-env")).toBe(true);

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
        goalId: "goal-p013-env-rollback",
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
''', encoding="utf-8")

print("P013_ENVIRONMENT_APPLY: PASS")
