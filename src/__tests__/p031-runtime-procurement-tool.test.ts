import { describe, expect, it, vi } from "vitest";
import { AdaptiveStore } from "../intelligence/store.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { createEnvironmentTools } from "../environments/tools.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { createLifecycleProcurementDependencies } from "../environments/procurement-lifecycle-adapter.js";
import { AwsEc2ProcurementNotDispatchedError, AwsEnvironmentProvider } from "../environments/aws.js";
import { createAwsClaimedProvisionAuthority } from "../environments/aws-procurement-authority.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import { createTestDb } from "./mocks.js";
import { insertGoal, insertTask } from "../state/database.js";
import {
  PROVIDER_PROCUREMENT_POLICY_TOOL,
  procurementPolicyArgs,
  type ProviderProcurementScope,
  type ProviderProcurementExecutionDependencies,
} from "../economics/provider-procurement-execution.js";
import type { ProviderProcurementScenarioInput } from "../economics/treasury-scenario.js";
import type { PolicyRequest } from "../types.js";

function createScenario(): ProviderProcurementScenarioInput {
  return {
    provider: "synthetic", accountId: "account-1", unit: "usd_cent",
    resourceNeedEvidence: ["Synthetic Task demands compute."],
    alternatives: [{
      id: "reuse", projectedCostCents: 1100, unit: "usd_cent",
      evidence: "Owned capacity compared and insufficient.",
    }],
    cost: {
      oneTimeCents: 200, recurringCentsPerPeriod: 100, periods: 2,
      otherChargesCents: 50, unpricedComponents: [],
      billingTermsEvidence: ["Complete synthetic provider quote."],
      lifecycleTerms: {
        renewal: "manual", additionalCommittedRenewalCents: 0,
        additionalExitChargeCents: 0, source: "synthetic provider",
        evidence: ["Manual renewal only."],
      },
    },
    financing: {
      accountId: "account-1", unit: "usd_cent", basis: "externally_observed",
      observedAvailableCents: 5000, observedAt: "2026-10-16T10:00:00Z",
      validUntil: "2030-01-01T00:00:00Z",
      evidence: ["Synthetic trusted adapter funding observation, NOT live."],
    },
    reservedCents: 100, existingCommitmentsCents: 200,
    additionalContingencyCents: 300,
    contingencyEvidence: ["Synthetic downside reserve."],
  };
}

function setup() {
  const db = createTestDb();
  const goalId = insertGoal(db.raw, {
    title: "SaaS delivery", description: "Need a bounded resource",
  });
  const taskId = insertTask(db.raw, {
    goalId, title: "Acquire resource", description: "Verify and provision",
  });
  const store = new AdaptiveStore(db.raw);
  const path = store.getOrCreatePath({
    goalId, hypothesis: "Needed resource enables delivery",
    strategy: "Observe quote then acquire",
    assumptions: ["Supplier terms verified"],
    requiredCapabilities: ["compute"],
    sequence: ["compare", "acquire", "verify"],
    expectedOutcome: "Usable resource",
  });
  store.bindTask({ goalId, taskId, pathId: path.id });
  store.setPathStatus(path.id, "selected");
  db.raw.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .run(`orchestrator.review_feedback.${goalId}`, `approved and materialized; materialized_path=${path.id}`);
  const scope: ProviderProcurementScope = {
    operationKey: "p031-runtime-acquire-1",
    operation: "provision", provider: "synthetic",
    providerAccountId: "account-1", unit: "usd_cent",
    goalId, taskId, pathId: path.id, resourceId: "r-1",
    region: "test-region", resourceShape: "synthetic.large",
  };
  const registry = new EnvironmentRegistry();
  registry.register({
    id: "synthetic",
    inspect: async () => ({
      id: "synthetic", label: "Synthetic provider", availability: "available",
      capabilities: ["compute"], evidence: ["Test only"],
      constraints: [], observedAt: new Date().toISOString(),
    }),
  } as any);
  const args = {
    operation_key: scope.operationKey, operation: scope.operation,
    provider: scope.provider, provider_account_id: scope.providerAccountId,
    unit: scope.unit, goal_id: scope.goalId, task_id: scope.taskId,
    path_id: scope.pathId, resource_id: scope.resourceId,
    region: scope.region, resource_shape: scope.resourceShape,
  };
  return { db, scope, registry, args };
}

