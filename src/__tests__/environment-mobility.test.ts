import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  CREATE_TABLES,
  MIGRATION_V9,
  MIGRATION_V10,
  MIGRATION_V12,
  MIGRATION_V13,
  MIGRATION_V14,
} from "../state/schema.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentSelector } from "../environments/selector.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import {
  EnvironmentExecutionBridge,
  EnvironmentTaskExecutionError,
  EnvironmentTaskExecutorRegistry,
  type EnvironmentTaskExecutionResult,
  type EnvironmentTaskSpawnOptions,
} from "../environments/task-executor.js";
import {
  EnvironmentMigrationStore,
} from "../environments/mobility-store.js";
import {
  EnvironmentMobilityCoordinator,
} from "../environments/mobility.js";
import type {
  EnvironmentProvider,
  EnvironmentSnapshot,
} from "../environments/types.js";
import type { TaskNode } from "../orchestration/task-graph.js";

function createDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(CREATE_TABLES);
  db.exec(MIGRATION_V9);
  db.exec(MIGRATION_V10);
  db.exec(MIGRATION_V12);
  db.exec(MIGRATION_V13);
  db.exec(MIGRATION_V14);
  return db;
}

function seedTaskContext(db: Database.Database) {
  const now = new Date(0).toISOString();
  db.prepare(
    `INSERT INTO goals (
      id, title, description, status, strategy,
      expected_revenue_cents, actual_revenue_cents, created_at
    ) VALUES (?, ?, ?, 'active', NULL, 0, 0, ?)`,
  ).run(
    "goal-mobility-1",
    "Mobility goal",
    "Fixture goal for environment mobility.",
    now,
  );
  db.prepare(
    `INSERT INTO task_graph (
      id, parent_id, goal_id, title, description, status,
      assigned_to, agent_role, priority, dependencies, result,
      estimated_cost_cents, actual_cost_cents, max_retries,
      retry_count, timeout_ms, created_at
    ) VALUES (?, NULL, ?, ?, ?, 'pending', NULL, ?, 50, '[]', NULL, 0, 0, 1, 0, 60000, ?)`,
  ).run(
    "task-mobility-1",
    "goal-mobility-1",
    "Continue objective",
    "Fixture Task for environment mobility.",
    "generalist",
    now,
  );
  db.prepare(
    `INSERT INTO adaptive_paths (
      id, goal_id, task_id, signature, hypothesis, strategy,
      assumptions, required_capabilities, environment, executor,
      sequence, expected_outcome, expected_cost_cents, evidence,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '[]', '["compute"]', NULL, NULL, '[]', ?, 0, '[]', 'selected', ?, ?)`,
  ).run(
    "path-mobility-1",
    "goal-mobility-1",
    "task-mobility-1",
    "fixture-signature",
    "A different environment can continue the objective.",
    "mobility fixture",
    "Task continues through an executable environment.",
    now,
    now,
  );
}

function provider(
  id: string,
  snapshot: () => Partial<EnvironmentSnapshot> = () => ({}),
): EnvironmentProvider {
  return {
    id,
    inspect: async () => ({
      id,
      label: id,
      availability: "available",
      capabilities: [{
        id: `${id}:compute`,
        type: "executor",
        provider: id,
        description: "compute",
        requirements: ["compute"],
        permissions: [],
        environment: id,
        available: true,
      }],
      evidence: [`${id} observed`],
      constraints: [],
      observedAt: new Date().toISOString(),
      ...snapshot(),
    }),
    estimate: async () => ({
      estimatedCostCents: 0,
      costCoverage: "complete",
      reliability: 0.9,
    }),
  };
}

function task(): TaskNode {
  return {
    id: "task-mobility-1",
    parentId: null,
    goalId: "goal-mobility-1",
    title: "Continue objective",
    description: "Execute through an environment without repeating failed equivalent routes.",
    status: "pending",
    assignedTo: null,
    agentRole: "generalist",
    priority: 50,
    dependencies: [],
    result: null,
    requiredCapabilities: ["compute"],
    preferredEnvironment: "env-a",
    strategicPathId: "path-mobility-1",
    metadata: {
      estimatedCostCents: 0,
      actualCostCents: 0,
      maxRetries: 1,
      retryCount: 0,
      timeoutMs: 60_000,
      createdAt: new Date(0).toISOString(),
      startedAt: null,
      completedAt: null,
    },
  };
}

