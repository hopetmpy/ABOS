import { describe, expect, it } from "vitest";
import {
  AwsEnvironmentProvider,
  type AwsEc2MutationEconomicDecision,
} from "../environments/aws.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { createTestDb } from "./mocks.js";
import type { EnvironmentCommandRunner, EnvironmentResource } from "../environments/types.js";

function ownedResource(): EnvironmentResource {
  return {
    id: "existing-resource",
    provider: "aws",
    externalId: "i-test",
    type: "aws-ec2-instance",
    status: "suspended",
    goalId: null, pathId: null, taskId: null,
    region: "us-east-1",
    capabilities: ["ec2"],
    estimatedCostCents: 1,
    actualCostCents: 0,
    credentialsReference: null,
    retentionPolicy: "until_goal_complete",
    providerState: "stopped",
    evidence: [],
    metadata: { instanceType: "t3.micro" },
    createdAt: "2026-10-15T00:00:00Z",
    updatedAt: "2026-10-15T00:00:00Z",
    lastHealthCheck: null,
  };
}

function harness(state = "stopped") {
  const calls: string[][] = [];
  const runner: EnvironmentCommandRunner = async (_cmd, argv) => {
    calls.push(argv);
    if (argv[0] === "sts" && argv[1] === "get-caller-identity")
      return { stdout: JSON.stringify({ Account: "123456789012" }), stderr: "", exitCode: 0 };
    if (argv[0] === "ec2" && argv[1] === "describe-instances")
      return { stdout: JSON.stringify({
        InstanceId: "i-test",
        State: { Name: state },
        InstanceType: "t3.micro",
      }), stderr: "", exitCode: 0 };
    if (argv[0] === "ec2" && ["start-instances", "stop-instances",
      "modify-instance-attribute", "wait"].includes(argv[1]!))
      return { stdout: "{}", stderr: "", exitCode: 0 };
    throw new Error("unexpected control-plane call " + argv.join(" "));
  };
  const billable = () => calls.filter(c =>
    c[0] === "ec2" && ["start-instances", "stop-instances",
      "modify-instance-attribute"].includes(c[1]!));
  return { runner, calls, billable };
}

function decision(scope: {
  operation: "resume" | "recover" | "resize";
  resource: EnvironmentResource;
  accountId: string;
  instanceId: string;
  region: string;
  targetInstanceType: string;
}): AwsEc2MutationEconomicDecision {
  return {
    allowed: true,
    policyDecisionId: "mock-only-p010-decision",
    providerAccountId: scope.accountId,
    authorizedResourceId: scope.resource.id,
    authorizedExternalId: scope.instanceId,
    authorizedOperation: scope.operation,
    authorizedRegion: scope.region,
    authorizedInstanceType: scope.targetInstanceType,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    unit: "usd_cent",
    totalCommitmentCents: 220,
    billingTermsEvidence: ["Synthetic account-scoped recurring supplier terms."],
  };
}
type Operation = "resize" | "resume" | "recover";
async function run(
  provider: AwsEnvironmentProvider,
  operation: Operation,
  resource = ownedResource(),
) {
  if (operation === "resize") {
    return provider.resize(resource, { instanceType: "t3.small" });
  }
  if (operation === "resume") return provider.resume(resource);
  return provider.recover(resource);
}

describe("P-031 EC2 billable mutation boundaries", () => {
  it("blocks resize, resume and stopped-instance recovery before any billable mutation when no issuer is wired", async () => {
    for (const operation of ["resize", "resume", "recover"] as const) {
      const h = harness();
      const provider = new AwsEnvironmentProvider({
        runner: h.runner, defaultRegion: "us-east-1",
      });
      await expect(run(provider, operation)).rejects.toMatchObject({
        externalEffectNotDispatched: true,
      });
      expect(h.billable()).toEqual([]);
      expect(h.calls.filter(x => x[0] === "sts")).toEqual([]);
    }
  });

  it("rejects mismatched or expired account/resource/action/type/region/terms before billing effects", async () => {
    for (const alteration of [
      { allowed: false },
      { policyDecisionId: "" },
      { providerAccountId: "222222222222" },
      { authorizedResourceId: "another-resource" },
      { authorizedExternalId: "i-another" },
      { authorizedOperation: "recover" as const },
      { authorizedRegion: "us-west-2" },
      { authorizedInstanceType: "t3.medium" },
      { expiresAt: "2000-01-01T00:00:00Z" },
      { unit: "credit_cent" },
      { totalCommitmentCents: undefined },
      { billingTermsEvidence: [] },
    ]) {
      const h = harness();
      const provider = new AwsEnvironmentProvider({
        runner: h.runner,
        authorizeBillableMutation: scope => ({ ...decision(scope), ...alteration }),
      });
      await expect(provider.resize(ownedResource(), { instanceType: "t3.small" }))
        .rejects.toThrow("billable mutation mandate absent");
      expect(h.billable()).toEqual([]);
      expect(h.calls.some(x => x[0] === "sts")).toBe(true);
    }
  });

  it("allows each precisely scoped mock-authorized mutation and records decision intent separately from invoices", async () => {
    for (const operation of ["resize", "resume", "recover"] as const) {
      const h = harness();
      const provider = new AwsEnvironmentProvider({
        runner: h.runner,
        authorizeBillableMutation: scope => decision(scope),
      });
      const updated = await run(provider, operation);
      expect(updated.metadata?.lastEconomicMutationDecisionId).toBe("mock-only-p010-decision");
      expect(updated.metadata?.lastEconomicMutationOperation).toBe(operation);
      expect(updated.metadata?.lastEconomicMutationIsSettledInvoice).toBe(false);
      expect(h.billable().length).toBeGreaterThan(0);
      expect(h.calls.some(x => x[0] === "sts")).toBe(true);
    }
  });

  it("observes already-running recovery/resume without new monetary authorization or provider mutation", async () => {
    const h = harness("running");
    const provider = new AwsEnvironmentProvider({ runner: h.runner });
    expect((await provider.recover(ownedResource())).status).toBe("running");
    expect((await provider.resume(ownedResource())).status).toBe("running");
    expect(h.billable()).toEqual([]);
    expect(h.calls.filter(x => x[0] === "sts")).toEqual([]);
  });

  it("records definitely-denied pre-dispatch lifecycle resume without degrading owned stopped resource", async () => {
    const db = createTestDb();
    try {
      const h = harness();
      const registry = new EnvironmentRegistry();
      registry.register(new AwsEnvironmentProvider({
        runner: h.runner,
      }));
      const store = new EnvironmentResourceStore(db.raw);
      store.create({
        id: "existing-resource",
        provider: "aws",
        externalId: "i-test",
        type: "aws-ec2-instance",
        status: "suspended",
        region: "us-east-1",
        providerState: "stopped",
        metadata: { instanceType: "t3.micro" },
      });
      const lifecycle = new EnvironmentLifecycleManager(registry, store);
      await expect(lifecycle.resume("existing-resource"))
        .rejects.toMatchObject({ externalEffectNotDispatched: true });
      expect(store.get("existing-resource")?.status).toBe("suspended");
      expect(store.get("existing-resource")?.providerState).toBe("stopped");
      expect(h.billable()).toEqual([]);
    } finally { db.close(); }
  });
});
