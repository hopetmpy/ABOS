import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  CREATE_TABLES,
  MIGRATION_V9,
  MIGRATION_V10,
  MIGRATION_V12,
  MIGRATION_V13,
  MIGRATION_V18_EVIDENCE_FABRIC,
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
  db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
  return db;
}

describe("Environment Execution & Lifecycle v2", () => {
  it("matches source-owned spare resources by Task capability and explicit instance shape", () => {
    const db = createDb();
    try {
      const inventory = new EnvironmentResourceStore(db);
      const old = inventory.create({
        provider: "provider-open", externalId: "vm-old", type: "vm",
        status: "running", region: "region-a", capabilities: ["linux", "compute"],
        metadata: { instanceType: "small" },
      });
      const matching = inventory.create({
        provider: "provider-open", externalId: "vm-match", type: "vm",
        status: "ready", region: "region-a", capabilities: ["linux", "compute"],
        metadata: { instanceType: "large" },
      });
      inventory.create({
        provider: "provider-open", externalId: "vm-unknown", type: "vm",
        status: "ready", region: "region-a", capabilities: ["linux", "compute"],
      });
      const filter = {
        provider: "provider-open", region: "region-a",
        requiredCapabilities: ["compute"], requiredInstanceType: "large",
      };
      expect(inventory.findReusableCandidates(filter).map(x => x.id)).toEqual([matching.id]);
      expect(inventory.findReusableCandidates({
        ...filter, requiredCapabilities: ["compute", "gpu"],
      })).toEqual([]);
      expect(inventory.findReusableCandidates({
        ...filter, requiredInstanceType: "small",
      }).map(x => x.id)).toEqual([old.id]);
      expect(inventory.findReusableCandidates({
        provider: "provider-open", region: "region-a",
        requiredCapabilities: ["compute"],
      })).toHaveLength(3);
    } finally {
      db.close();
    }
  });
  it("matches quantitative open-ended demand only against P-018 proven per-resource capacity", () => {
    const db = createDb();
    try {
      const store = new EnvironmentResourceStore(db);
      const small = store.create({
        provider: "cloud", externalId: "small", type: "vm", status: "ready",
        capabilities: ["compute"],
        metadata: { capacity: { cpuCores: 2, memoryMb: 1024, requestsPerSecond: 100 } },
      });
      const large = store.create({
        provider: "cloud", externalId: "large", type: "vm", status: "running",
        capabilities: ["compute"],
        metadata: { capacity: { cpuCores: 8, memoryMb: 16384, requestsPerSecond: 500 } },
      });
      store.create({
        provider: "cloud", externalId: "unknown", type: "vm",
        status: "ready", capabilities: ["compute"],
        metadata: { instanceType: "largest" },
      });
      const find = (minimumCapacity: Record<string, number>) =>
        store.findReusableCandidates({
          provider: "cloud", requiredCapabilities: ["compute"], minimumCapacity,
        }).map(x => x.id);
      expect(find({ cpuCores: 4, memoryMb: 4096 })).toEqual([large.id]);
      expect(find({ cpuCores: 2, memoryMb: 1024 })).toEqual([small.id, large.id]);
      expect(find({ requestsPerSecond: 300 })).toEqual([large.id]);
      expect(find({ requestsPerSecond: 600 })).toEqual([]);
      expect(find({ missingNewMetric: 1 })).toEqual([]);
      expect(find({ cpuCores: Number.NaN })).toEqual([]);
      expect(find({ memoryMb: -1 })).toEqual([]);
      expect(find({ memoryMb: 0 })).toEqual([]);
      // Freshly reconciled capacity shrink must invalidate the candidate.
      store.applyMutation(large.id, { metadata: { capacity: { cpuCores: 1 } } }, "capacity_reobserved");
      expect(find({ cpuCores: 4 })).toEqual([]);
    } finally { db.close(); }
  });

  it("does not promote running/provider-ready labels when independent health is false or unknown", async () => {
    const db = createDb();
    try {
      const registry = new EnvironmentRegistry();
      let healthy: boolean | null = false;
      const provider: EnvironmentProvider = {
        id: "contradictory-provider",
        inspect: async () => ({
          id: "contradictory-provider", label: "Contradictory provider",
          availability: "available", capabilities: [], constraints: [],
          evidence: [], observedAt: new Date().toISOString(),
        }),
        health: async () => ({
          healthy, status: "running", evidence: ["Provider says running; health independently unknown/unhealthy."],
        }),
      };
      registry.register(provider);
      const resources = new EnvironmentResourceStore(db);
      const resource = resources.create({
        provider: provider.id, type: "vm", externalId: "physical-instance-1",
        status: "running", capabilities: ["compute"],
      });
      const lifecycle = new EnvironmentLifecycleManager(registry, resources);
      const unhealthy = await lifecycle.health(resource.id);
      expect(unhealthy.status).toBe("degraded");
      healthy = null;
      const unknown = await lifecycle.health(resource.id);
      expect(unknown.status).toBe("unknown");
      healthy = true;
      const recovered = await lifecycle.health(resource.id);
      expect(recovered.status).toBe("running");
      expect(recovered.lastHealthCheck).not.toBeNull();
    } finally { db.close(); }
  });

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
      expect(resource.metadata.provisionNeedsReconciliation).toBe(false);

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

  it("keeps ambiguous provider provisioning unknown", async () => {
    const db = createDb();
    try {
      const registry = new EnvironmentRegistry();
      let dispatches = 0;
      registry.register({
        id: "uncertain", inspect: async () => ({
          id: "uncertain", label: "Uncertain", availability: "available",
          capabilities: [], evidence: [], constraints: [], observedAt: new Date().toISOString(),
        }),
        provision: async () => { dispatches += 1; throw new Error("provider timeout"); },
        reconcile: async (resource) => ({
          resource: { ...resource, externalId: "recovered-id", status: "running" },
          actualExists: true, action: "observed", evidence: ["provider confirmed identity"],
        }),
      });
      const life = new EnvironmentLifecycleManager(registry, new EnvironmentResourceStore(db));
      await expect(life.provision("uncertain", {
        resourceId: "r-unknown", resourceType: "compute", retentionPolicy: "ephemeral",
        requiredCapabilities: [],
      })).rejects.toThrow("provider timeout");
      expect(life.resources.get("r-unknown")?.status).toBe("unknown");
      expect(life.resources.get("r-unknown")?.metadata.provisionNeedsReconciliation).toBe(true);
      await expect(life.provision("uncertain", {
        resourceId: "r-unknown", resourceType: "compute",
        retentionPolicy: "ephemeral", requiredCapabilities: [],
      })).rejects.toThrow();
      expect(dispatches).toBe(1);
      const restarted = new EnvironmentLifecycleManager(registry, new EnvironmentResourceStore(db));
      const recovered = await restarted.reconcile("r-unknown");
      expect(recovered.status).toBe("running");
      expect(recovered.externalId).toBe("recovered-id");
      expect(recovered.metadata.provisionNeedsReconciliation).toBe(false);
    } finally { db.close(); }
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
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run("goal-2", "Goal 2", "Ownership fixture", "active", now);
      db.prepare(
        "INSERT INTO task_graph (id, goal_id, title, description, status, priority, dependencies, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run("task-2", "goal-2", "Task 2", "Ownership fixture task", "pending", 50, "[]", now);
      db.prepare(
        "INSERT INTO adaptive_paths (id, goal_id, task_id, signature, hypothesis, strategy, assumptions, required_capabilities, sequence, expected_outcome, expected_cost_cents, evidence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "path-2",
        "goal-2",
        "task-2",
        "fixture-signature",
        "Fixture hypothesis",
        "Fixture strategy",
        "[]",
        "[]",
        "[]",
        "Fixture outcome",
        0,
        "[]",
        "selected",
        now,
        now,
      );

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

  it("persists collection metadata so retention can observe artifact completion", async () => {
    const db = createDb();
    try {
      const registry = new EnvironmentRegistry();
      registry.register({
        id: "collector",
        inspect: async () => ({
          id: "collector",
          label: "collector",
          availability: "available",
          capabilities: [],
          evidence: [],
          constraints: [],
          observedAt: new Date().toISOString(),
        }),
        collect: async () => ({
          artifacts: ["/parent/materialized.txt"],
          evidence: ["artifact materialized"],
          metadata: {
            artifactCollectionState: "collected",
            remoteArtifacts: [],
            collectedArtifacts: [
              {
                remotePath: "result.txt",
                localPath: "/parent/materialized.txt",
              },
            ],
          },
        }),
      });

      const store = new EnvironmentResourceStore(db);
      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        store,
      );
      const owned = lifecycle.adopt({
        provider: "collector",
        externalId: "remote-1",
        type: "compute",
        status: "suspended",
        retentionPolicy: "manual_retention",
        metadata: {
          artifactCollectionState: "pending",
          remoteArtifacts: ["result.txt"],
        },
      });

      const result = await lifecycle.collect(owned.id);
      expect(result.artifacts).toEqual([
        "/parent/materialized.txt",
      ]);

      const persisted = store.get(owned.id);
      expect(persisted?.metadata.artifactCollectionState).toBe(
        "collected",
      );
      expect(persisted?.metadata.remoteArtifacts).toEqual([]);
      expect(
        store.listEvents(owned.id).some(
          (event) => event.operation === "collect",
        ),
      ).toBe(true);
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