function selectionResult(
  environmentId: string,
): EnvironmentTaskExecutionResult {
  const snapshot: EnvironmentSnapshot = {
    id: environmentId,
    label: environmentId,
    availability: "available",
    capabilities: [],
    evidence: [],
    constraints: [],
    observedAt: new Date().toISOString(),
  };
  const candidate = {
    environmentId,
    snapshot,
    operations: ["inspect"],
    satisfaction: {
      satisfiable: null,
      capabilityFit: 1,
      missingCapabilities: [],
    },
    estimate: {
      estimatedCostCents: 0,
      costCoverage: "complete",
    },
    score: 1,
    executionEligible: true,
    missingCapabilities: [],
    missingOperations: [],
    blockers: [],
    evidence: [],
  };

  return {
    environmentId,
    address: `${environmentId}://worker-1`,
    name: `${environmentId}-worker`,
    sandboxId: "worker-1",
    resourceExternalId: "worker-1",
    resourceType: "executor",
    resourceId: null,
    evidence: [`spawned in ${environmentId}`],
    selection: {
      selected: candidate,
      candidates: [candidate],
      unresolved: [],
    },
    selectionCandidate: candidate,
  };
}

describe("Environment mobility", () => {
  it("propagates mobility exclusions through the provider-neutral execution bridge", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider("env-a"));
    const executors = new EnvironmentTaskExecutorRegistry();
    const assess = vi.fn(async (
      _task: TaskNode,
      options: EnvironmentTaskSpawnOptions = {},
    ) => ({
      executable: true,
      evidence: [
        `excluded resources=${(options.excludedResourceIds ?? []).join(",")}`,
      ],
    }));
    const spawn = vi.fn(async (
      _task: TaskNode,
      options: EnvironmentTaskSpawnOptions = {},
    ) => ({
      address: "env-a://worker-2",
      name: "worker-2",
      sandboxId: "worker-2",
      resourceExternalId: "worker-2",
      resourceType: "executor",
      evidence: [
        `spawn exclusions=${(options.excludedResourceIds ?? []).join(",")}`,
      ],
    }));
    executors.register({
      environmentId: "env-a",
      assess,
      spawn,
    });

    const bridge = new EnvironmentExecutionBridge(
      new EnvironmentSelector(registry),
      executors,
    );
    const result = await bridge.spawn(task(), {
      excludedResourceIds: ["resource-bad"],
      excludedEnvironmentIds: [],
      metadata: { mobilityTest: true },
    });

    expect(result.environmentId).toBe("env-a");
    expect(assess).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(assess.mock.calls[0]?.[1]?.excludedResourceIds).toEqual([
      "resource-bad",
    ]);
    expect(spawn.mock.calls[0]?.[1]?.excludedResourceIds).toEqual([
      "resource-bad",
    ]);
  });

  it("persists migration attempts, condition fingerprints, and events", () => {
    const db = createDb();
    try {
      const store = new EnvironmentMigrationStore(db);
      const migration = store.create({
        taskId: null,
        status: "source_failed",
        reason: "fixture failure",
        evidence: ["source failed"],
      });

      const after = store.recordAttempt(migration.id, {
        environmentId: "provider-x",
        conditionFingerprint: "fingerprint-1",
        stage: "dispatch",
        evidence: ["dispatch failed"],
      });

      expect(after.attemptedEnvironments).toEqual(["provider-x"]);
      expect(after.conditionFingerprints["provider-x"]).toBe(
        "fingerprint-1",
      );
      expect(after.evidence).toEqual(
        expect.arrayContaining(["source failed", "dispatch failed"]),
      );
      expect(
        store.listEvents(migration.id).map((event) => event.operation),
      ).toEqual(expect.arrayContaining(["create", "attempt"]));
    } finally {
      db.close();
    }
  });

  it("survives a real SQLite close and reopen with migration evidence intact", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-mobility-restart-"));
    const dbPath = path.join(dir, "state.db");
    const db = new Database(dbPath);
    try {
      db.pragma("foreign_keys = ON");
      db.exec(CREATE_TABLES);
      db.exec(MIGRATION_V9);
      db.exec(MIGRATION_V10);
      db.exec(MIGRATION_V12);
      db.exec(MIGRATION_V13);
      db.exec(MIGRATION_V14);
      const store = new EnvironmentMigrationStore(db);
      const migration = store.create({
        status: "target_failed",
        reason: "persist across restart",
        evidence: ["before restart"],
      });
      store.recordAttempt(migration.id, {
        environmentId: "provider-restart",
        conditionFingerprint: "restart-fingerprint",
        stage: "spawn",
        evidence: ["attempt persisted"],
      });
      db.close();

      const reopened = new Database(dbPath);
      try {
        reopened.pragma("foreign_keys = ON");
        const restored = new EnvironmentMigrationStore(reopened).get(
          migration.id,
        );
        expect(restored).not.toBeNull();
        expect(restored?.attemptedEnvironments).toEqual([
          "provider-restart",
        ]);
        expect(
          restored?.conditionFingerprints["provider-restart"],
        ).toBe("restart-fingerprint");
        expect(restored?.evidence).toEqual(
          expect.arrayContaining(["before restart", "attempt persisted"]),
        );
      } finally {
        reopened.close();
      }
    } finally {
      if (db.open) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("contextually excludes a failed environment while keeping it visible as evidence", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider("env-a"));
    registry.register(provider("env-b"));

    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["compute"],
      preferredEnvironment: "env-a",
      excludedEnvironmentIds: ["env-a"],
      maxEstimatedCostCents: 10,
    });

    expect(result.selected?.environmentId).toBe("env-b");
    const failed = result.candidates.find(
      (candidate) => candidate.environmentId === "env-a",
    );
    expect(failed).toBeDefined();
    expect(failed?.executionEligible).toBe(false);
    expect(failed?.blockers.join(" ")).toContain(
      "equivalent environment retry",
    );
  });

  it("uses a materially different environment after an unchanged environment failure", async () => {
    const db = createDb();
    try {
      seedTaskContext(db);
      const registry = new EnvironmentRegistry();
      registry.register(provider("env-a"));
      registry.register(provider("env-b"));
      const selector = new EnvironmentSelector(registry);
      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      const migrations = new EnvironmentMigrationStore(db);
      const calls: EnvironmentTaskSpawnOptions[] = [];
      let attempts = 0;

      const execution = {
        spawn: vi.fn(async (
          _task: TaskNode,
          options: EnvironmentTaskSpawnOptions = {},
        ) => {
          calls.push(options);
          attempts += 1;
          if (attempts === 1) {
            throw new EnvironmentTaskExecutionError(
              "env-a",
              "env-a spawn failed",
              ["env-a provider failure"],
              "spawn",
            );
          }
          expect(options.excludedEnvironmentIds).toContain("env-a");
          return selectionResult("env-b");
        }),
      } as unknown as EnvironmentExecutionBridge;

      const mobility = new EnvironmentMobilityCoordinator(
        registry,
        selector,
        lifecycle,
        migrations,
        execution,
      );

      await expect(mobility.spawn(task())).rejects.toThrow(
        "env-a spawn failed",
      );

      const active = migrations.findActiveForTask(
        "task-mobility-1",
        "path-mobility-1",
      );
      expect(active?.attemptedEnvironments).toContain("env-a");
      expect(active?.conditionFingerprints["env-a"]).toMatch(
        /^[0-9a-f]{64}$/,
      );

      const second = await mobility.spawn(task());
      expect(second.environmentId).toBe("env-b");
      expect(second.mobilityExcludedEnvironmentIds).toContain("env-a");
      expect(calls).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it("excludes a failed resource without blacklisting its entire provider", async () => {
    const db = createDb();
    try {
      seedTaskContext(db);
      const registry = new EnvironmentRegistry();
      registry.register(provider("env-a"));
      const resources = new EnvironmentResourceStore(db);
      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        resources,
      );
      const failed = lifecycle.adopt({
        provider: "env-a",
        externalId: "executor-failed",
        type: "executor",
        goalId: "goal-mobility-1",
        pathId: "path-mobility-1",
        taskId: "task-mobility-1",
        status: "running",
        capabilities: ["compute"],
        retentionPolicy: "manual_retention",
        metadata: {
          executorAddress: "env-a://executor-failed",
        },
      });
      const spawnOptions: EnvironmentTaskSpawnOptions[] = [];
      const execution = {
        dispatch: vi.fn(async () => {
          throw new EnvironmentTaskExecutionError(
            "env-a",
            "resource dispatch failed",
            ["executor-specific transport failure"],
            "dispatch",
          );
        }),
        spawn: vi.fn(async (
          _task: TaskNode,
          options: EnvironmentTaskSpawnOptions = {},
        ) => {
          spawnOptions.push(options);
          return selectionResult("env-a");
        }),
      } as unknown as EnvironmentExecutionBridge;
      const migrations = new EnvironmentMigrationStore(db);
      const mobility = new EnvironmentMobilityCoordinator(
        registry,
        new EnvironmentSelector(registry),
        lifecycle,
        migrations,
        execution,
      );

      await expect(
        mobility.dispatch("env-a", task(), {
          address: "env-a://executor-failed",
          name: "failed-executor",
          spawned: false,
        }),
      ).rejects.toThrow("resource dispatch failed");

      const active = migrations.findActiveForTask(
        "task-mobility-1",
        "path-mobility-1",
      )!;
      expect(active.status).toBe("source_failed");
      expect(active.metadata.failedResourceIds).toEqual([failed.id]);
      expect(active.metadata.providerFailureEnvironments).toEqual([]);
      expect(
        await mobility.unchangedFailedEnvironmentExclusions(
          active,
          task(),
        ),
      ).toEqual([]);

      const next = await mobility.spawn(task());
      expect(next.environmentId).toBe("env-a");
      expect(next.mobilityExcludedEnvironmentIds).toEqual([]);
      expect(next.mobilityExcludedResourceIds).toEqual([failed.id]);
      expect(spawnOptions[0]?.excludedResourceIds).toEqual([failed.id]);
    } finally {
      db.close();
    }
  });

  it("clears a stale provider-scope block after later resource-scoped progress", async () => {
    const db = createDb();
    try {
      seedTaskContext(db);
      const registry = new EnvironmentRegistry();
      registry.register(provider("env-a"));
      const resources = new EnvironmentResourceStore(db);
      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        resources,
      );
      const current = lifecycle.adopt({
        provider: "env-a",
        externalId: "executor-current",
        type: "executor",
        goalId: "goal-mobility-1",
        pathId: "path-mobility-1",
        taskId: "task-mobility-1",
        status: "running",
        capabilities: ["compute"],
        retentionPolicy: "manual_retention",
        metadata: {
          executorAddress: "env-a://executor-current",
        },
      });
      const migrations = new EnvironmentMigrationStore(db);
      const migration = migrations.create({
        goalId: "goal-mobility-1",
        pathId: "path-mobility-1",
        taskId: "task-mobility-1",
        sourceProvider: "env-a",
        status: "target_failed",
        reason: "older provider-level failure",
        attemptedEnvironments: ["env-a"],
        conditionFingerprints: {
          "env-a": "older-condition",
        },
        metadata: {
          providerFailureEnvironments: ["env-a"],
          failedResourceIds: [],
        },
      });
      const execution = {
        dispatch: vi.fn(async () => {
          throw new EnvironmentTaskExecutionError(
            "env-a",
            "later resource-specific failure",
            ["provider was reachable; executor transport failed"],
            "dispatch",
          );
        }),
      } as unknown as EnvironmentExecutionBridge;
      const mobility = new EnvironmentMobilityCoordinator(
        registry,
        new EnvironmentSelector(registry),
        lifecycle,
        migrations,
        execution,
      );

      await expect(
        mobility.dispatch("env-a", task(), {
          address: "env-a://executor-current",
          name: "current",
          spawned: false,
        }),
      ).rejects.toThrow("later resource-specific failure");

      const updated = migrations.get(migration.id)!;
      expect(updated.metadata.providerFailureEnvironments).toEqual([]);
      expect(updated.metadata.failedResourceIds).toEqual([current.id]);
      expect(
        await mobility.unchangedFailedEnvironmentExclusions(
          updated,
          task(),
        ),
      ).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("reopens an environment after material provider conditions change", async () => {
    const db = createDb();
    try {
      seedTaskContext(db);
      let availability: EnvironmentSnapshot["availability"] = "available";
      const registry = new EnvironmentRegistry();
      registry.register(provider("env-a", () => ({ availability })));
      const selector = new EnvironmentSelector(registry);
      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      const migrations = new EnvironmentMigrationStore(db);
      const execution = {
        spawn: vi.fn(async () => {
          throw new EnvironmentTaskExecutionError(
            "env-a",
            "initial failure",
            ["failure under original condition"],
            "spawn",
          );
        }),
      } as unknown as EnvironmentExecutionBridge;
      const mobility = new EnvironmentMobilityCoordinator(
        registry,
        selector,
        lifecycle,
        migrations,
        execution,
      );

      await expect(mobility.spawn(task())).rejects.toThrow(
        "initial failure",
      );
      const migration = migrations.findActiveForTask(
        "task-mobility-1",
        "path-mobility-1",
      )!;
      expect(
        await mobility.unchangedFailedEnvironmentExclusions(
          migration,
          task(),
        ),
      ).toEqual(["env-a"]);

      availability = "degraded";
      expect(
        await mobility.unchangedFailedEnvironmentExclusions(
          migration,
          task(),
        ),
      ).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("plans a target without provisioning or destroying and excludes the current source", async () => {
    const db = createDb();
    try {
      const registry = new EnvironmentRegistry();
      let providerMutations = 0;
      registry.register({
        ...provider("source"),
        provision: async () => {
          providerMutations += 1;
          return { externalId: "unexpected" };
        },
        destroy: async () => {
          providerMutations += 1;
          return { status: "terminated" };
        },
      });
      registry.register(provider("target"));

      const resources = new EnvironmentResourceStore(db);
      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        resources,
      );
      const source = lifecycle.adopt({
        provider: "source",
        externalId: "source-1",
        type: "executor",
        status: "running",
        capabilities: ["compute"],
        retentionPolicy: "manual_retention",
      });
      const selector = new EnvironmentSelector(registry);
      const migrations = new EnvironmentMigrationStore(db);
      const mobility = new EnvironmentMobilityCoordinator(
        registry,
        selector,
        lifecycle,
        migrations,
        {} as EnvironmentExecutionBridge,
      );

      const plan = await mobility.plan(
        source.id,
        {
          requiredCapabilities: ["compute"],
          preferredEnvironment: "target",
          maxEstimatedCostCents: 10,
        },
        "source is degraded",
      );

      expect(plan.selection.selected?.environmentId).toBe("target");
      expect(plan.excludedEnvironmentIds).not.toContain("source");
      expect(plan.excludedResourceIds).toEqual([source.id]);
      expect(plan.migration.sourceResourceId).toBe(source.id);
      expect(plan.migration.targetProvider).toBe("target");
      expect(providerMutations).toBe(0);
    } finally {
      db.close();
    }
  });

  it("does not recover resources already owned by retention release", async () => {
    const db = createDb();
    try {
      const registry = new EnvironmentRegistry();
      const reconcile = vi.fn(async (resource: any) => ({
        resource,
        actualExists: true,
        action: "should-not-run",
      }));
      const recover = vi.fn(async () => ({
        status: "running" as const,
      }));
      registry.register({
        ...provider("cloud"),
        reconcile,
        recover,
      });
      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "cloud-release-1",
        type: "executor",
        status: "unknown",
        retentionPolicy: "until_goal_complete",
        metadata: {
          retentionReleaseState: "pending_observation",
        },
      });
      const mobility = new EnvironmentMobilityCoordinator(
        registry,
        new EnvironmentSelector(registry),
        lifecycle,
        new EnvironmentMigrationStore(db),
        {} as EnvironmentExecutionBridge,
      );

      const sweep = await mobility.sweepRecovery();

      expect(sweep.retentionOwnedSkipped).toBe(1);
      expect(reconcile).not.toHaveBeenCalled();
      expect(recover).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("does not blindly repeat resource recovery against the same observed condition", async () => {
    const db = createDb();
    try {
      const registry = new EnvironmentRegistry();
      let recoverCalls = 0;
      registry.register({
        ...provider("cloud"),
        reconcile: async (resource) => ({
          resource: {
            ...resource,
            status: "degraded",
            providerState: "same-degraded-state",
            updatedAt: new Date().toISOString(),
          },
          actualExists: true,
          action: "observed_degraded",
          evidence: ["still degraded"],
        }),
        recover: async () => {
          recoverCalls += 1;
          throw new Error("recovery route failed");
        },
      });

      const lifecycle = new EnvironmentLifecycleManager(
        registry,
        new EnvironmentResourceStore(db),
      );
      lifecycle.adopt({
        provider: "cloud",
        externalId: "cloud-1",
        type: "executor",
        status: "degraded",
        providerState: "same-degraded-state",
        retentionPolicy: "manual_retention",
      });

      const mobility = new EnvironmentMobilityCoordinator(
        registry,
        new EnvironmentSelector(registry),
        lifecycle,
        new EnvironmentMigrationStore(db),
        {} as EnvironmentExecutionBridge,
      );

      const first = await mobility.sweepRecovery();
      expect(first.recoverAttempts).toBe(1);
      expect(recoverCalls).toBe(1);

      const second = await mobility.sweepRecovery();
      expect(second.recoverAttempts).toBe(0);
      expect(second.unchangedSkipped).toBe(1);
      expect(recoverCalls).toBe(1);
    } finally {
      db.close();
    }
  });
});
