import { describe, expect, it } from "vitest";
import {
  AwsEnvironmentProvider,
} from "../environments/aws.js";
import type {
  CommandResult,
  EnvironmentCommandRunner,
  EnvironmentResource,
} from "../environments/types.js";

function ok(stdout = ""): CommandResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function resource(
  overrides: Partial<EnvironmentResource> = {},
): EnvironmentResource {
  return {
    id: "resource-1",
    provider: "aws",
    externalId: "i-1234567890",
    type: "aws-ec2-instance",
    goalId: "goal-1",
    pathId: "path-1",
    taskId: "task-1",
    status: "running",
    region: "us-east-1",
    capabilities: ["remote compute", "ec2", "linux"],
    estimatedCostCents: 2,
    actualCostCents: 0,
    credentialsReference: "iam-instance-profile:ABOS-SSM",
    retentionPolicy: "until_goal_complete",
    providerState: "running",
    evidence: [],
    metadata: {
      instanceId: "i-1234567890",
      executorKind: "aws-ec2-ssm",
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastHealthCheck: null,
    ...overrides,
  };
}

describe("AwsEnvironmentProvider lifecycle", () => {
  it("provisions one tagged EC2 instance and waits for provider readiness", async () => {
    const calls: string[][] = [];
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      calls.push(args);

      if (args[0] === "ec2" && args[1] === "run-instances") {
        return ok(JSON.stringify({
          InstanceId: "i-abc",
          State: { Name: "pending" },
          InstanceType: "t3.small",
          ImageId: "ami-123",
        }));
      }
      if (
        args[0] === "ec2" &&
        args[1] === "wait" &&
        args[2] === "instance-running"
      ) {
        return ok();
      }
      if (args[0] === "ec2" && args[1] === "describe-instances") {
        return ok(JSON.stringify({
          InstanceId: "i-abc",
          State: { Name: "running" },
          InstanceType: "t3.small",
          ImageId: "ami-123",
          PrivateIpAddress: "10.0.0.10",
          Architecture: "x86_64",
          Placement: { AvailabilityZone: "us-east-1a" },
        }));
      }

      throw new Error(`unexpected aws call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
      defaultImageId: "ami-123",
      defaultInstanceType: "t3.small",
      defaultIamInstanceProfile: "ABOS-SSM",
    });

    const result = await provider.provision({
      resourceId: "01RESOURCEABC",
      resourceType: "ec2",
      retentionPolicy: "until_goal_complete",
      requiredCapabilities: ["remote compute"],
      goalId: "goal-1",
      pathId: "path-1",
      taskId: "task-1",
      selectionEstimateCents: 3,
      metadata: {
        name: "abos-worker",
        securityGroupIds: ["sg-1", "sg-2"],
      },
    });

    expect(result.externalId).toBe("i-abc");
    expect(result.status).toBe("ready");
    expect(result.region).toBe("us-east-1");
    expect(result.estimatedCostCents).toBe(3);
    expect(result.credentialsReference).toBe(
      "iam-instance-profile:ABOS-SSM",
    );

    const run = calls.find(
      (args) => args[0] === "ec2" && args[1] === "run-instances",
    );
    expect(run).toBeTruthy();
    expect(run).toContain("--iam-instance-profile");
    expect(run).toContain("Name=ABOS-SSM");
    expect(run).toContain("--security-group-ids");
    const tagIndex = run!.indexOf("--tag-specifications");
    expect(tagIndex).toBeGreaterThan(-1);
    const tags = JSON.parse(run![tagIndex + 1]);
    expect(tags[0].Tags).toEqual(
      expect.arrayContaining([
        { Key: "abos:managed", Value: "true" },
        { Key: "abos:resource-id", Value: "01RESOURCEABC" },
        { Key: "abos:goal-id", Value: "goal-1" },
        { Key: "abos:path-id", Value: "path-1" },
        { Key: "abos:task-id", Value: "task-1" },
        { Key: "Name", Value: "abos-worker" },
      ]),
    );
  });

  it("bootstraps through SSM argv without requiring SSH or persisted raw credentials", async () => {
    const calls: string[][] = [];
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      calls.push(args);

      if (args[0] === "ssm" && args[1] === "send-command") {
        return ok(JSON.stringify({
          Command: { CommandId: "cmd-1" },
        }));
      }
      if (
        args[0] === "ssm" &&
        args[1] === "wait" &&
        args[2] === "command-executed"
      ) {
        return ok();
      }
      if (args[0] === "ssm" && args[1] === "get-command-invocation") {
        return ok(JSON.stringify({
          CommandId: "cmd-1",
          Status: "Success",
          ResponseCode: 0,
          StandardOutputContent: "bootstrap ready",
          StandardErrorContent: "",
        }));
      }

      throw new Error(`unexpected aws call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
    });

    const result = await provider.bootstrap(resource(), {
      requiredCapabilities: ["task executor"],
      region: "us-east-1",
      metadata: {
        bootstrapCommands: [
          "echo one",
          "echo two",
        ],
      },
    });

    expect(result.status).toBe("running");
    expect(result.providerState).toBe("ssm:Success");
    expect(result.metadata?.ssmCommandId).toBe("cmd-1");

    const send = calls.find(
      (args) => args[0] === "ssm" && args[1] === "send-command",
    )!;
    const parametersIndex = send.indexOf("--parameters");
    expect(parametersIndex).toBeGreaterThan(-1);
    expect(JSON.parse(send[parametersIndex + 1])).toEqual({
      commands: ["echo one", "echo two"],
    });
  });

  it("treats EC2 control-plane absence conservatively during reconciliation", async () => {
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (args[0] === "ec2" && args[1] === "describe-instances") {
        return {
          stdout: "",
          stderr:
            "An error occurred (InvalidInstanceID.NotFound) when calling DescribeInstances",
          exitCode: 255,
        };
      }
      throw new Error(`unexpected aws call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
    });

    const unknown = await provider.reconcile(resource());
    expect(unknown.actualExists).toBe(false);
    expect(unknown.resource.status).toBe("unknown");
    expect(unknown.action).toBe("mark_unknown");

    const terminated = await provider.reconcile(
      resource({ status: "terminating" }),
    );
    expect(terminated.actualExists).toBe(false);
    expect(terminated.resource.status).toBe("terminated");
    expect(terminated.action).toBe("confirm_absent_after_termination");
  });

  it("combines managed-resource reuse evidence with AWS on-demand pricing", async () => {
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (args[0] === "ec2" && args[1] === "describe-instances") {
        return ok(JSON.stringify(["i-reusable"]));
      }

      if (args[0] === "pricing" && args[1] === "get-products") {
        return ok(JSON.stringify({
          PriceList: [
            JSON.stringify({
              terms: {
                OnDemand: {
                  offer: {
                    priceDimensions: {
                      dimension: {
                        pricePerUnit: {
                          USD: "0.0104",
                        },
                      },
                    },
                  },
                },
              },
            }),
          ],
        }));
      }

      throw new Error(`unexpected aws call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
      defaultInstanceType: "t3.micro",
    });

    const estimate = await provider.estimate({
      requiredCapabilities: [],
      expectedDurationMs: 3_600_000,
    });

    expect(estimate.reusableResourceCount).toBe(1);
    expect(estimate.estimatedCostCents).toBe(2);
    expect(estimate.metadata?.hourlyCostCents).toBe(2);
  });

  it("reports SSM-aware health for executor resources", async () => {
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (args[0] === "ec2" && args[1] === "describe-instances") {
        return ok(JSON.stringify({
          InstanceId: "i-1234567890",
          State: { Name: "running" },
          PrivateIpAddress: "10.0.0.4",
        }));
      }

      if (
        args[0] === "ssm" &&
        args[1] === "describe-instance-information"
      ) {
        return ok(JSON.stringify({
          PingStatus: "Online",
          PlatformType: "Linux",
          AgentVersion: "3.3.0",
        }));
      }

      throw new Error(`unexpected aws call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
    });

    const health = await provider.health(resource());
    expect(health.healthy).toBe(true);
    expect(health.status).toBe("running");
    expect(health.metadata?.ssmPingStatus).toBe("Online");
  });

  it("preserves running state while resizing an EC2 executor", async () => {
    const calls: string[][] = [];
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      calls.push(args);

      if (args[0] === "ec2" && args[1] === "describe-instances") {
        return ok(JSON.stringify({
          InstanceId: "i-1234567890",
          State: { Name: "running" },
          InstanceType: "t3.micro",
        }));
      }

      if (
        args[0] === "ec2" &&
        [
          "stop-instances",
          "start-instances",
          "modify-instance-attribute",
        ].includes(args[1])
      ) {
        return ok("{}");
      }

      if (args[0] === "ec2" && args[1] === "wait") {
        return ok();
      }

      throw new Error(`unexpected aws call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
    });

    const resized = await provider.resize(resource(), {
      instanceType: "t3.small",
    });

    expect(resized.status).toBe("running");
    expect(resized.metadata?.instanceType).toBe("t3.small");
    expect(
      calls.some(
        (args) =>
          args[0] === "ec2" &&
          args[1] === "modify-instance-attribute",
      ),
    ).toBe(true);
    expect(
      calls.some(
        (args) =>
          args[0] === "ec2" &&
          args[1] === "start-instances",
      ),
    ).toBe(true);
  });
});
