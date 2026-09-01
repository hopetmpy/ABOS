import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  CREATE_TABLES,
  MIGRATION_V9,
  MIGRATION_V10,
  MIGRATION_V12,
  MIGRATION_V13,
} from "../state/schema.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentRetentionCoordinator } from "../environments/retention.js";
import type { EnvironmentProvider } from "../environments/types.js";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  db.exec(MIGRATION_V9);
  db.exec(MIGRATION_V10);
  db.exec(MIGRATION_V12);
  db.exec(MIGRATION_V13);
  return db;
}

function insertGoal(
  db: Database.Database,
  id: string,
  status: "active" | "completed" | "failed" = "active",
) {
  db.prepare(
    "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, id, "fixture", status, new Date().toISOString());
}

function insertTask(
  db: Database.Database,
  id: string,
  goalId: string,
  status: string,
) {
  db.prepare(
    "INSERT INTO task_graph (id, goal_id, title, description, status, priority, dependencies, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    goalId,
    id,
    "fixture",
    status,
    50,
    "[]",
    new Date().toISOString(),
  );
}

function provider(
  overrides: Partial<EnvironmentProvider> = {},
): EnvironmentProvider {
  return {
    id: "cloud",
    inspect: async () => ({
      id: "cloud",
      label: "Cloud",
      availability: "available",
      capabilities: [],
      evidence: [],
      constraints: [],
      observedAt: new Date().toISOString(),
    }),
    destroy: async () => ({
      status: "terminated",
      providerState: "terminated",
      evidence: ["destroyed"],
    }),
    reconcile: async (resource) => ({
      resource: {
        ...resource,
        status: "running",
        providerState: "running",
        updatedAt: new Date().toISOString(),
      },
      actualExists: true,
      action: "refresh",
      evidence: ["provider still observes resource"],
    }),
    ...overrides,
  };
}

describe("EnvironmentRetentionCoordinator", () => {
  it("releases until_goal_complete resources only after the owning Goal settles", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-1", "active");
      const registry = new EnvironmentRegistry();
      let destroys = 0;
      registry.register(provider({
        destroy: async () => {
          destroys += 1;
          return {
            status: "terminated",
            providerState: "terminated",
            evidence: ["destroyed"],
          };
        },
      }));

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "vm-1",
        type: "compute",
        goalId: "goal-1",
        status: "running",
        retentionPolicy: "until_goal_complete",
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );

      const active = await retention.sweep();
      expect(active.releaseEligible).toBe(0);
      expect(destroys).toBe(0);

      db.prepare("UPDATE goals SET status = 'completed' WHERE id = ?")
        .run("goal-1");

      const completed = await retention.sweep();
      expect(completed.releaseEligible).toBe(1);
      expect(completed.destroyAttempts).toBe(1);
      expect(completed.released).toBe(1);
      expect(destroys).toBe(1);
      expect(
        lifecycle.resources.list({ includeTerminated: true })[0]?.status,
      ).toBe("terminated");
    } finally {
      db.close();
    }
  });

  it("suspends instead of destroying a terminal resource with uncollected remote artifacts", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-artifacts", "completed");
      const registry = new EnvironmentRegistry();
      let suspends = 0;
      let destroys = 0;
      registry.register(provider({
        suspend: async () => {
          suspends += 1;
          return {
            status: "suspended",
            providerState: "stopped",
            evidence: ["compute suspended"],
          };
        },
        destroy: async () => {
          destroys += 1;
          return {
            status: "terminated",
            providerState: "terminated",
          };
        },
      }));

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      const owned = lifecycle.adopt({
        provider: "cloud",
        externalId: "vm-artifacts",
        type: "compute",
        goalId: "goal-artifacts",
        status: "running",
        retentionPolicy: "until_goal_complete",
        metadata: {
          remoteArtifacts: ["/opt/abos/output.txt", "file:///tmp/also-local.txt"],
          artifactCollectionState: "pending",
          executorAddress: "cloud://vm-artifacts",
        },
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );

      const first = await retention.sweep();
      expect(first.releaseEligible).toBe(1);
      expect(first.artifactHolds).toBe(1);
      expect(first.released).toBe(0);
      expect(suspends).toBe(1);
      expect(destroys).toBe(0);

      const held = lifecycle.resources.get(owned.id);
      expect(held?.status).toBe("suspended");
      expect(held?.metadata.retentionReleaseState).toBe("artifact_hold");

      const second = await retention.sweep();
      expect(second.artifactHolds).toBe(1);
      expect(suspends).toBe(1);
      expect(destroys).toBe(0);
    } finally {
      db.close();
    }
  });

  it("releases a failed ephemeral resource even while its Task is still pending", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-pending", "active");
      insertTask(db, "task-pending", "goal-pending", "pending");

      const registry = new EnvironmentRegistry();
      let destroys = 0;
      registry.register(provider({
        destroy: async () => {
          destroys += 1;
          return {
            status: "terminated",
            providerState: "terminated",
            evidence: ["failed candidate cleaned up"],
          };
        },
      }));

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "vm-failed-candidate",
        type: "compute",
        goalId: "goal-pending",
        taskId: "task-pending",
        status: "failed",
        retentionPolicy: "ephemeral",
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );
      const sweep = await retention.sweep();

      expect(sweep.releaseEligible).toBe(1);
      expect(sweep.destroyAttempts).toBe(1);
      expect(sweep.released).toBe(1);
      expect(destroys).toBe(1);
      expect(
        lifecycle.resources.list({ includeTerminated: true })[0]?.status,
      ).toBe("terminated");
    } finally {
      db.close();
    }
  });

  it("retires the legacy child row when a provider-neutral executor is released", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-legacy", "completed");
      db.prepare(
        `INSERT INTO children (
          id, name, address, sandbox_id, genesis_prompt,
          funded_amount_cents, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "child-aws",
        "aws-worker",
        "aws://ec2/i-legacy",
        "i-legacy",
        "Role: generalist",
        0,
        "healthy",
        new Date().toISOString(),
      );

      const registry = new EnvironmentRegistry();
      registry.register(provider());
      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "i-legacy",
        type: "compute",
        goalId: "goal-legacy",
        status: "running",
        retentionPolicy: "until_goal_complete",
        metadata: {
          executorAddress: "aws://ec2/i-legacy",
        },
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );
      const sweep = await retention.sweep();

      expect(sweep.released).toBe(1);
      const child = db.prepare(
        "SELECT status FROM children WHERE id = ?",
      ).get("child-aws") as { status: string };
      expect(child.status).toBe("cleaned_up");
    } finally {
      db.close();
    }
  });

  it("releases ephemeral resources when their owning Task settles even if the Goal remains active", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-1", "active");
      insertTask(db, "task-1", "goal-1", "completed");

      const registry = new EnvironmentRegistry();
      let destroys = 0;
      registry.register(provider({
        destroy: async () => {
          destroys += 1;
          return {
            status: "terminated",
            providerState: "terminated",
          };
        },
      }));

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "vm-task",
        type: "compute",
        goalId: "goal-1",
        taskId: "task-1",
        status: "running",
        retentionPolicy: "ephemeral",
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );
      const sweep = await retention.sweep();

      expect(sweep.released).toBe(1);
      expect(destroys).toBe(1);
    } finally {
      db.close();
    }
  });

  it("observes an uncertain destroy before retrying and will not blindly repeat the same destructive condition", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-1", "completed");

      const registry = new EnvironmentRegistry();
      let destroys = 0;
      let reconciles = 0;
      registry.register(provider({
        destroy: async () => {
          destroys += 1;
          throw new Error("timeout after destroy request");
        },
        reconcile: async (resource) => {
          reconciles += 1;
          return {
            resource: {
              ...resource,
              status: "running",
              providerState: "running",
              updatedAt: new Date().toISOString(),
            },
            actualExists: true,
            action: "verified_still_running",
            evidence: ["provider verified resource still exists"],
          };
        },
      }));

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "vm-uncertain",
        type: "compute",
        goalId: "goal-1",
        status: "running",
        providerState: "running",
        retentionPolicy: "until_goal_complete",
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );

      const first = await retention.sweep();
      expect(first.destroyAttempts).toBe(1);
      expect(first.pendingObservation).toBe(1);
      expect(destroys).toBe(1);
      expect(reconciles).toBe(0);

      // New provider observation (actualExists=true) is evidence that the first
      // destructive attempt did not complete, so one new attempt is justified.
      const second = await retention.sweep();
      expect(second.destroyAttempts).toBe(1);
      expect(destroys).toBe(2);
      expect(reconciles).toBe(1);

      // The next observation is identical to the condition fingerprint used by
      // attempt #2, so the same destructive route must not be repeated.
      const third = await retention.sweep();
      expect(third.destroyAttempts).toBe(0);
      expect(third.pendingObservation).toBe(1);
      expect(destroys).toBe(2);
      expect(reconciles).toBe(2);

      const fourth = await retention.sweep();
      expect(fourth.destroyAttempts).toBe(0);
      expect(destroys).toBe(2);
      expect(reconciles).toBe(3);
    } finally {
      db.close();
    }
  });

  it("preserves an eligible resource when destroy capability is currently unavailable", async () => {
    const db = createDb();
    try {
      insertGoal(db, "goal-1", "failed");
      const registry = new EnvironmentRegistry();
      registry.register({
        id: "inspect-only",
        inspect: async () => ({
          id: "inspect-only",
          label: "Inspect only",
          availability: "available",
          capabilities: [],
          evidence: [],
          constraints: [],
          observedAt: new Date().toISOString(),
        }),
      });

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      const owned = lifecycle.adopt({
        provider: "inspect-only",
        externalId: "external-1",
        type: "compute",
        goalId: "goal-1",
        status: "running",
        retentionPolicy: "until_goal_complete",
      });

      const retention = new EnvironmentRetentionCoordinator(
        db,
        registry,
        lifecycle,
      );

      const first = await retention.sweep();
      expect(first.unavailable).toBe(1);
      expect(lifecycle.resources.get(owned.id)?.status).toBe("running");
      expect(
        lifecycle.resources.get(owned.id)?.metadata.retentionReleaseState,
      ).toBe("destroy_unavailable");

      const eventCount = lifecycle.resources.listEvents(owned.id).length;
      const second = await retention.sweep();
      expect(second.unavailable).toBe(1);
      expect(lifecycle.resources.listEvents(owned.id)).toHaveLength(eventCount);
    } finally {
      db.close();
    }
  });
});
