import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  AwsEnvironmentProvider,
} from "../environments/aws.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { createTestDb } from "./mocks.js";
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
  it("observes AWS Budgets COST evidence without inventing provider liquidity or authority", async () => {
    const calls: string[][] = [];
    const provider = new AwsEnvironmentProvider({
      runner: async (_command, args) => {
        calls.push(args);
        if (args[0] === "sts") {
          return ok(JSON.stringify({ Account: "123456789012" }));
        }
        if (args[0] === "budgets" && args[1] === "describe-budgets") {
          return ok(JSON.stringify({
            Budgets: [
              { BudgetType: "COST", BudgetName: "Monthly all-in",
                TimeUnit: "MONTHLY",
                BudgetLimit: { Amount: "100.00", Unit: "USD" },
                CalculatedSpend: { ActualSpend: { Amount: "35.20", Unit: "USD" } } },
              { BudgetType: "COST", BudgetName: "EC2 subset",
                TimeUnit: "MONTHLY",
                BudgetLimit: { Amount: "50.00", Unit: "USD" },
                CalculatedSpend: { ActualSpend: { Amount: "4.125", Unit: "USD" } } },
              { BudgetType: "USAGE", BudgetName: "compute hours",
                BudgetLimit: { Amount: "100", Unit: "Hrs" } },
            ],
          }));
        }
        throw new Error(`unexpected AWS call ${args.join(" ")}`);
      },
    });
    const observed = await provider.observeEconomics();
    expect(observed.status).toBe("observed");
    expect(observed.accountId).toBe("123456789012");
    expect(observed.budgets).toHaveLength(2);
    expect(observed.budgets[0]).toMatchObject({
      budgetLimitUsdCents: 10_000,
      reportedSpendUsdCents: 3_520,
    });
    expect(observed.budgets[1]).toMatchObject({
      budgetLimitUsdCents: 5_000,
      reportedSpendUsdCents: null,
      reportedSpendRaw: "4.125",
    });
    expect(observed.spendableLiquidityUsdCents).toBeNull();
    expect(observed.recurringCommitmentUsdCents).toBeNull();
    expect(observed.procurementAuthority).toBe("not_established");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([
      "budgets", "describe-budgets", "--account-id", "123456789012",
      "--max-items", "100", "--output", "json",
    ]);
  });

  it("preserves UNKNOWN when account identity, budgets permissions or coverage are incomplete", async () => {
    const noIdentity = new AwsEnvironmentProvider({
      runner: async () => ({ stdout: "", stderr: "unauthorized", exitCode: 1 }),
    });
    const unknown = await noIdentity.observeEconomics();
    expect(unknown.status).toBe("unknown");
    expect(unknown.accountId).toBeNull();
    expect(unknown.budgets).toEqual([]);

    const noBudgetPermission = new AwsEnvironmentProvider({
      runner: async (_cmd, args) => args[0] === "sts"
        ? ok(JSON.stringify({ Account: "123456789012" }))
        : { stdout: "", stderr: "AccessDenied", exitCode: 255 },
    });
    const partial = await noBudgetPermission.observeEconomics();
    expect(partial.status).toBe("partial");
    expect(partial.accountId).toBe("123456789012");
    expect(partial.budgets).toEqual([]);
    expect(partial.evidence.join(" ")).toContain("permission denied");

    const paginated = new AwsEnvironmentProvider({
      runner: async (_cmd, args) => args[0] === "sts"
        ? ok(JSON.stringify({ Account: "123456789012" }))
        : ok(JSON.stringify({
            Budgets: [{ BudgetType: "COST", BudgetName: "not cash",
              BudgetLimit: { Amount: "999", Unit: "EUR" },
              CalculatedSpend: { ActualSpend: { Amount: "0", Unit: "USD" } },
            }],
            NextToken: "another-page",
          })),
    });
    const incomplete = await paginated.observeEconomics();
    expect(incomplete.status).toBe("partial");
    expect(incomplete.budgets[0].budgetLimitUsdCents).toBeNull();
    expect(incomplete.budgets[0].reportedSpendUsdCents).toBe(0);
    expect(incomplete.spendableLiquidityUsdCents).toBeNull();
    expect(incomplete.evidence.join(" ")).toContain("paginated");
  });

  it("explicitly observes account-owned AWS Billing credits without treating them as cash", async () => {
    const calls: string[][] = [];
    const runner: EnvironmentCommandRunner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === "sts") return ok(JSON.stringify({ Account: "123456789012" }));
      if (args[0] === "budgets") return ok(JSON.stringify({ Budgets: [] }));
      if (args[0] === "billing" && args[1] === "get-credits") return ok(JSON.stringify({
        credits: [
          {
            creditId: "101", accountId: "123456789012", creditType: "Promotion",
            creditStatus: "ENABLED", endDate: 1910000000,
            remainingAmount: { currencyCode: "USD", currencyAmount: "28.50" },
            estimatedAmount: { currencyCode: "USD", currencyAmount: "21.10" },
            applicableProductNames: ["Amazon Elastic Compute Cloud"],
            purchaseTypeApplications: ["OnDemand"],
          },
          {
            creditId: "202", accountId: "123456789012", creditStatus: "DISABLED",
            remainingAmount: { currencyCode: "USD", currencyAmount: "5.125" },
            estimatedAmount: { currencyCode: "EUR", currencyAmount: "2.00" },
            applicableProductNames: ["Amazon S3"],
          },
          {
            creditId: "foreign", accountId: "999999999999",
            remainingAmount: { currencyCode: "USD", currencyAmount: "1000.00" },
          },
        ],
      }));
      throw new Error("unexpected AWS credit query");
    };
    const provider = new AwsEnvironmentProvider({ runner });
    const initial = await provider.observeEconomics();
    expect(initial.providerCredits).toBeUndefined();
    expect(calls.map(x => x[0])).toEqual(["sts", "budgets"]);
    calls.length = 0;
    const observed = await provider.observeEconomics({ includeProviderCredits: true });
    expect(calls.map(x => x[0])).toEqual(["sts", "billing", "budgets"]);
    const requested = calls[1];
    expect(requested).toContain("--no-payer-account-flag");
    expect(requested).toContain("123456789012");
    expect(requested).toContain("--start-date");
    expect(requested).toContain("us-east-1");
    expect(observed.accountId).toBe("123456789012");
    expect(observed.status).toBe("partial"); // A returned foreign-account record was excluded.
    expect(observed.providerCredits).toHaveLength(2);
    expect(observed.providerCredits![0]).toMatchObject({
      creditId: "101", status: "ENABLED",
      remainingUsdCents: 2850, estimatedRemainingUsdCents: 2110,
      applicableProductNames: ["Amazon Elastic Compute Cloud"],
      purchaseTypeApplications: ["OnDemand"],
    });
    expect(observed.providerCredits![1]).toMatchObject({
      creditId: "202", status: "DISABLED",
      remainingUsdCents: null, remainingRaw: "5.125",
      estimatedRemainingUsdCents: null,
    });
    expect(observed.providerCredits![1]!.evidence.join(" ")).toContain("not verified");
    expect(observed.spendableLiquidityUsdCents).toBeNull();
    expect(observed.recurringCommitmentUsdCents).toBeNull();
    expect(observed.procurementAuthority).toBe("not_established");
    expect(observed.evidence.join(" ")).toContain("different or missing owning AWS account");
  });

  it("preserves partial credit observations when Billing permissions are missing or payload malformed", async () => {
    for (const denied of [true, false]) {
      const calls: string[][] = [];
      const provider = new AwsEnvironmentProvider({
        runner: async (_cmd, args) => {
          calls.push(args);
          if (args[0] === "sts") return ok(JSON.stringify({ Account: "123456789012" }));
          if (args[0] === "billing") return denied
            ? { exitCode: 255, stdout: "", stderr: "AccessDenied" }
            : ok(JSON.stringify({ wrongShape: [] }));
          if (args[0] === "budgets") return ok(JSON.stringify({ Budgets: [] }));
          throw new Error("unexpected AWS query");
        },
      });
      const observed = await provider.observeEconomics({ includeProviderCredits: true });
      expect(observed.status).toBe("partial");
      expect(observed.providerCredits).toEqual([]);
      expect(observed.evidence.join(" ")).toContain("credit capital remains UNKNOWN");
      expect(observed.spendableLiquidityUsdCents).toBeNull();
      expect(calls.map(x => x[0])).toEqual(["sts", "billing", "budgets"]);
    }
  });

  it("provisions one tagged EC2 instance and waits for provider readiness", async () => {
    const calls: string[][] = [];
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      calls.push(args);

      if (args[0] === "sts" && args[1] === "get-caller-identity") {
        return ok(JSON.stringify({ Account: "123456789012" }));
      }
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
      authorizeNewProvision: async ({ accountId, instanceType, region, request }) => {
        expect(accountId).toBe("123456789012");
        expect(instanceType).toBe("t3.small");
        expect(region).toBe("us-east-1");
        expect(request.resourceId).toBe("01RESOURCEABC");
        return {
          allowed: true,
          policyDecisionId: "P010-P025-P030-reviewed-scenario",
          providerAccountId: accountId,
          authorizedResourceId: request.resourceId,
          authorizedInstanceType: instanceType,
          authorizedRegion: region,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          unit: "usd_cent",
          totalCommitmentCents: 150,
          billingTermsEvidence: ["Test-only verified USD recurring obligation and contingency scenario"],
        };
      },
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
    expect(result.metadata?.procurementAccountId).toBe("123456789012");
    expect(result.metadata?.procurementAuthorizedResourceId).toBe("01RESOURCEABC");
    expect(result.metadata?.procurementAuthorizedInstanceType).toBe("t3.small");
    expect(result.metadata?.procurementAuthorizedRegion).toBe("us-east-1");
    expect(Date.parse(String(result.metadata?.procurementAuthorizationExpiresAt)))
      .toBeGreaterThan(Date.now());
    expect(result.metadata?.procurementCostUnit).toBe("usd_cent");
    expect(result.metadata?.procurementCommittedCents).toBe(150);
    expect(result.metadata?.procurementPolicyDecisionId).toBe(
      "P010-P025-P030-reviewed-scenario",
    );
    expect(result.evidence?.join(" ")).toContain("NOT AWS billed-cost settlement");

    const run = calls.find(
      (args) => args[0] === "ec2" && args[1] === "run-instances",
    );
    expect(run).toBeTruthy();
    expect(run).toContain("--client-token");
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

  it("requires trusted account-scoped economics before any new EC2 side effect", async () => {
    const calls: string[][] = [];
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      calls.push(args);
      return ok(JSON.stringify({ Account: "123456789012" }));
    };
    const request = {
      resourceId: "new-billable-resource",
      resourceType: "ec2",
      retentionPolicy: "ephemeral",
      requiredCapabilities: ["remote compute"],
      goalId: "goal-1",
      pathId: "path-1",
      taskId: "task-1",
    };
    const options = {
      runner,
      defaultRegion: "us-east-1",
      defaultImageId: "ami-123",
      defaultInstanceType: "t3.micro",
      defaultIamInstanceProfile: "ABOS-SSM",
    };

    // An IAM role alone does not grant financial authorization.
    await expect(new AwsEnvironmentProvider(options).provision(request))
      .rejects.toThrow("procurement authority UNKNOWN");
    expect(calls).toEqual([]);

    const scope = {
      allowed: true,
      policyDecisionId: "policy-1",
      providerAccountId: "123456789012",
      authorizedResourceId: "new-billable-resource",
      authorizedInstanceType: "t3.micro",
      authorizedRegion: "us-east-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      unit: "usd_cent",
      totalCommitmentCents: 100,
      billingTermsEvidence: ["billed monthly"],
    };
    for (const decision of [
      { ...scope, allowed: false },
      { ...scope, providerAccountId: "OTHER-ACCOUNT" },
      { ...scope, policyDecisionId: "" },
      { ...scope, unit: "credit_cent" },
      { ...scope, totalCommitmentCents: undefined },
      { ...scope, billingTermsEvidence: [] },
      { ...scope, authorizedResourceId: "another-resource" },
      { ...scope, authorizedInstanceType: "t3.large" },
      { ...scope, authorizedRegion: "us-west-2" },
      { ...scope, expiresAt: new Date(Date.now() - 60_000).toISOString() },
      { ...scope, expiresAt: undefined },
    ]) {
      const provider = new AwsEnvironmentProvider({
        ...options,
        authorizeNewProvision: () => decision,
      });
      await expect(provider.provision(request)).rejects.toThrow(
        "economic procurement authorization is absent",
      );
      expect(calls.some((args) => args[0] === "ec2" && args[1] === "run-instances")).toBe(false);
    }
  });

  it("records rejected-before-dispatch AWS procurement as failed, not a ghost billable UNKNOWN", async () => {
    const db = createTestDb();
    try {
      const registry = new EnvironmentRegistry();
      let awsCalls = 0;
      registry.register(new AwsEnvironmentProvider({
        runner: async () => {
          awsCalls += 1;
          return ok("{}");
        },
        defaultRegion: "us-east-1",
        defaultImageId: "ami-123",
        defaultInstanceType: "t3.micro",
      }));
      const store = new EnvironmentResourceStore(db.raw);
      const lifecycle = new EnvironmentLifecycleManager(registry, store);
      await expect(lifecycle.provision("aws", {
        resourceId: "before-dispatch-denied",
        resourceType: "ec2",
        retentionPolicy: "ephemeral",
        requiredCapabilities: ["remote compute"],
      })).rejects.toMatchObject({ externalEffectNotDispatched: true });
      expect(awsCalls).toBe(0);
      const denied = store.get("before-dispatch-denied");
      expect(denied?.status).toBe("failed");
      expect(denied?.externalId).toBeNull();
      expect(denied?.metadata.provisionNeedsReconciliation).toBe(false);

      // A timeout AFTER a potential provider dispatch has different semantics.
      registry.register({
        id: "unknown-remote",
        inspect: async () => ({
          id: "unknown-remote", label: "Unknown remote", availability: "available",
          capabilities: [], constraints: [], evidence: [],
          observedAt: new Date().toISOString(),
        }),
        provision: async () => { throw new Error("timeout after provider may create"); },
      });
      await expect(lifecycle.provision("unknown-remote", {
        resourceId: "after-dispatch-unknown",
        resourceType: "vm",
        retentionPolicy: "ephemeral",
        requiredCapabilities: [],
      })).rejects.toThrow("timeout");
      const unknown = store.get("after-dispatch-unknown");
      expect(unknown?.status).toBe("unknown");
      expect(unknown?.metadata.provisionNeedsReconciliation).toBe(true);
    } finally {
      db.close();
    }
  });

  it("does not expose EC2 billable creation through raw provider-native commands", async () => {
    const calls: string[][] = [];
    const provider = new AwsEnvironmentProvider({
      runner: async (_command, args) => {
        calls.push(args);
        return ok("[]");
      },
    });
    for (const args of [
      ["ec2", "run-instances", "--image-id", "ami-123"],
      ["--profile", "default", "ec2", "create-fleet"],
      ["ec2", "--region", "us-east-1", "run-instances"],
      ["ec2", "request-spot-instances"],
      ["ec2", "start-instances"],
      ["ec2", "--region", "us-east-1", "modify-instance-attribute"],
      ["ec2", "modify-instance-credit-specification"],
    ]) {
      await expect(provider.execute(args)).rejects.toThrow(
        "tracked lifecycle and economic authority",
      );
    }
    expect(calls).toEqual([]);
    const safe = await provider.execute(["ec2", "describe-instances"]);
    expect(safe.exitCode).toBe(0);
    expect(calls).toEqual([["ec2", "describe-instances"]]);
  });

  it("recovers a provisioned EC2 after restart when InstanceId was not persisted", async () => {
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (
        args[0] === "ec2" &&
        args[1] === "describe-instances" &&
        args.includes("Name=tag:abos:resource-id,Values=resource-1")
      ) {
        return ok(JSON.stringify([
          {
            InstanceId: "i-recovered",
            State: { Name: "running" },
            InstanceType: "t3.micro",
            PrivateIpAddress: "10.0.0.8",
          },
        ]));
      }
      throw new Error(`unexpected aws call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
    });
    const missingExternal = resource({
      externalId: null,
      status: "provisioning",
      metadata: {},
    });

    const reconciled = await provider.reconcile(missingExternal);

    expect(reconciled.actualExists).toBe(true);
    expect(reconciled.action).toBe("adopt_by_resource_tag");
    expect(reconciled.resource.externalId).toBe("i-recovered");
    expect(reconciled.resource.status).toBe("running");
  });

  it("bootstraps through SSM argv without requiring SSH or persisted raw credentials", async () => {
    const calls: string[][] = [];
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      calls.push(args);

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
    expect(estimate.costUnit).toBe("usd_cent");
    expect(estimate.costCoverage).toBe("partial");
    expect(estimate.metadata?.hourlyCostCents).toBeCloseTo(1.04, 6);
    expect(estimate.metadata?.hourlyCostUnit).toBe("usd_cent");

    const injected = await provider.estimate({
      requiredCapabilities: [],
      expectedDurationMs: 3_600_000,
      metadata: { hourlyCostCents: 1.5 },
    });
    expect(injected.estimatedCostCents).toBe(2);
    expect(injected.costUnit).toBeNull();
    expect(injected.metadata?.hourlyCostUnit).toBeNull();
    const sourced = await provider.estimate({
      requiredCapabilities: [],
      expectedDurationMs: 3_600_000,
      metadata: { hourlyCostCents: 1.5, hourlyCostUnit: "usd_cent" },
    });
    expect(sourced.costUnit).toBe("usd_cent");
    expect(sourced.metadata?.hourlyCostUnit).toBe("usd_cent");
  });

  it("refuses to accrue an untyped hourly rate as USD and preserves sourced USD estimate", async () => {
    const provider = new AwsEnvironmentProvider({
      defaultRegion: "us-east-1",
      runner: async (_command, args) => {
        if (args[0] === "ec2" && args[1] === "describe-instances") {
          return ok(JSON.stringify({
            InstanceId: "i-1234567890",
            State: { Name: "running" },
          }));
        }
        if (args[0] === "ssm" && args[1] === "describe-instance-information") {
          return ok("null");
        }
        throw new Error(`unexpected AWS call ${args.join(" ")}`);
      },
    });
    const baseline = {
      instanceId: "i-1234567890",
      hourlyCostCents: 10,
      accruedComputeEstimateCents: 35,
      billingStartedAt: new Date(Date.now() - 3_600_000).toISOString(),
    };
    const untyped = await provider.health(resource({ metadata: baseline }));
    expect(untyped.healthy).toBe(true);
    expect(untyped.metadata?.accruedComputeEstimateCents).toBeNull();
    expect(untyped.metadata?.costEstimateScope).toContain("lacks verified usd_cent");
    expect(untyped.evidence.join(" ")).not.toContain("accrued estimate=");

    const usd = await provider.health(resource({
      metadata: { ...baseline, hourlyCostUnit: "usd_cent" },
    }));
    expect(usd.healthy).toBe(true);
    expect(usd.metadata?.accruedComputeEstimateCents).toBeGreaterThan(44);
    expect(usd.evidence.join(" ")).toContain("compute-only accrued estimate");
  });

  it("materializes pending runtime artifacts through chunked SSM collection", async () => {
    const artifactBody = Buffer.from(
      "remote artifact content\nsecond line\n",
      "utf8",
    );
    const compressed = gzipSync(artifactBody);
    const outputRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "abos-aws-artifacts-"),
    );
    const commandOutputs = new Map<string, string>();
    let commandCounter = 0;

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

      if (args[0] === "ssm" && args[1] === "send-command") {
        const parametersIndex = args.indexOf("--parameters");
        const parameters = JSON.parse(
          args[parametersIndex + 1] ?? "{}",
        ) as { commands?: string[] };
        const commandText = parameters.commands?.join("\n") ?? "";
        const commandId = `cmd-artifact-${++commandCounter}`;

        if (commandText.includes("ABOS_ARTIFACT_SIZE")) {
          commandOutputs.set(
            commandId,
            [
              `ABOS_ARTIFACT_RAW_SIZE=${artifactBody.length}`,
              `ABOS_ARTIFACT_SIZE=${compressed.length}`,
              "",
            ].join("\n"),
          );
        } else if (commandText.includes("dd if=")) {
          commandOutputs.set(
            commandId,
            compressed.toString("base64"),
          );
        } else {
          commandOutputs.set(commandId, "");
        }

        return ok(JSON.stringify({
          Command: { CommandId: commandId },
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
        const commandId = args[args.indexOf("--command-id") + 1]!;
        return ok(JSON.stringify({
          CommandId: commandId,
          Status: "Success",
          ResponseCode: 0,
          StandardOutputContent: commandOutputs.get(commandId) ?? "",
          StandardErrorContent: "",
        }));
      }

      throw new Error(`unexpected aws call: ${args.join(" ")}`);
    };

    const provider = new AwsEnvironmentProvider({
      runner,
      defaultRegion: "us-east-1",
      ssmReadyAttempts: 1,
      ssmReadyIntervalMs: 0,
      artifactOutputRoot: outputRoot,
      artifactMaxBytes: 64 * 1024,
      artifactMaxCompressedBytes: 64 * 1024,
      artifactChunkBytes: 15_000,
    });

    try {
      const collected = await provider.collect(resource({
        metadata: {
          instanceId: "i-1234567890",
          executorKind: "aws-ec2-ssm",
          installRoot: "/opt/abos",
          artifactCollectionState: "pending",
          remoteArtifacts: ["result.txt"],
        },
      }));

      expect(collected.metadata?.artifactCollectionState).toBe(
        "collected",
      );
      expect(collected.metadata?.remoteArtifacts).toEqual([]);
      expect(collected.artifacts).toHaveLength(1);
      expect(fs.readFileSync(collected.artifacts[0]!, "utf8")).toBe(
        artifactBody.toString("utf8"),
      );
      expect(
        (collected.metadata?.collectedArtifacts as Array<{
          remotePath: string;
          localPath: string;
        }>)[0],
      ).toMatchObject({
        remotePath: "result.txt",
        localPath: collected.artifacts[0],
      });
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
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

  it("observes recent CloudWatch CPU as opt-in measured utilization, not total capacity", async () => {
    const calls: string[][] = [];
    const observedAt = new Date(Date.now() - 4 * 60_000).toISOString();
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      calls.push(args);
      if (args[0] === "ec2" && args[1] === "describe-instances") {
        return ok(JSON.stringify({
          InstanceId: "i-1234567890", State: { Name: "running" },
        }));
      }
      if (args[0] === "ssm" && args[1] === "describe-instance-information") {
        return ok(JSON.stringify({ PingStatus: "Online" }));
      }
      if (args[0] === "cloudwatch" && args[1] === "get-metric-statistics") {
        expect(args).toContain("AWS/EC2");
        expect(args).toContain("CPUUtilization");
        expect(args).toContain("Name=InstanceId,Value=i-1234567890");
        return ok(JSON.stringify({
          Datapoints: [
            { Timestamp: observedAt, Average: 27.5 },
            { Timestamp: new Date(Date.now() - 8 * 60_000).toISOString(), Average: 64 },
          ],
        }));
      }
      throw new Error(`unexpected aws call: ${args.join(" ")}`);
    };
    const provider = new AwsEnvironmentProvider({
      runner, defaultRegion: "us-east-1", observeCloudWatchCpuUtilization: true,
    });
    const health = await provider.health(resource());
    expect(health.healthy).toBe(true);
    expect(health.status).toBe("running");
    expect(health.metadata?.cpuUtilizationAveragePct).toBe(27.5);
    expect(health.metadata?.cpuUtilizationObservedAt).toBe(observedAt);
    expect(health.metadata?.cpuUtilizationMetricStatus).toBe("observed");
    expect(health.evidence.join(" ")).toContain("CPU alone is not total capacity or invoice evidence");
    expect(calls.filter(args => args[0] === "cloudwatch")).toHaveLength(1);
  });

  it("keeps utilization UNKNOWN without altering healthy EC2 state when CloudWatch is denied or unmeasured", async () => {
    for (const mode of ["denied", "no_valid_measurement"] as const) {
      const runner: EnvironmentCommandRunner = async (_command, args) => {
        if (args[0] === "ec2" && args[1] === "describe-instances") {
          return ok(JSON.stringify({
            InstanceId: "i-1234567890", State: { Name: "running" },
          }));
        }
        if (args[0] === "ssm" && args[1] === "describe-instance-information") {
          return ok(JSON.stringify({ PingStatus: "Online" }));
        }
        if (args[0] === "cloudwatch" && args[1] === "get-metric-statistics") {
          return mode === "denied"
            ? { stdout: "", stderr: "AccessDenied", exitCode: 254 }
            : ok(JSON.stringify({ Datapoints: [{ Timestamp: new Date(Date.now() - 60_000).toISOString(), Average: 120 }] }));
        }
        throw new Error(`unexpected aws call: ${args.join(" ")}`);
      };
      const provider = new AwsEnvironmentProvider({
        runner, defaultRegion: "us-east-1", observeCloudWatchCpuUtilization: true,
      });
      const health = await provider.health(resource());
      expect(health.healthy).toBe(true);
      expect(health.status).toBe("running");
      expect(health.metadata?.cpuUtilizationAveragePct).toBeNull();
      expect(health.metadata?.cpuUtilizationObservedAt).toBeNull();
      expect(health.metadata?.cpuUtilizationMetricStatus).toBe("unknown");
      expect(health.evidence.join(" ")).toContain("CPU utilization UNKNOWN");
    }
  });

  it("expires stale CPU measurements durably when the provider no longer observes EC2", async () => {
    const db = createTestDb();
    try {
      const calls: string[][] = [];
      const registry = new EnvironmentRegistry();
      registry.register(new AwsEnvironmentProvider({
        defaultRegion: "us-east-1",
        observeCloudWatchCpuUtilization: true,
        runner: async (_command, args) => {
          calls.push(args);
          if (args[0] === "ec2" && args[1] === "describe-instances") {
            return ok("null");
          }
          throw new Error(`unexpected AWS call: ${args.join(" ")}`);
        },
      }));
      const store = new EnvironmentResourceStore(db.raw);
      const owned = store.create({
        provider: "aws", type: "aws-ec2-instance",
        externalId: "i-1234567890", region: "us-east-1",
        status: "running", metadata: {
          instanceId: "i-1234567890",
          cpuUtilizationAveragePct: 90,
          cpuUtilizationObservedAt: new Date(Date.now() - 60_000).toISOString(),
          cpuUtilizationMetricStatus: "observed",
        },
      });
      const lifecycle = new EnvironmentLifecycleManager(registry, store);
      const refreshed = await lifecycle.health(owned.id);
      expect(refreshed.status).toBe("unknown");
      expect(refreshed.metadata.cpuUtilizationAveragePct).toBeNull();
      expect(refreshed.metadata.cpuUtilizationObservedAt).toBeNull();
      expect(refreshed.metadata.cpuUtilizationMetricStatus).toBe("unknown");
      expect(store.get(owned.id)?.metadata.cpuUtilizationAveragePct).toBeNull();
      expect(calls.some(args => args[0] === "cloudwatch")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("preserves running state while resizing an EC2 executor", async () => {
    const calls: string[][] = [];
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      calls.push(args);

      if (args[0] === "sts" && args[1] === "get-caller-identity") {
        return ok(JSON.stringify({ Account: "123456789012" }));
      }
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
      authorizeBillableMutation: ({ operation, accountId, resource: target,
        instanceId, region, targetInstanceType }) => ({
        allowed: true,
        policyDecisionId: "source-test-resize-scope",
        providerAccountId: accountId,
        authorizedResourceId: target.id,
        authorizedExternalId: instanceId,
        authorizedOperation: operation,
        authorizedRegion: region,
        authorizedInstanceType: targetInstanceType,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        totalCommitmentCents: 250,
        unit: "usd_cent",
        billingTermsEvidence: ["Source-only test fixture: independently attested cost and contingency."],
      }),
    });

    const resized = await provider.resize(resource(), {
      instanceType: "t3.small",
    });

    expect(resized.status).toBe("running");
    expect(resized.metadata?.instanceType).toBe("t3.small");
    expect(resized.metadata?.lastEconomicMutationDecisionId)
      .toBe("source-test-resize-scope");
    expect(resized.metadata?.lastEconomicMutationOperation).toBe("resize");
    expect(resized.metadata?.lastEconomicMutationIsSettledInvoice).toBe(false);
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
