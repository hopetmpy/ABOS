import { describe, expect, it, vi } from "vitest";
import {
  EnvironmentExecutionBridge,
  EnvironmentTaskExecutionError,
  EnvironmentTaskExecutorRegistry,
} from "../environments/task-executor.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentSelector } from "../environments/selector.js";
import type {
  EnvironmentProvider,
  EnvironmentResource,
} from "../environments/types.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { createTestDb } from "./mocks.js";
import type { TaskNode } from "../orchestration/task-graph.js";
import {
  EXECUTION_CONTINUATION_PROTOCOL_VERSION,
  type ExecutionContinuationContext,
} from "../environments/continuity.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import path from "node:path";

function provider(id: string, cost = 0): EnvironmentProvider {
  return {
    id,
    inspect: async () => ({
      id,
      label: id,
      availability: "available",
      capabilities: [],
      evidence: [`${id} observed`],
      constraints: [],
      observedAt: new Date().toISOString(),
    }),
    estimate: async () => ({
      estimatedCostCents: cost,
      reliability: 0.9,
    }),
  };
}

function continuationWithRuntimeArtifact(): ExecutionContinuationContext {
  return {
    protocolVersion: EXECUTION_CONTINUATION_PROTOCOL_VERSION,
    assembledAt: new Date(0).toISOString(),
    identity: {
      goalId: "goal-1",
      taskId: "task-1",
      pathId: "path-1",
    },
    goal: {
      title: "Goal",
      description: "Continue work.",
      status: "active",
      strategy: "Reuse verified work.",
    },
    task: {
      title: "Execute",
      description: "Execute a provider-neutral task.",
      status: "pending",
      result: null,
    },
    path: {
      id: "path-1",
      status: "executing",
      hypothesis: "The task can continue.",
      strategy: "Use verified state.",
      assumptions: [],
      requiredCapabilities: [],
      environment: "alpha",
      executor: null,
      sequence: ["continue"],
      expectedOutcome: "Task completes.",
      evidence: [],
    },
    history: {
      failures: [],
      decisions: [],
      evidence: [],
    },
    memory: [],
    artifacts: [{
      reference: "package.json",
      state: "available",
      materializedPath: path.join(RUNTIME_ROOT, "package.json"),
    }],
    pending: [],
    checkpoint: null,
    sources: [{
      authority: "task_graph",
      recordId: "task-1",
    }],
    extensions: {},
  };
}

function task(preferredEnvironment: string | null = null): TaskNode {
  return {
    id: "task-1",
    parentId: null,
    goalId: "goal-1",
    title: "Execute",
    description: "Execute a provider-neutral task.",
    status: "pending",
    assignedTo: null,
    agentRole: "generalist",
    priority: 50,
    dependencies: [],
    result: null,
    requiredCapabilities: ["novel-capability"],
    preferredEnvironment,
    strategicPathId: "path-1",
    metadata: {
      estimatedCostCents: 0,
      actualCostCents: 0,
      maxRetries: 0,
      retryCount: 0,
      timeoutMs: 10_000,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    },
  };
}

