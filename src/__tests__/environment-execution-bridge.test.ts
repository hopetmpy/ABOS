import { describe, expect, it } from "vitest";
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
import type { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
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