function exactP010Decision(db: ReturnType<typeof createTestDb>,
  scope: ProviderProcurementScope, scenario: ProviderProcurementScenarioInput): string {
  const engine = new PolicyEngine(db.raw, [{
    id: "synthetic-exact-authority",
    description: "Fixture only, not real provider spending rights",
    priority: 1,
    appliesTo: { by: "name" as const, names: [PROVIDER_PROCUREMENT_POLICY_TOOL] },
    evaluate: () => ({
      rule: "synthetic.exact_authority", action: "allow" as const,
      reasonCode: "ALLOW", humanMessage: "Scoped test rule.",
    }),
  }]);
  const request: PolicyRequest = {
    tool: {
      name: PROVIDER_PROCUREMENT_POLICY_TOOL,
      description: "Synthetic test-scoped procurement authorization",
      parameters: { type: "object", properties: {} },
      execute: async () => "", category: "financial", riskLevel: "dangerous",
    },
    args: procurementPolicyArgs(scope, scenario),
    context: {} as any,
    turnContext: { inputSource: "agent", turnToolCallCount: 1 },
  };
  const decision = engine.evaluate(request);
  engine.persistDecision(decision, request);
  return decision.id!;
}

describe("P-031 agent environment_procurement_execute runtime route", () => {
  it("advertises a financial-risk tool but dispatches nothing when a trusted host adapter is missing", async () => {
    const { db, registry, args } = setup();
    try {
      const tool = createEnvironmentTools(registry)
        .find(t => t.name === "environment_procurement_execute")!;
      expect(tool).toBeDefined();
      expect(tool.category).toBe("financial");
      expect(tool.riskLevel).toBe("dangerous");
      const response = await tool.execute({
        ...args, policy_decision_id: "untrusted-claim",
      }, { db } as any);
      expect(response).toContain("UNAVAILABLE");
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects")
        .get()).toMatchObject({ n: 0 });
      expect(response).toContain("no monetary action");
    } finally { db.close(); }
  });

  it("runs the real P-025/P-010/P-030 economic engine through agent tool with a trusted synthetic adapter, then refuses duplicate effects", async () => {
    const { db, registry, scope, args } = setup();
    try {
      const quote = createScenario();
      const decisionId = exactP010Decision(db, scope, quote);
      const dispatch = vi.fn(async () => ({
        status: "usable" as const, providerEffectId: "synthetic-resource-1",
        providerStatus: "mock-only",
        evidence: ["Synthetic provider dispatched without a real account."],
      }));
      const dependencies: ProviderProcurementExecutionDependencies = {
        observeAuthenticatedEconomics: async () => quote,
        dispatch,
        verifyResourceUsability: async () => ({
          usable: true, resourceId: scope.resourceId,
          evidence: ["Independent synthetic P-018 readiness observed."],
        }),
      };
      const tools = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: provider =>
          provider === "synthetic" ? dependencies : null,
      });
      const tool = tools.find(t => t.name === "environment_procurement_execute")!;
      const input = { ...args, policy_decision_id: decisionId };
      const first = JSON.parse(await tool.execute(input, { db } as any));
      expect(first.status).toBe("usable");
      expect(first.dispatched).toBe(true);
      expect(first.financialEffectState).toBe("pending");
      expect(first.supplierSettlement).toBe("UNKNOWN");
      const second = JSON.parse(await tool.execute(input, { db } as any));
      expect(second.status).toBe("not_dispatched");
      expect(second.dispatched).toBe(false);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects")
        .get()).toMatchObject({ n: 1 });
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM transactions")
        .get()).toMatchObject({ n: 0 });
    } finally { db.close(); }
  });

  it("rejects missing exact P-010 policy provenance even with trusted economics and dispatch adapter", async () => {
    const { db, registry, args } = setup();
    try {
      const dispatch = vi.fn(async () => ({
        status: "usable" as const, evidence: ["should never run"],
      }));
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: () => ({
          observeAuthenticatedEconomics: async () => createScenario(),
          dispatch,
        }),
      }).find(t => t.name === "environment_procurement_execute")!;
      const response = await tool.execute({
        ...args, policy_decision_id: "not-a-real-p010-decision",
      }, { db } as any);
      expect(response).toContain("BLOCKED");
      expect(dispatch).not.toHaveBeenCalled();
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects")
        .get()).toMatchObject({ n: 0 });
    } finally { db.close(); }
  });

  it("routes the actual agent catalog through host-backed P-018 provisioning and independently checked health", async () => {
    const { db, registry, scope, args } = setup();
    try {
      const calls: string[] = [];
      registry.register({
        id: "synthetic",
        async inspect() {
          return {
            id: "synthetic", label: "Trusted synthetic provider",
            availability: "available", capabilities: [],
            evidence: ["Test-only provider."], constraints: [],
            observedAt: new Date().toISOString(),
          };
        },
        async provision(request) {
          calls.push(request.resourceId);
          expect(request.goalId).toBe(scope.goalId);
          expect(request.pathId).toBe(scope.pathId);
          expect(request.taskId).toBe(scope.taskId);
          expect(request.region).toBe(scope.region);
          return {
            status: "running", externalId: "synthetic-external-1",
            providerState: "running",
            evidence: ["Synthetic provider accepted one resource."],
          };
        },
        async health(resource) {
          expect(resource.externalId).toBe("synthetic-external-1");
          return {
            healthy: true, status: "running",
            evidence: ["Independent synthetic provider health observation."],
          };
        },
      });
      const lifecycle = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db.raw),
      );
      const quote = createScenario();
      const policyDecisionId = exactP010Decision(db, scope, quote);
      const dependencies = createLifecycleProcurementDependencies(lifecycle, {
        observeAuthenticatedEconomics: async () => quote,
        resolveProvisionRequest: async () => ({
          resourceType: "synthetic-compute",
          requiredCapabilities: ["compute"],
          retentionPolicy: "until_goal_complete",
          metadata: { instanceType: scope.resourceShape },
        }),
      });
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: (provider, operation) =>
          provider === "synthetic" && operation === "provision"
            ? dependencies : null,
      }).find(t => t.name === "environment_procurement_execute")!;

      const input = { ...args, policy_decision_id: policyDecisionId };
      const first = JSON.parse(await tool.execute(input, { db } as any));
      expect(first.status).toBe("usable");
      expect(first.dispatched).toBe(true);
      expect(first.financialEffectState).toBe("pending");
      expect(first.supplierSettlement).toBe("UNKNOWN");
      expect(calls).toEqual([scope.resourceId]);
      const resource = lifecycle.resources.get(scope.resourceId)!;
      expect(resource.provider).toBe(scope.provider);
      expect(resource.status).toBe("running");
      expect(resource.goalId).toBe(scope.goalId);
      expect(resource.taskId).toBe(scope.taskId);
      expect(resource.pathId).toBe(scope.pathId);
      expect(resource.lastHealthCheck).not.toBeNull();
      expect(resource.externalId).toBe("synthetic-external-1");

      const replay = JSON.parse(await tool.execute(input, { db } as any));
      expect(replay.dispatched).toBe(false);
      expect(replay.status).toBe("not_dispatched");
      expect(calls).toHaveLength(1);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get())
        .toMatchObject({ n: 0 });
    } finally {
      db.close();
    }
  });

  it("keeps P-018 unhealthy provision separate from paid settlement and does not re-dispatch", async () => {
    const { db, registry, scope, args } = setup();
    try {
      const calls: string[] = [];
      registry.register({
        id: "synthetic",
        async inspect() {
          return {
            id: "synthetic", label: "Synthetic unhealthy service",
            availability: "available", capabilities: [],
            evidence: ["Test-only provider."], constraints: [],
            observedAt: new Date().toISOString(),
          };
        },
        async provision(request) {
          calls.push(request.resourceId);
          return { status: "ready", externalId: "synthetic-resource-unhealthy" };
        },
        async health() {
          return {
            healthy: false, status: "running",
            evidence: ["Provider says running but confirms unhealthy: no false usability."],
          };
        },
      });
      const lifecycle = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db.raw),
      );
      const quote = createScenario();
      const policyDecisionId = exactP010Decision(db, scope, quote);
      const dependencies = createLifecycleProcurementDependencies(lifecycle, {
        observeAuthenticatedEconomics: async () => quote,
        resolveProvisionRequest: async () => ({
          resourceType: "synthetic-compute",
          requiredCapabilities: ["compute"], retentionPolicy: "ephemeral",
        }),
      });
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: () => dependencies,
      }).find(t => t.name === "environment_procurement_execute")!;
      const input = { ...args, policy_decision_id: policyDecisionId };
      const result = JSON.parse(await tool.execute(input, { db } as any));
      expect(result.status).toBe("pending");
      expect(result.financialEffectState).toBe("pending");
      expect(lifecycle.resources.get(scope.resourceId)?.status).toBe("degraded");
      expect(calls).toHaveLength(1);
      const repeated = JSON.parse(await tool.execute(input, { db } as any));
      expect(repeated.dispatched).toBe(false);
      expect(calls).toHaveLength(1);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get())
        .toMatchObject({ n: 0 });
    } finally {
      db.close();
    }
  });

  it("releases P-030 unknown exposure on source-proven host preflight rejection without a provider call", async () => {
    const { db, registry, scope, args } = setup();
    try {
      const quote = createScenario();
      const policyDecisionId = exactP010Decision(db, scope, quote);
      const provision = vi.fn();
      registry.register({
        id: "synthetic",
        async inspect() {
          return {
            id: "synthetic", label: "Synthetic provider", availability: "available",
            capabilities: [], constraints: [], evidence: ["test"], observedAt: new Date().toISOString(),
          };
        },
        provision,
      } as any);
      const lifecycle = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db.raw),
      );
      const deps = createLifecycleProcurementDependencies(lifecycle, {
        observeAuthenticatedEconomics: async () => quote,
        resolveProvisionRequest: async () => {
          throw new Error("Synthetic host specification missing before dispatch");
        },
      });
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: () => deps,
      }).find(t => t.name === "environment_procurement_execute")!;
      const input = { ...args, policy_decision_id: policyDecisionId };
      const result = JSON.parse(await tool.execute(input, { db } as any));
      expect(result.dispatched).toBe(false);
      expect(result.status).toBe("rejected");
      expect(result.financialEffectState).toBe("rejected");
      expect(lifecycle.resources.list()).toHaveLength(0);
      expect(provision).not.toHaveBeenCalled();
      const again = JSON.parse(await tool.execute(input, { db } as any));
      expect(again.dispatched).toBe(false);
      expect(provision).not.toHaveBeenCalled();
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get())
        .toMatchObject({ n: 0 });
    } finally { db.close(); }
  });

  it("distinguishes a trusted AWS-style pre-dispatch provider denial from an unknown response", async () => {
    const { db, registry, scope, args } = setup();
    try {
      const quote = createScenario();
      const policyDecisionId = exactP010Decision(db, scope, quote);
      const provision = vi.fn(async () => {
        throw new AwsEc2ProcurementNotDispatchedError(
          "Synthetic AWS gate rejected authorization before run-instances",
        );
      });
      registry.register({
        id: "synthetic",
        async inspect() {
          return {
            id: "synthetic", label: "Synthetic AWS gate", availability: "available",
            capabilities: [], constraints: [], evidence: ["test"], observedAt: new Date().toISOString(),
          };
        },
        provision,
      });
      const lifecycle = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db.raw),
      );
      const deps = createLifecycleProcurementDependencies(lifecycle, {
        observeAuthenticatedEconomics: async () => quote,
        resolveProvisionRequest: async () => ({
          resourceType: "test-only-ec2", requiredCapabilities: ["compute"],
          retentionPolicy: "ephemeral",
        }),
      });
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: () => deps,
      }).find(t => t.name === "environment_procurement_execute")!;
      const outcome = JSON.parse(await tool.execute({
        ...args, policy_decision_id: policyDecisionId,
      }, { db } as any));
      expect(outcome.dispatched).toBe(false);
      expect(outcome.status).toBe("rejected");
      expect(outcome.financialEffectState).toBe("rejected");
      const owned = lifecycle.resources.get(scope.resourceId)!;
      expect(owned.status).toBe("failed");
      expect(owned.externalId).toBeNull();
      expect(owned.metadata.provisionExternalEffectNotDispatched).toBe(true);
      expect(provision).toHaveBeenCalledTimes(1);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get())
        .toMatchObject({ n: 0 });
    } finally { db.close(); }
  });

  it("lets a trusted host issue exact P-010 authority only after source-verified supplier economics", async () => {
    const { db, registry, scope, args } = setup();
    try {
      const quote = createScenario();
      const order: string[] = [];
      const dispatch = vi.fn(async () => ({
        status: "usable" as const,
        providerEffectId: "synthetic-policy-issued-resource",
        evidence: ["No real provider dispatch."],
      }));
      const issuePolicyDecision = vi.fn(async (
        requestedScope: Readonly<ProviderProcurementScope>,
        observed: Readonly<ProviderProcurementScenarioInput>,
      ) => {
        order.push("policy");
        expect(order).toEqual(["economics", "policy"]);
        expect(requestedScope).toEqual(scope);
        expect(observed).toEqual(quote);
        return exactP010Decision(db, scope, quote);
      });
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: () => ({
          observeAuthenticatedEconomics: async () => {
            order.push("economics");
            return quote;
          },
          issuePolicyDecision,
          dispatch,
          verifyResourceUsability: async () => ({
            usable: true, resourceId: scope.resourceId,
            evidence: ["Synthetic independent resource observation."],
          }),
        }),
      }).find(t => t.name === "environment_procurement_execute")!;
      expect(tool.parameters.required as string[]).not.toContain("policy_decision_id");
      const first = JSON.parse(await tool.execute(args, { db } as any));
      expect(first.status).toBe("usable");
      expect(first.dispatched).toBe(true);
      expect(first.financialEffectState).toBe("pending");
      expect(first.supplierSettlement).toBe("UNKNOWN");
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(issuePolicyDecision).toHaveBeenCalledTimes(1);
      const again = JSON.parse(await tool.execute(args, { db } as any));
      expect(again.status).toBe("not_dispatched");
      expect(again.dispatched).toBe(false);
      expect(issuePolicyDecision).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get())
        .toMatchObject({ n: 0 });
    } finally { db.close(); }
  });

  it("does not treat an issuer claim or default-allow as a real P-010 procurement authority", async () => {
    const { db, registry, args, scope } = setup();
    try {
      const quote = createScenario();
      const dispatch = vi.fn(async () => ({
        status: "usable" as const, evidence: ["must not run"],
      }));
      const emptyPolicyEngine = new PolicyEngine(db.raw, []);
      const policyTool = {
        name: PROVIDER_PROCUREMENT_POLICY_TOOL,
        description: "Synthetic policy authority without positive rule",
        category: "financial" as const,
        riskLevel: "dangerous" as const,
        parameters: { type: "object", properties: {} },
        execute: async () => "",
      };
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: () => ({
          observeAuthenticatedEconomics: async () => quote,
          issuePolicyDecision: async (requestScope, observed) => {
            const request: PolicyRequest = {
              tool: policyTool,
              args: procurementPolicyArgs(requestScope, observed),
              context: {} as any,
              turnContext: { inputSource: "agent", turnToolCallCount: 1 },
            };
            const decision = emptyPolicyEngine.evaluate(request);
            emptyPolicyEngine.persistDecision(decision, request);
            return decision.id!;
          },
          dispatch,
        }),
      }).find(t => t.name === "environment_procurement_execute")!;
      const result = await tool.execute(args, { db } as any);
      expect(result).toContain("BLOCKED/UNKNOWN");
      expect(dispatch).not.toHaveBeenCalled();
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects").get())
        .toMatchObject({ n: 0 });
    } finally { db.close(); }
  });

  it("rejects unknown providers and invalid scope before looking up any trusted adapter", async () => {
    const { db, registry, args } = setup();
    try {
      const getTrustedProcurementDependencies = vi.fn(() => null);
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies,
      }).find(t => t.name === "environment_procurement_execute")!;
      expect(await tool.execute({ ...args, provider: "not-registered",
        policy_decision_id: "id" }, { db } as any)).toContain("UNAVAILABLE");
      expect(await tool.execute({ ...args, operation: "charge_anything",
        policy_decision_id: "id" }, { db } as any)).toContain("BLOCKED");
      expect(getTrustedProcurementDependencies).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
});