describe("EnvironmentExecutionBridge", () => {
  it("honors an executable planner environment through an open executor registry", async () => {
    const environments = new EnvironmentRegistry();
    environments.register(provider("alpha", 0));
    environments.register(provider("beta", 10));

    const executors = new EnvironmentTaskExecutorRegistry();
    const attempts: string[] = [];
    executors.register({
      environmentId: "alpha",
      spawn: async () => {
        attempts.push("alpha");
        return { address: "alpha://1", name: "alpha", sandboxId: "a-1" };
      },
    });
    executors.register({
      environmentId: "beta",
      spawn: async () => {
        attempts.push("beta");
        return { address: "beta://1", name: "beta", sandboxId: "b-1" };
      },
    });

    const bridge = new EnvironmentExecutionBridge(
      new EnvironmentSelector(environments),
      executors,
    );

    const result = await bridge.spawn(task("beta"));
    expect(result.environmentId).toBe("beta");
    expect(attempts).toEqual(["beta"]);
  });

  it("prefers actually owned spare Task capacity, never vendor claims or an actively assigned instance", async () => {
    const db = createTestDb();
    try {
      const registry = new EnvironmentRegistry();
      const vendor = provider("a-new", 20);
      vendor.estimate = async () => ({
        estimatedCostCents: 20, reliability: 0.9,
        reusableResourceCount: 500, // Supplier assertion is NOT ABOS-owned.
      });
      registry.register(vendor);
      registry.register(provider("z-reuse", 20));
      const executors = new EnvironmentTaskExecutorRegistry();
      const spawned: string[] = [];
      executors.register({
        environmentId: "a-new",
        spawn: async () => {
          spawned.push("a-new");
          return {
            address: "a-new://new", name: "new-worker",
            sandboxId: "new", resourceExternalId: "new",
          };
        },
      });
      executors.register({
        environmentId: "z-reuse",
        spawn: async () => {
          spawned.push("z-reuse");
          return {
            address: "z-reuse://owned", name: "existing-worker",
            sandboxId: "owned", resourceExternalId: "owned",
          };
        },
      });
      const now = new Date().toISOString();
      db.raw.prepare(
        "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run("goal-1", "Use existing capacity", "Test-only", "active", now);
      for (const [id, status] of [
        ["old-task", "running"], ["task-1", "pending"],
      ]) {
        db.raw.prepare(
          "INSERT INTO task_graph (id, goal_id, title, description, status, priority, dependencies, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(id, "goal-1", id, "Test-only", status, 50, "[]", now);
      }
      const store = new EnvironmentResourceStore(db.raw);
      const lifecycle = new EnvironmentLifecycleManager(registry, store);
      const owned = lifecycle.adopt({
        provider: "z-reuse", externalId: "owned", type: "compute",
        goalId: "goal-1", taskId: "old-task",
        status: "running", retentionPolicy: "until_goal_complete",
        metadata: { executorAddress: "z-reuse://owned" },
      });
      const bridge = new EnvironmentExecutionBridge(
        new EnvironmentSelector(registry), executors, lifecycle,
      );
      // The fixture has no materialized P-025 adaptive_paths row: do not
      // persist a nonexistent strategic FK when the real bridge adopts
      // its first Task resource. Procurement route tests cover P-025.
      const work = task();
      work.strategicPathId = null;

      // This resource is still owned by a running Task; vendor's 500
      // "reusable" instances are not OUR inventory, and no hijack is allowed.
      const busy = await bridge.spawn(work);
      expect(busy.environmentId).toBe("a-new");
      expect(busy.selection.candidates.find(c => c.environmentId === "a-new")
        ?.estimate.reusableResourceCount).toBe(0);
      expect(busy.selection.candidates.find(c => c.environmentId === "z-reuse")
        ?.estimate.reusableResourceCount).toBe(0);

      db.raw.prepare("UPDATE task_graph SET status = 'completed' WHERE id = ?")
        .run("old-task");
      expect(store.findReusableCandidates({
        provider: "z-reuse", requireExecutorAddress: true,
      }).map(x => x.id)).toEqual([owned.id]);
      // A completed old Task releases its live-owned capacity for reuse; the
      // first new resource stays assigned to pending task-1 and is not spare.
      const reused = await bridge.spawn(work);
      expect(reused.environmentId).toBe("z-reuse");
      expect(reused.selection.candidates.find(c => c.environmentId === "z-reuse")
        ?.estimate.reusableResourceCount).toBe(1);
      expect(reused.selection.candidates.find(c => c.environmentId === "a-new")
        ?.estimate.reusableResourceCount).toBe(0);
      expect(store.findByExternalId("z-reuse", "owned")?.id).toBe(owned.id);
      expect(store.get(owned.id)?.taskId).toBe("task-1");
      expect(spawned).toEqual(["a-new", "z-reuse"]);
      // The Task now owns the previously spare resource and cannot be
      // double-counted as spare by the next selector evaluation.
      expect(store.findReusableCandidates({
        provider: "z-reuse", requireExecutorAddress: true,
      })).toHaveLength(0);
    } finally { db.close(); }
  });

  it("preserves independently sourced duration, capacity and money provenance through the generic execution bridge", async () => {
    const registry = new EnvironmentRegistry();
    const observedRequirements: Array<Record<string, unknown>> = [];
    let unit: string | null = null;
    registry.register({
      ...provider("generic-bridge"),
      estimate: async (requirements) => {
        observedRequirements.push({
          expectedDurationMs: requirements.expectedDurationMs,
          neededByAt: requirements.neededByAt,
          minimumCapacity: requirements.minimumCapacity,
        });
        return {
          estimatedCostCents: 275,
          costUnit: unit,
          costCoverage: "partial",
          evidence: ["Synthetic provider quote; not authenticated payment."],
        };
      },
    });
    const executors = new EnvironmentTaskExecutorRegistry();
    let dispatched = 0;
    executors.register({
      environmentId: "generic-bridge",
      spawn: async () => {
        dispatched += 1;
        return {
          address: `generic-bridge://worker-${dispatched}`,
          sandboxId: `worker-${dispatched}`,
          name: "worker",
        };
      },
    });
    const inventoryQueries: Array<Record<string, unknown>> = [];
    const adopted: Array<Record<string, unknown>> = [];
    const lifecycle = {
      resources: {
        findReusableCandidates: (filter: Record<string, unknown>) => {
          inventoryQueries.push(filter);
          return [];
        },
      },
      adopt: (input: Record<string, unknown>) => {
        adopted.push(input);
        return { id: `owned-${adopted.length}` };
      },
    } as unknown as EnvironmentLifecycleManager;
    const bridge = new EnvironmentExecutionBridge(
      new EnvironmentSelector(registry), executors, lifecycle,
    );

    const request = task("generic-bridge");
    // Existing Task watchdog is 10 s; supplier resource usage is unknown.
    const unknown = await bridge.spawn(request);
    expect(unknown.environmentId).toBe("generic-bridge");
    expect(observedRequirements[0]?.expectedDurationMs).toBeNull();
    expect(adopted[0]?.estimatedCostCents).toBeNull();
    expect(unknown.evidence.join(" ")).toContain("cannot be recorded as canonical USD cents");
    expect(dispatched).toBe(1);

    const needBy = new Date(Date.now() + 86_400_000).toISOString();
    unit = "usd_cent";
    await bridge.spawn(request, {
      metadata: {
        expectedResourceDurationMs: 7_200_000,
        neededByAt: needBy,
        instanceType: "large",
        minimumCapacity: { cpuCores: 4, memoryMb: 8192 },
      },
    });
    expect(observedRequirements[1]).toMatchObject({
      expectedDurationMs: 7_200_000,
      neededByAt: needBy,
      minimumCapacity: { cpuCores: 4, memoryMb: 8192 },
    });
    expect(inventoryQueries.some(query =>
      query.requiredInstanceType === "large" &&
      (query.minimumCapacity as Record<string, number>)?.memoryMb === 8192
    )).toBe(true);
    expect(adopted[1]?.estimatedCostCents).toBe(275);

    await expect(bridge.spawn(request, {
      metadata: { expectedResourceDurationMs: 0 },
    })).rejects.toMatchObject({ operation: "selection" });
    await expect(bridge.spawn(request, {
      metadata: { expectedResourceDurationMs: "7200000" },
    })).rejects.toMatchObject({ operation: "selection" });
    await expect(bridge.spawn(request, {
      metadata: { neededByAt: 1234567890 },
    })).rejects.toMatchObject({ operation: "selection" });
    await expect(bridge.spawn(request, {
      metadata: { neededByAt: "2026-11-01" },
    })).rejects.toMatchObject({ operation: "selection" });
    expect(dispatched).toBe(2);
    expect(adopted).toHaveLength(2);
  });

  it("passes only an explicit reviewed budget to the canonical selector", async () => {
    const registry = new EnvironmentRegistry();
    const candidate = provider("priced", 80);
    candidate.estimate = async () => ({
      estimatedCostCents: 80, costCoverage: "complete", costUnit: "usd_cent",
    });
    registry.register(candidate);
    const executors = new EnvironmentTaskExecutorRegistry();
    let dispatches = 0;
    executors.register({
      environmentId: "priced",
      spawn: async () => {
        dispatches += 1;
        return { address: "priced://1", name: "priced", sandboxId: "1" };
      },
    });
    const bridge = new EnvironmentExecutionBridge(new EnvironmentSelector(registry), executors);
    const input = task("priced");
    input.metadata.estimatedCostCents = 1; // task_cost_cent is not a purchase budget
    await expect(bridge.spawn(input, { maxEstimatedCostCents: 50, maxEstimatedCostUnit: "usd_cent" }))
      .rejects.toMatchObject({ operation: "selection" });
    expect(dispatches).toBe(0);
    await expect(bridge.spawn(input, { maxEstimatedCostCents: 80 }))
      .rejects.toMatchObject({ operation: "selection" });
    // A unit-only budget must not silently become an unbudgeted dispatch.
    for (const incomplete of [
      { maxEstimatedCostUnit: "usd_cent" },
      { maxEstimatedCostCents: null, maxEstimatedCostUnit: "usd_cent" },
      { maxEstimatedCostUnit: "" },
    ]) {
      await expect(bridge.spawn(input, incomplete))
        .rejects.toMatchObject({ operation: "selection" });
    }
    await expect(bridge.spawn(input, {
      maxEstimatedCostCents: 80, maxEstimatedCostUnit: "credit_cent",
    })).rejects.toMatchObject({ operation: "selection" });
    expect(dispatches).toBe(0);
    await bridge.spawn(input); // No silent limit derived from task metadata
    expect(dispatches).toBe(1);
    await bridge.spawn(input, { maxEstimatedCostCents: 80, maxEstimatedCostUnit: "usd_cent" });
    expect(dispatches).toBe(2);
  });

  it("rejects incomplete provider estimates when an explicit budget reaches the bridge", async () => {
    const registry = new EnvironmentRegistry();
    const candidate = provider("partial", 5);
    candidate.estimate = async () => ({
      estimatedCostCents: 5, costCoverage: "partial", costUnit: "usd_cent",
      evidence: ["Compute only; networking and storage unpriced"],
    });
    registry.register(candidate);
    const executors = new EnvironmentTaskExecutorRegistry();
    let dispatches = 0;
    executors.register({
      environmentId: "partial",
      spawn: async () => {
        dispatches += 1;
        return { address: "partial://1", name: "partial", sandboxId: "1" };
      },
    });
    const bridge = new EnvironmentExecutionBridge(new EnvironmentSelector(registry), executors);
    await expect(bridge.spawn(task("partial"), { maxEstimatedCostCents: 10, maxEstimatedCostUnit: "usd_cent" }))
      .rejects.toMatchObject({ operation: "selection" });
    expect(dispatches).toBe(0);
  });

  it("does not silently switch providers after a selected environment attempt fails", async () => {
    const environments = new EnvironmentRegistry();
    environments.register(provider("alpha", 0));
    environments.register(provider("beta", 10));

    const executors = new EnvironmentTaskExecutorRegistry();
    let alphaAttempts = 0;
    executors.register({
      environmentId: "alpha",
      spawn: async () => {
        alphaAttempts += 1;
        return { address: "alpha://1", name: "alpha", sandboxId: "a-1" };
      },
    });
    executors.register({
      environmentId: "beta",
      spawn: async () => {
        throw new Error("capacity unavailable");
      },
    });

    const bridge = new EnvironmentExecutionBridge(
      new EnvironmentSelector(environments),
      executors,
    );

    await expect(bridge.spawn(task("beta"))).rejects.toMatchObject({
      name: "EnvironmentTaskExecutionError",
      environmentId: "beta",
    });
    expect(alphaAttempts).toBe(0);
  });

  it("dispatches through the named executor without a second provider fallback", async () => {
    const environments = new EnvironmentRegistry();
    environments.register(provider("alpha"));
    environments.register(provider("beta"));

    const executors = new EnvironmentTaskExecutorRegistry();
    const deliveries: string[] = [];
    const continuationContext: ExecutionContinuationContext = {
      ...continuationWithRuntimeArtifact(),
      artifacts: [],
    };
    let deliveredContinuation: ExecutionContinuationContext | undefined;
    executors.register({
      environmentId: "alpha",
      spawn: async () => ({
        address: "alpha://1",
        name: "alpha",
        sandboxId: "a-1",
      }),
      dispatch: async (input, target, options) => {
        deliveries.push(`alpha:${input.id}:${target.address}`);
        deliveredContinuation = options?.continuationContext;
        return { evidence: ["alpha delivery"] };
      },
    });
    executors.register({
      environmentId: "beta",
      spawn: async () => ({
        address: "beta://1",
        name: "beta",
        sandboxId: "b-1",
      }),
      dispatch: async () => {
        deliveries.push("beta");
        return {};
      },
    });

    const bridge = new EnvironmentExecutionBridge(
      new EnvironmentSelector(environments),
      executors,
    );

    const result = await bridge.dispatch("alpha", task(), {
      address: "alpha://existing",
      name: "alpha-existing",
      spawned: false,
    }, {
      continuationContext,
    });

    expect(result.evidence).toContain("alpha delivery");
    expect(deliveredContinuation).toEqual(continuationContext);
    expect(deliveredContinuation).not.toBe(continuationContext);
    expect(deliveries).toEqual(["alpha:task-1:alpha://existing"]);
  });

  it("materializes parent artifacts before dispatch and passes only the verified target path onward", async () => {
    const environments = new EnvironmentRegistry();
    environments.register(provider("alpha"));

    const executors = new EnvironmentTaskExecutorRegistry();
    let dispatchContinuation: ExecutionContinuationContext | undefined;
    let sourceDigest = "";
    executors.register({
      environmentId: "alpha",
      spawn: async () => ({
        address: "alpha://1",
        name: "alpha",
        sandboxId: "a-1",
      }),
      materializeArtifacts: async (_task, _target, request) => {
        expect(request.sources).toHaveLength(1);
        expect(request.sources[0]?.localPath).toBe(
          path.join(RUNTIME_ROOT, "package.json"),
        );
        sourceDigest = request.sources[0]!.integrity.digest;
        return {
          protocolVersion: 1,
          entries: request.sources.map((source) => ({
            reference: source.reference,
            state: "available",
            targetPath: `/remote/${source.targetName}`,
            integrity: source.integrity,
            evidence: ["target hash verified"],
          })),
        };
      },
      dispatch: async (_task, _target, options) => {
        dispatchContinuation = options?.continuationContext;
        return { evidence: ["dispatched after materialization"] };
      },
    });

    const bridge = new EnvironmentExecutionBridge(
      new EnvironmentSelector(environments),
      executors,
    );

    const result = await bridge.dispatch(
      "alpha",
      task(),
      {
        address: "alpha://existing",
        name: "alpha-existing",
        spawned: false,
      },
      {
        continuationContext: continuationWithRuntimeArtifact(),
      },
    );

    expect(sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(dispatchContinuation?.artifacts[0]).toMatchObject({
      reference: "package.json",
      state: "available",
      integrity: {
        algorithm: "sha256",
        digest: sourceDigest,
      },
    });
    expect(
      dispatchContinuation?.artifacts[0]?.materializedPath,
    ).toMatch(/^\/remote\//);
    expect(result.metadata?.artifactMaterialization).toEqual(
      expect.objectContaining({
        environmentId: "alpha",
        targetAddress: "alpha://existing",
      }),
    );
  });

  it("collects executor-local async artifacts through lifecycle before returning parent-safe result references", async () => {
    const environments = new EnvironmentRegistry();
    environments.register(provider("alpha"));
    const executors = new EnvironmentTaskExecutorRegistry();

    const resource: EnvironmentResource = {
      id: "resource-alpha-1",
      provider: "alpha",
      externalId: "sandbox-alpha-1",
      type: "alpha-worker",
      goalId: "goal-1",
      pathId: "path-1",
      taskId: "task-1",
      status: "running",
      region: null,
      capabilities: [],
      estimatedCostCents: 0,
      actualCostCents: 0,
      credentialsReference: null,
      retentionPolicy: "until_goal_complete",
      providerState: "running",
      evidence: [],
      metadata: {
        executorAddress: "alpha://child",
        lastDispatchedTaskId: "task-1",
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      lastHealthCheck: null,
    };

    const collect = vi.fn(async () => {
      expect(resource.metadata.remoteArtifacts).toEqual([
        "outputs/remote.bin",
      ]);
      expect(resource.metadata.artifactCollectionState).toBe(
        "pending",
      );
      resource.metadata = {
        ...resource.metadata,
        remoteArtifacts: [],
        artifactCollectionState: "collected",
        collectedArtifacts: [{
          remotePath: "outputs/remote.bin",
          localPath: "/parent/verified.bin",
          bytes: 12,
          sha256: "a".repeat(64),
        }],
      };
      return {
        artifacts: ["/parent/verified.bin"],
        evidence: ["collected and verified"],
        metadata: {
          remoteArtifacts: [],
          artifactCollectionState: "collected",
          collectedArtifacts:
            resource.metadata.collectedArtifacts,
        },
      };
    });

    const lifecycle = {
      resources: {
        list: () => [resource],
        applyMutation: (
          _id: string,
          mutation: {
            evidence?: string[];
            metadata?: Record<string, unknown>;
          },
        ) => {
          resource.evidence = [
            ...resource.evidence,
            ...(mutation.evidence ?? []),
          ];
          resource.metadata = {
            ...resource.metadata,
            ...(mutation.metadata ?? {}),
          };
          return resource;
        },
      },
      collect,
    } as unknown as EnvironmentLifecycleManager;

    const bridge = new EnvironmentExecutionBridge(
      new EnvironmentSelector(environments),
      executors,
      lifecycle,
    );

    const result = await bridge.collectRemoteResultArtifacts(
      "alpha",
      task(),
      "alpha://child",
      {
        success: true,
        output: "done",
        artifacts: [
          "outputs/remote.bin",
          "https://example.test/durable.bin",
        ],
        costCents: 1,
        duration: 10,
      },
    );

    expect(collect).toHaveBeenCalledWith("resource-alpha-1");
    expect(result.artifacts).toEqual([
      "https://example.test/durable.bin",
      "/parent/verified.bin",
    ]);
  });

  it("keeps uncollected remote artifacts opaque and pending when provider collection is unavailable", async () => {
    const environments = new EnvironmentRegistry();
    environments.register(provider("future-provider"));
    const executors = new EnvironmentTaskExecutorRegistry();

    const resource: EnvironmentResource = {
      id: "resource-future-1",
      provider: "future-provider",
      externalId: "future-resource-1",
      type: "future-worker",
      goalId: "goal-1",
      pathId: "path-1",
      taskId: "task-1",
      status: "running",
      region: null,
      capabilities: [],
      estimatedCostCents: null,
      actualCostCents: 0,
      credentialsReference: null,
      retentionPolicy: "until_goal_complete",
      providerState: "running",
      evidence: [],
      metadata: {
        executorAddress: "future://child",
        lastDispatchedTaskId: "task-1",
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      lastHealthCheck: null,
    };

    const lifecycle = {
      resources: {
        list: () => [resource],
        applyMutation: (
          _id: string,
          mutation: {
            evidence?: string[];
            metadata?: Record<string, unknown>;
          },
        ) => {
          resource.evidence = [
            ...resource.evidence,
            ...(mutation.evidence ?? []),
          ];
          resource.metadata = {
            ...resource.metadata,
            ...(mutation.metadata ?? {}),
          };
          return resource;
        },
      },
      collect: vi.fn().mockRejectedValue(
        new Error("collect capability not currently available"),
      ),
    } as unknown as EnvironmentLifecycleManager;

    const bridge = new EnvironmentExecutionBridge(
      new EnvironmentSelector(environments),
      executors,
      lifecycle,
    );

    const result = await bridge.collectRemoteResultArtifacts(
      "future-provider",
      task(),
      "future://child",
      {
        success: true,
        output: "semantic work succeeded",
        artifacts: ["outputs/not-yet-collected.bin"],
        costCents: 0,
        duration: 5,
      },
    );

    expect(result.success).toBe(true);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatch(
      /^abos-remote-artifact:\/\/\//,
    );
    expect(result.artifacts[0]).not.toContain(
      "/parent/",
    );
    expect(resource.metadata.artifactCollectionState).toBe(
      "pending",
    );
    expect(resource.metadata.remoteArtifacts).toEqual([
      "outputs/not-yet-collected.bin",
    ]);
  });

  it("reports a missing dispatch implementation as unavailable, not as impossible", async () => {
    const environments = new EnvironmentRegistry();
    environments.register(provider("alpha"));
    const executors = new EnvironmentTaskExecutorRegistry();
    executors.register({
      environmentId: "alpha",
      spawn: async () => ({
        address: "alpha://1",
        name: "alpha",
        sandboxId: "a-1",
      }),
    });

    const bridge = new EnvironmentExecutionBridge(
      new EnvironmentSelector(environments),
      executors,
    );

    try {
      await bridge.dispatch("alpha", task(), {
        address: "alpha://existing",
        name: "alpha",
        spawned: false,
      });
      throw new Error("expected dispatch to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentTaskExecutionError);
      const typed = error as EnvironmentTaskExecutionError;
      expect(typed.environmentId).toBe("alpha");
      expect(typed.evidence.join(" ").toLowerCase()).toContain("not proof");
      expect(typed.evidence.join(" ").toLowerCase()).toContain("impossible");
    }
  });

  it("treats a missing executor as unavailable or undiscovered, never impossible", async () => {
    const environments = new EnvironmentRegistry();
    environments.register(provider("future-provider"));

    const bridge = new EnvironmentExecutionBridge(
      new EnvironmentSelector(environments),
      new EnvironmentTaskExecutorRegistry(),
    );

    try {
      await bridge.spawn(task());
      throw new Error("expected execution bridge to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentTaskExecutionError);
      const typed = error as EnvironmentTaskExecutionError;
      expect(typed.environmentId).toBeNull();
      expect(typed.evidence.join(" ").toLowerCase()).toContain("not proof");
      expect(typed.evidence.join(" ").toLowerCase()).toContain("impossible");
    }
  });
});
