import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  CREATE_TABLES,
  MIGRATION_V9,
  MIGRATION_V10,
  MIGRATION_V12,
  MIGRATION_V13,
} from "../state/schema.js";
import {
  EnvironmentLifecycleManager,
  EnvironmentOperationUnavailableError,
} from "../environments/lifecycle.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
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

describe("Environment Execution & Lifecycle v2", () => {
  it("persists ownership before provisioning and records lifecycle evidence", async () => {
    const db = createDb();
    try {
      const registry = new EnvironmentRegistry();
      const provider: EnvironmentProvider = {
        id: "test-cloud",
        inspect: async () => ({
          id: "test-cloud",
          label: "Test Cloud",
          availability: "available",
          capabilities: [],
          evidence: [],
          constraints: [],
          observedAt: new Date().toISOString(),
        }),
        provision: async (request) => ({
          externalId: `ext-${request.resourceId}`,
          type: request.resourceType,
          status: "ready",
          region: request.region,
          capabilities: request.requiredCapabilities,
          estimatedCostCents: 25,
          evidence: ["provider created resource"],
        }),
        health: async () => ({
          healthy: true,
          status: "running",
          evidence: ["health ok"],
        }),
        destroy: async () => ({
          status: "terminated",
          evidence: ["destroyed"],
        }),
      };
      registry.register(provider);

      const store = new EnvironmentResourceStore(db);
      const lifecycle = new EnvironmentLifecycleManager(registry, store);

      const resource = await lifecycle.provision("test-cloud", {
        resourceType: "linux-compute",
        retentionPolicy: "until_goal_complete",
        requiredCapabilities: ["linux", "remote compute"],
        region: "test-region",
      });

      expect(resource.provider).toBe("test-cloud");
      expect(resource.externalId).toMatch(/^ext-/);
      expect(resource.status).toBe("ready");
      expect(resource.estimatedCostCents).toBe(25);

      const events = store.listEvents(resource.id);
      expect(events.map((event) => event.operation)).toEqual([
        "create",
        "provision",
        "provision",
      ]);
      expect(events[0]?.toStatus).toBe("requested");
      expect(events[1]?.toStatus).toBe("provisioning");
      expect(events[2]?.toStatus).toBe("ready");

      const healthy = await lifecycle.health(resource.id);
      expect(healthy.status).toBe("running");
      expect(healthy.lastHealthCheck).not.toBeNull();

      const terminated = await lifecycle.destroy(resource.id);
      expect(terminated.status).toBe("terminated");
      expect(store.list()).toHaveLength(0);
      expect(store.list({ includeTerminated: true })).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("reports unsupported provider operation as unavailable, not impossible", async () => {
    const db = createDb();
    try {
      const registry = new EnvironmentRegistry();
      registry.register({
        id: "inspect-only",
        operations: ["provider_native_future_op"],
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

      expect(registry.getSupportedOperations("inspect-only")).toContain(
        "provider_native_future_op",
      );

      const promise = lifecycle.provision("inspect-only", {
        resourceType: "compute",
        retentionPolicy: "ephemeral",
        requiredCapabilities: [],
      });
      await expect(promise).rejects.toBeInstanceOf(
        EnvironmentOperationUnavailableError,
      );

      try {
        await lifecycle.provision("inspect-only", {
          resourceType: "compute",
          retentionPolicy: "ephemeral",
          requiredCapabilities: [],
        });
      } catch (error) {
        expect((error as Error).message.toLowerCase()).toContain("not proof");
        expect((error as Error).message.toLowerCase()).toContain("impossible");
      }
    } finally {
      db.close();
    }
  });

  it("adopts an already-existing external resource without recreating it", () => {
    const db = createDb();
    try {
      const lifecycle = new EnvironmentLifecycleManager(
        new EnvironmentRegistry(),
        new EnvironmentResourceStore(db),
      );

      const first = lifecycle.adopt({
        provider: "future-provider",
        externalId: "external-123",
        type: "compute",
        status: "running",
        capabilities: ["linux"],
      });
      const second = lifecycle.adopt({
        provider: "future-provider",
        externalId: "external-123",
        type: "compute",
        goalId: "goal-2",
        pathId: "path-2",
        taskId: "task-2",
        status: "running",
        capabilities: ["browser"],
        evidence: ["reused for a new execution"],
      });

      expect(second.id).toBe(first.id);
      expect(second.goalId).toBe("goal-2");
      expect(second.pathId).toBe("path-2");
      expect(second.taskId).toBe("task-2");
      expect(second.capabilities).toEqual(expect.arrayContaining(["linux", "browser"]));
      expect(lifecycle.resources.listEvents(second.id).map((event) => event.operation)).toContain("adopt");
      expect(lifecycle.resources.list({ includeTerminated: true })).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("keeps destructive failure observable instead of pretending cleanup succeeded", async () => {
    const db = createDb();
    try {
      const registry = new EnvironmentRegistry();
      registry.register({
        id: "uncertain-cloud",
        inspect: async () => ({
          id: "uncertain-cloud",
          label: "Uncertain Cloud",
          availability: "available",
          capabilities: [],
          evidence: [],
          constraints: [],
          observedAt: new Date().toISOString(),
        }),
        destroy: async () => {
          throw new Error("provider timeout after destroy request");
        },
      });
      const store = new EnvironmentResourceStore(db);
      const lifecycle = new EnvironmentLifecycleManager(registry, store);
      const resource = lifecycle.adopt({
        provider: "uncertain-cloud",
        externalId: "r-1",
        type: "compute",
        status: "running",
      });

      const after = await lifecycle.destroy(resource.id);
      expect(after.status).toBe("unknown");
      expect(after.evidence.join(" ")).toContain("provider timeout");
    } finally {
      db.close();
    }
  });
});