describe("P-031 AWS real lifecycle secondary gate, synthetic account only", () => {
  it("accepts exactly the P-030-claimed P-010-reviewed EC2 operation and refuses raw lifecycle bypass after the permit closes", async () => {
    const { db, scope: base, registry, args: original } = setup();
    try {
      const scope: ProviderProcurementScope = {
        ...base, provider: "aws", providerAccountId: "123456789012",
        resourceId: "aws-claimed-resource-1", region: "us-east-1",
        resourceShape: "t3.small",
      };
      const quote = createScenario();
      quote.provider = "aws";
      quote.accountId = scope.providerAccountId;
      quote.financing.accountId = scope.providerAccountId;
      const authority = createAwsClaimedProvisionAuthority(db.raw);
      const calls: string[][] = [];
      const runner = vi.fn(async (_command: string, argv: string[]) => {
        calls.push(argv);
        const success = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
        if (argv[0] === "sts") return success(JSON.stringify({ Account: scope.providerAccountId }));
        if (argv[0] === "ec2" && argv[1] === "run-instances") {
          return success(JSON.stringify({
            InstanceId: "i-claimed-1", State: { Name: "pending" },
            ImageId: "ami-synthetic-1", InstanceType: scope.resourceShape,
          }));
        }
        if (argv[0] === "ec2" && argv[1] === "wait") return success();
        if (argv[0] === "ec2" && argv[1] === "describe-instances") {
          return success(JSON.stringify({
            InstanceId: "i-claimed-1", State: { Name: "running" },
            ImageId: "ami-synthetic-1", InstanceType: scope.resourceShape,
          }));
        }
        if (argv[0] === "ssm") return success(JSON.stringify({ InstanceInformationList: [] }));
        throw new Error("Unrecognized synthetic AWS runner command");
      });
      const aws = new AwsEnvironmentProvider({
        runner, defaultRegion: scope.region, defaultImageId: "ami-synthetic-1",
        defaultInstanceType: scope.resourceShape,
        authorizeNewProvision: authority.authorizeNewProvision,
      });
      registry.register(aws);
      const lifecycle = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db.raw),
      );
      const prepared = {
        resourceType: "ec2",
        retentionPolicy: "until_goal_complete" as const,
        requiredCapabilities: ["remote compute"],
        metadata: { instanceType: scope.resourceShape },
      };
      // Same resource ID or apparent budget cannot supply the one-shot
      // provider mandate without the canonical financial dispatch claim.
      await expect(aws.provision({
        ...prepared, resourceId: scope.resourceId, region: scope.region,
        goalId: scope.goalId, taskId: scope.taskId, pathId: scope.pathId,
      })).rejects.toBeInstanceOf(AwsEc2ProcurementNotDispatchedError);
      expect(calls.filter(argv => argv[1] === "run-instances")).toHaveLength(0);

      const source = {
        observeAuthenticatedEconomics: async () => quote,
        issuePolicyDecision: async () => exactP010Decision(db, scope, quote),
        resolveProvisionRequest: async () => prepared,
      };
      const dependencies = createLifecycleProcurementDependencies(lifecycle, source, authority);
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: provider =>
          provider === "aws" ? dependencies : null,
      }).find(item => item.name === "environment_procurement_execute")!;
      const input = {
        ...original, provider: scope.provider,
        provider_account_id: scope.providerAccountId,
        resource_id: scope.resourceId, region: scope.region,
        resource_shape: scope.resourceShape,
      };
      const result = JSON.parse(await tool.execute(input, { db } as any));
      expect(result.status).toBe("usable");
      expect(result.dispatched).toBe(true);
      expect(result.financialEffectState).toBe("pending");
      expect(result.supplierSettlement).toBe("UNKNOWN");
      expect(calls.filter(argv => argv[0] === "ec2" && argv[1] === "run-instances"))
        .toHaveLength(1);
      const owned = lifecycle.resources.get(scope.resourceId);
      expect(owned?.externalId).toBe("i-claimed-1");
      expect(owned?.metadata.procurementAccountId).toBe(scope.providerAccountId);
      expect(owned?.metadata.procurementPolicyDecisionId).toBeTruthy();

      const replay = JSON.parse(await tool.execute(input, { db } as any));
      expect(replay.status).toBe("not_dispatched");
      await expect(aws.provision({
        ...prepared, resourceId: scope.resourceId, region: scope.region,
        goalId: scope.goalId, taskId: scope.taskId, pathId: scope.pathId,
      })).rejects.toBeInstanceOf(AwsEc2ProcurementNotDispatchedError);
      expect(calls.filter(argv => argv[0] === "ec2" && argv[1] === "run-instances"))
        .toHaveLength(1);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get())
        .toMatchObject({ n: 0 });
    } finally { db.close(); }
  });

  it("releases a P-030 intent as rejected when the second AWS mandate cannot match trusted resource shape", async () => {
    const { db, scope: original, registry, args } = setup();
    try {
      const scope: ProviderProcurementScope = {
        ...original, provider: "aws", providerAccountId: "123456789012",
        region: "us-east-1", resourceShape: "t3.small",
      };
      const quote = createScenario();
      quote.provider = "aws"; quote.accountId = scope.providerAccountId;
      quote.financing.accountId = scope.providerAccountId;
      const externalProvision = vi.fn(async () => ({
        externalId: "must-never-exist", status: "ready" as const,
      }));
      registry.register({
        id: "aws",
        inspect: async () => ({
          id: "aws", label: "Synthetic AWS secondary preflight",
          availability: "available" as const,
          capabilities: ["compute"], evidence: ["test"], constraints: [],
          observedAt: new Date().toISOString(),
        }),
        provision: externalProvision,
      } as any);
      const authority = createAwsClaimedProvisionAuthority(db.raw);
      const lifecycle = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db.raw),
      );
      const dependencies = createLifecycleProcurementDependencies(lifecycle, {
        observeAuthenticatedEconomics: async () => quote,
        issuePolicyDecision: async () => exactP010Decision(db, scope, quote),
        resolveProvisionRequest: async () => ({
          resourceType: "ec2",
          retentionPolicy: "until_goal_complete" as const,
          requiredCapabilities: ["remote compute"],
          metadata: { instanceType: "t3.micro" }, // stale host specification
        }),
      }, authority);
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: () => dependencies,
      }).find(t => t.name === "environment_procurement_execute")!;
      const result = JSON.parse(await tool.execute({
        ...args, provider: "aws", provider_account_id: scope.providerAccountId,
        region: scope.region, resource_shape: scope.resourceShape,
      }, { db } as any));
      expect(result.status).toBe("rejected");
      expect(result.dispatched).toBe(false);
      expect(result.financialEffectState).toBe("rejected");
      expect(result.supplierSettlement).toBe("UNKNOWN");
      expect(externalProvision).not.toHaveBeenCalled();
    } finally { db.close(); }
  });

  it("rejects a forged AWS secondary mandate without a matching live P-030 dispatch claim", async () => {
    const { db, scope: original } = setup();
    try {
      const authority = createAwsClaimedProvisionAuthority(db.raw);
      const scope = {
        ...original, provider: "aws", providerAccountId: "123456789012",
        region: "us-east-1", resourceShape: "t3.small",
      };
      const quote = createScenario();
      quote.provider = "aws"; quote.accountId = scope.providerAccountId;
      quote.financing.accountId = scope.providerAccountId;
      const prepared = {
        resourceId: scope.resourceId, resourceType: "ec2",
        retentionPolicy: "until_goal_complete" as const,
        requiredCapabilities: ["remote compute"],
        region: scope.region, goalId: scope.goalId, taskId: scope.taskId,
        pathId: scope.pathId, metadata: { instanceType: scope.resourceShape },
      };
      await expect(authority.withClaimedProvision(
        scope, { policyDecisionId: "unpersisted", amountCents: 450, unit: "usd_cent" },
        quote, prepared, async () => "should not run",
      )).rejects.toThrow("mandate");
      expect(authority.authorizeNewProvision({
        request: prepared, accountId: scope.providerAccountId,
        region: scope.region, instanceType: scope.resourceShape,
      }).allowed).toBe(false);
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects").get())
        .toMatchObject({ n: 0 });
    } finally { db.close(); }
  });
});
