import { describe, expect, it } from "vitest";
import { AwsEnvironmentProvider } from "../environments/aws.js";
import { AwsEc2TaskExecutor } from "../environments/aws-ec2-executor.js";
import type { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import type {
  EnvironmentCommandRunner,
  EnvironmentResource,
} from "../environments/types.js";
import type { TaskNode, TaskResult } from "../orchestration/task-graph.js";

function task(role = "generalist"): TaskNode {
  return {
    id: "task-aws-1",
    parentId: null,
    goalId: "goal-1",
    title: "Execute remotely",
    description: "Run a provider-neutral ABOS Task through EC2.",
    status: "pending",
    assignedTo: null,
    agentRole: role,
    priority: 50,
    dependencies: [],
    result: null,
    requiredCapabilities: ["shell"],
    preferredEnvironment: "aws",
    strategicPathId: "path-1",
    metadata: {
      estimatedCostCents: 5,
      actualCostCents: 0,
      maxRetries: 0,
      retryCount: 0,
      timeoutMs: 60_000,
      createdAt: new Date(0).toISOString(),
      startedAt: null,
      completedAt: null,
    },
  };
}

function resource(
  overrides: Partial<EnvironmentResource> = {},
): EnvironmentResource {
  return {
    id: "resource-aws-1",
    provider: "aws",
    externalId: "i-new",
    type: "aws-ec2-instance",
    goalId: "goal-1",
    pathId: "path-1",
    taskId: "task-aws-1",
    status: "running",
    region: "us-east-1",
    capabilities: ["remote compute", "linux", "ssm"],
    estimatedCostCents: 1,
    actualCostCents: 0,
    credentialsReference: "iam-instance-profile:ABOS-SSM",
    retentionPolicy: "until_goal_complete",
    providerState: "running",
    evidence: [],
    metadata: {
      executorKind: "aws-ec2-ssm",
      executorAddress: "aws://ec2/i-new",
      installRoot: "/opt/abos",
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastHealthCheck: null,
    ...overrides,
  };
}

function lifecycleStub(
  existing: EnvironmentResource[] = [],
  options: { bootstrapStatus?: EnvironmentResource["status"] } = {},
) {
  const resources = [...existing];
  const mutations: Array<{
    id: string;
    operation: string;
    metadata?: Record<string, unknown>;
  }> = [];
  let provisionCalls = 0;
  const provisionInputs: unknown[] = [];

  const lifecycle = {
    resources: {
      list: () => resources,
      applyMutation: (
        id: string,
        mutation: {
          status?: EnvironmentResource["status"];
          metadata?: Record<string, unknown>;
          evidence?: string[];
        },
        operation: string,
      ) => {
        mutations.push({
          id,
          operation,
          metadata: mutation.metadata,
        });
        const current = resources.find((entry) => entry.id === id);
        if (!current) throw new Error("resource not found");
        if (mutation.status) current.status = mutation.status;
        current.metadata = {
          ...current.metadata,
          ...(mutation.metadata ?? {}),
        };
        current.evidence = [
          ...current.evidence,
          ...(mutation.evidence ?? []),
        ];
        return current;
      },
    },
    provision: async (
      _providerId: string,
      input: { retentionPolicy: EnvironmentResource["retentionPolicy"] },
    ) => {
      provisionCalls += 1;
      provisionInputs.push(input);
      const created = resource({
        retentionPolicy: input.retentionPolicy,
      });
      resources.push(created);
      return created;
    },
    bootstrap: async (id: string) => {
      const current = resources.find((entry) => entry.id === id);
      if (!current) throw new Error("resource not found");
      current.status = options.bootstrapStatus ?? "running";
      return current;
    },
    health: async (id: string) => {
      const current = resources.find((entry) => entry.id === id);
      if (!current) throw new Error("resource not found");
      return current;
    },
  } as unknown as EnvironmentLifecycleManager;

  return {
    lifecycle,
    resources,
    mutations,
    get provisionCalls() {
      return provisionCalls;
    },
    provisionInputs,
  };
}

function encodedResult(result: TaskResult): string {
  return Buffer.from(JSON.stringify(result), "utf8").toString("base64");
}

describe("AwsEc2TaskExecutor", () => {
  it("provisions and bootstraps through generic lifecycle ownership", async () => {
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (args[0] === "ec2" && args[1] === "describe-instances") {
        return { stdout: "[]", stderr: "", exitCode: 0 };
      }
      if (args[0] === "pricing" && args[1] === "get-products") {
        return {
          stdout: JSON.stringify({ PriceList: [] }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "--version") {
        return {
          stdout: "aws-cli/2",
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "sts") {
        return {
          stdout: JSON.stringify({ Account: "123" }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "configure") {
        return {
          stdout: "us-east-1\n",
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`unexpected AWS call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
      defaultIamInstanceProfile: "ABOS-SSM",
    });
    const { lifecycle, mutations } = lifecycleStub();
    const executor = new AwsEc2TaskExecutor({
      provider,
      lifecycle,
      identity: {
        name: "parent",
        address: "0x0000000000000000000000000000000000000001",
      } as any,
      config: {
        name: "parent",
        genesisPrompt: "Broad parent mission.",
        chainType: "evm",
      } as any,
      repositoryRef: "main",
    });

    const spawned = await executor.spawn(task());

    expect(spawned.address).toBe("aws://ec2/i-new");
    expect(spawned.resourceExternalId).toBe("i-new");
    expect(spawned.resourceType).toBe("aws-ec2-instance");
    expect(
      mutations.some((entry) => entry.operation === "executor_ready"),
    ).toBe(true);
  });

  it("keeps an unproven EC2 candidate ephemeral and marks failed bootstrap for cleanup", async () => {
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (args[0] === "ec2" && args[1] === "describe-instances") {
        return { stdout: "[]", stderr: "", exitCode: 0 };
      }
      if (args[0] === "pricing" && args[1] === "get-products") {
        return {
          stdout: JSON.stringify({ PriceList: [] }),
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`unexpected AWS call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
      defaultIamInstanceProfile: "ABOS-SSM",
    });
    const stub = lifecycleStub([], { bootstrapStatus: "degraded" });
    const executor = new AwsEc2TaskExecutor({
      provider,
      lifecycle: stub.lifecycle,
      identity: {
        name: "parent",
        address: "0x0000000000000000000000000000000000000001",
      } as any,
      config: {
        name: "parent",
        genesisPrompt: "Broad parent mission.",
        chainType: "evm",
      } as any,
      repositoryRef: "main",
    });

    await expect(executor.spawn(task())).rejects.toThrow(
      "did not produce a runnable executor",
    );

    expect(stub.provisionCalls).toBe(1);
    expect(
      (stub.provisionInputs[0] as { retentionPolicy: string }).retentionPolicy,
    ).toBe("ephemeral");
    expect(stub.resources[0]?.status).toBe("failed");
    expect(
      stub.mutations.some(
        (entry) => entry.operation === "executor_bootstrap_failed",
      ),
    ).toBe(true);
  });

  it("blocks before provisioning when a new SSM executor has no IAM instance profile", async () => {
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (args[0] === "--version") {
        return {
          stdout: "aws-cli/2",
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "sts" && args[1] === "get-caller-identity") {
        return {
          stdout: JSON.stringify({ Account: "123" }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "configure") {
        return {
          stdout: "us-east-1\n",
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(
        `AWS provisioning/inventory should not be reached: ${args.join(" ")}`,
      );
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
    });
    const stub = lifecycleStub();
    const executor = new AwsEc2TaskExecutor({
      provider,
      lifecycle: stub.lifecycle,
      identity: {} as any,
      config: {} as any,
    });

    const assessment = await executor.assess(task());

    expect(assessment.executable).toBe(false);
    expect(assessment.evidence?.join(" ")).toContain(
      "IAM instance profile",
    );
    expect(assessment.evidence?.join(" ")).toContain(
      "not proof that the objective is impossible",
    );

    await expect(executor.spawn(task())).rejects.toThrow(
      "requires an IAM instance profile",
    );
    expect(stub.provisionCalls).toBe(0);
  });

  it("returns an immediate semantic TaskResult from SSM transport", async () => {
    const expected: TaskResult = {
      success: true,
      output: "remote work complete",
      artifacts: ["/tmp/result.txt"],
      costCents: 7,
      duration: 321,
    };

    const calls: string[][] = [];
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      calls.push(args);
      if (args[0] === "ssm" && args[1] === "send-command") {
        return {
          stdout: JSON.stringify({
            Command: { CommandId: "cmd-task" },
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (
        args[0] === "ssm" &&
        args[1] === "wait" &&
        args[2] === "command-executed"
      ) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (args[0] === "ssm" && args[1] === "get-command-invocation") {
        return {
          stdout: JSON.stringify({
            CommandId: "cmd-task",
            Status: "Success",
            ResponseCode: 0,
            StandardOutputContent:
              `noise before marker\nABOS_TASK_RESULT_BASE64=${encodedResult(expected)}\n`,
            StandardErrorContent: "",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`unexpected AWS call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
    });
    const { lifecycle } = lifecycleStub([resource()]);
    const executor = new AwsEc2TaskExecutor({
      provider,
      lifecycle,
      identity: {} as any,
      config: {} as any,
    });

    const dispatched = await executor.dispatch(task(), {
      address: "aws://ec2/i-new",
      name: "aws-worker",
      spawned: true,
    });

    expect(dispatched.result).toMatchObject({
      success: true,
      output: expected.output,
      costCents: expected.costCents,
      duration: expected.duration,
    });
    expect(dispatched.result?.artifacts).toEqual([
      "aws://ec2/i-new/artifact/%2Ftmp%2Fresult.txt",
    ]);
    expect(dispatched.metadata?.delivery).toBe("aws_ssm");
    expect(dispatched.metadata?.artifactCollectionState).toBe("pending");
    expect(dispatched.metadata?.remoteArtifacts).toEqual([
      "/tmp/result.txt",
    ]);
    const send = calls.find(
      (args) => args[0] === "ssm" && args[1] === "send-command",
    );
    expect(send).toBeTruthy();
    expect(JSON.stringify(send)).toContain("--execute-task-file");
  });

  it("does not turn semantic Task failure into a transport failure", async () => {
    const expected: TaskResult = {
      success: false,
      output: "task could not satisfy its success criteria",
      artifacts: [],
      costCents: 3,
      duration: 99,
    };

    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (args[0] === "ssm" && args[1] === "send-command") {
        return {
          stdout: JSON.stringify({
            Command: { CommandId: "cmd-fail" },
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      if (args[0] === "ssm" && args[1] === "wait") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (args[0] === "ssm" && args[1] === "get-command-invocation") {
        return {
          stdout: JSON.stringify({
            CommandId: "cmd-fail",
            Status: "Success",
            ResponseCode: 0,
            StandardOutputContent:
              `ABOS_TASK_RESULT_BASE64=${encodedResult(expected)}\n`,
            StandardErrorContent: "",
          }),
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`unexpected AWS call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
    });
    const { lifecycle } = lifecycleStub([resource()]);
    const executor = new AwsEc2TaskExecutor({
      provider,
      lifecycle,
      identity: {} as any,
      config: {} as any,
    });

    const dispatched = await executor.dispatch(task(), {
      address: "aws://ec2/i-new",
      name: "aws-worker",
      spawned: false,
    });

    expect(dispatched.result?.success).toBe(false);
    expect(dispatched.result?.output).toContain("success criteria");
  });

  it("classifies orchestrator-harness one-shot execution as unavailable, not impossible", async () => {
    const runner: EnvironmentCommandRunner = async () => {
      throw new Error("AWS should not be inspected for a known harness mismatch");
    };

    const provider = new AwsEnvironmentProvider({ runner });
    const { lifecycle } = lifecycleStub();
    const executor = new AwsEc2TaskExecutor({
      provider,
      lifecycle,
      identity: {} as any,
      config: {} as any,
    });

    const assessment = await executor.assess(task("orchestrator"));

    expect(assessment.executable).toBe(false);
    expect(assessment.evidence?.join(" ")).toContain(
      "currently unavailable",
    );
    expect(assessment.evidence?.join(" ")).toContain(
      "not proof that the objective is impossible",
    );
  });
});
