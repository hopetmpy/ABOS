import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createConwayDomainsRegistrationDependencies } from "../conway/domains-claimed-registration.js";
import { observeConwayDomainsPreauthorizationQuote } from "../conway/domains-preauthorization-quote.js";
import { getFinancialEffectByOperationKey } from "../economics/financial-effects.js";
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

  it("supports trusted external suppliers without an EnvironmentRegistry compute provider, while binding payee and exact body hash", async () => {
    const { db, registry, scope: original, args } = setup();
    try {
      const scope: ProviderProcurementScope = {
        ...original, provider: "supplier-native",
        paymentRecipient: "0x1111111111111111111111111111111111111111",
        requestBodySha256: "a".repeat(64),
      };
      const quote = createScenario();
      quote.provider = scope.provider;
      const decision = exactP010Decision(db, scope, quote);
      const dispatch = vi.fn(async () => ({
        status: "pending" as const,
        evidence: ["Synthetic supplier owner; no charge was sent."],
      }));
      const deps: ProviderProcurementExecutionDependencies = {
        observeAuthenticatedEconomics: async () => quote,
        dispatch,
      };
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: id =>
          id === "supplier-native" ? deps : null,
      }).find(x => x.name === "environment_procurement_execute")!;
      const input = {
        ...args, provider: scope.provider,
        payment_recipient: scope.paymentRecipient,
        request_body_sha256: scope.requestBodySha256,
        policy_decision_id: decision,
      };
      const accepted = JSON.parse(await tool.execute(input, { db } as any));
      expect(accepted.status).toBe("pending");
      expect(accepted.financialEffectState).toBe("pending");
      expect(dispatch).toHaveBeenCalledTimes(1);
      const effect = db.raw.prepare(
        "SELECT recipient, request_json FROM financial_effects WHERE operation_key = ?",
      ).get(scope.operationKey) as { recipient: string; request_json: string };
      expect(effect.recipient).toBe(scope.paymentRecipient);
      expect(JSON.parse(effect.request_json).requestBodySha256).toBe(scope.requestBodySha256);

      const changed = await tool.execute({
        ...input, payment_recipient: "0x2222222222222222222222222222222222222222",
      }, { db } as any);
      expect(changed).toMatch(/BLOCKED\/UNKNOWN/);
      const changedBody = await tool.execute({
        ...input, request_body_sha256: "b".repeat(64),
      }, { db } as any);
      expect(changedBody).toMatch(/BLOCKED\/UNKNOWN/);
      expect(dispatch).toHaveBeenCalledTimes(1);

      const malformed = await tool.execute({
        ...input, request_body_sha256: "unknown",
      }, { db } as any);
      expect(malformed).toContain("malformed exact supplier request hash");
    } finally { db.close(); }
  });

  it("carries a quote-only Conway 402 through P-025/P-010/P-030 without sending a paid registration or replaying", async () => {
    const { db, registry, scope: original, args } = setup();
    const domainOrder = { domain: "mysite.io", years: 2, privacy: true };
    const payTo = "0x2222222222222222222222222222222222222222";
    const wallet = "0x1111111111111111111111111111111111111111";
    try {
      const scope: ProviderProcurementScope = {
        ...original, provider: "conway-domains",
        providerAccountId: "account-controlled",
        unit: "usdc_cent", resourceShape: "registered-domain",
        paymentRecipient: payTo,
        requestBodySha256: createHash("sha256")
          .update(JSON.stringify(domainOrder), "utf8").digest("hex"),
      };
      const economic = createScenario();
      economic.provider = scope.provider;
      economic.accountId = scope.providerAccountId;
      economic.unit = scope.unit;
      economic.cost.oneTimeCents = 4375;
      economic.cost.recurringCentsPerPeriod = 0;
      economic.cost.periods = 1;
      economic.cost.otherChargesCents = 0;
      economic.financing.accountId = scope.providerAccountId;
      economic.financing.unit = scope.unit;
      economic.financing.observedAvailableCents = 20_000;
      // Price discovery must precede the P-010 purchase authorization.
      const calls: string[] = [];
      const fetcher = vi.fn(async (url: string, request: RequestInit) => {
        calls.push(url);
        expect(new URL(url).origin).toBe("https://api.conway.domains");
        expect(new Headers(request.headers).has("X-PAYMENT")).toBe(false);
        const respond = (payload: unknown, status = 200) =>
          new Response(JSON.stringify(payload), { status,
            headers: { "Content-Type": "application/json" } });
        if (url.endsWith("/auth/nonce")) return respond({ nonce: "nonce1234ABCD" });
        if (url.endsWith("/auth/verify")) return respond({
          access_token: "synthetic.jwt.provider",
        });
        if (url.endsWith("/auth/me")) return respond({
          id: scope.providerAccountId,
          wallet_address: wallet, wallet_type: "evm",
        });
        expect(url).toBe("https://api.conway.domains/domains/register");
        expect(request.body).toBe(JSON.stringify(domainOrder));
        return respond({ x402Version: 2, accepts: [{
          scheme: "exact", network: "eip155:8453",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          amount: "43750000", payTo, maxTimeoutSeconds: 300,
        }] }, 402);
      });
      vi.stubGlobal("fetch", fetcher);
      const hostWallet = {
        address: wallet,
        signMessage: async () => "0x" + "aa".repeat(65),
      };
      const prequote = await observeConwayDomainsPreauthorizationQuote(
        db.raw,hostWallet,scope.providerAccountId,domainOrder,
      );
      expect(prequote.status).toBe("observed");
      expect(prequote.quote?.amountMicroUsdc).toBe("43750000");
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects")
        .get() as { n: number }).n).toBe(0);
      scope.quoteCandidateFingerprint=prequote.quote?.candidateFingerprint;
      scope.paymentAmountMicroUsdc=prequote.quote?.amountMicroUsdc;
      scope.controlledWalletAddress=wallet;
      const decision = exactP010Decision(db, scope, economic);
      const deps = createConwayDomainsRegistrationDependencies(db.raw, {
        wallet: hostWallet,
        observeAuthenticatedEconomics: async () => economic,
        resolveRegistrationRequest: async () => domainOrder,
      });
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: id =>
          id === "conway-domains" ? deps : null,
      }).find(t => t.name === "environment_procurement_execute")!;
      const input = {
        ...args, provider: scope.provider,
        provider_account_id: scope.providerAccountId,
        unit: scope.unit, resource_shape: scope.resourceShape,
        payment_recipient: payTo,
        request_body_sha256: scope.requestBodySha256,
        quote_candidate_fingerprint: scope.quoteCandidateFingerprint,
        payment_amount_micro_usdc: scope.paymentAmountMicroUsdc,
        controlled_wallet_address: scope.controlledWalletAddress,
        policy_decision_id: decision,
      };
      const observed = JSON.parse(await tool.execute(input, { db } as any));
      expect(observed).toMatchObject({
        status: "rejected", dispatched: false,
        financialEffectState: "rejected", supplierSettlement: "UNKNOWN",
      });
      expect(calls).toHaveLength(8);
      expect(calls.filter(url => url.endsWith("/domains/register"))).toHaveLength(2);
      const recorded = getFinancialEffectByOperationKey(db.raw, scope.operationKey)!;
      expect(recorded.recipient).toBe(payTo);
      expect(recorded.request.requestBodySha256).toBe(scope.requestBodySha256);
      expect(recorded.request.quoteCandidateFingerprint).toBe(prequote.quote?.candidateFingerprint);
      expect(recorded.request.paymentAmountMicroUsdc).toBe("43750000");
      expect(recorded.evidence.join(" ")).toMatch(/402 candidate fingerprint:/);
      expect(recorded.evidence.join(" ")).not.toContain("synthetic.jwt.provider");
      const replay = JSON.parse(await tool.execute(input, { db } as any));
      expect(replay.status).toBe("not_dispatched");
      expect(calls).toHaveLength(8);
    } finally { vi.unstubAllGlobals(); db.close(); }
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


describe("P-031 P-030-claimed AWS capacity mutation runtime, synthetic account only", () => {
  for (const operation of ["resize", "resume", "recover"] as const) {
    it("binds " + operation + " to one exact P-010/P-030 claim and rejects a raw repeat", async () => {
      const { db, scope: baseline, args: original, registry } = setup();
      try {
        const scope: ProviderProcurementScope = {
          ...baseline, operation,
          operationKey: "p031-aws-mutation-" + operation,
          provider: "aws", providerAccountId: "123456789012",
          resourceId: "owned-mutation-" + operation, externalId: "i-mutated",
          region: "us-east-1",
          resourceShape: operation === "resize" ? "t3.small" : "t3.micro",
        };
        const quote = createScenario();
        quote.provider = "aws"; quote.accountId = scope.providerAccountId;
        quote.financing.accountId = scope.providerAccountId;
        const authority = createAwsClaimedProvisionAuthority(db.raw);
        const commands: string[][] = [];
        const runner = vi.fn(async (_command: string, argv: string[]) => {
          commands.push(argv);
          const ok = (stdout = "{}") => ({ stdout, stderr: "", exitCode: 0 });
          if (argv[0] === "sts" && argv[1] === "get-caller-identity")
            return ok(JSON.stringify({ Account: scope.providerAccountId }));
          if (argv[0] === "ec2" && argv[1] === "describe-instances")
            return ok(JSON.stringify({
              InstanceId: scope.externalId, State: { Name: "stopped" },
              InstanceType: "t3.micro",
            }));
          if (argv[0] === "ec2" && ["start-instances", "stop-instances",
            "modify-instance-attribute", "wait"].includes(argv[1]!)) return ok();
          throw new Error("Unexpected synthetic AWS command: " + argv.join(" "));
        });
        const aws = new AwsEnvironmentProvider({
          runner, defaultRegion: scope.region,
          authorizeNewProvision: authority.authorizeNewProvision,
          authorizeBillableMutation: authority.authorizeBillableMutation,
        });
        registry.register(aws);
        const resources = new EnvironmentResourceStore(db.raw);
        resources.create({
          id: scope.resourceId, provider: scope.provider,
          externalId: scope.externalId, type: "aws-ec2-instance",
          goalId: scope.goalId, taskId: scope.taskId, pathId: scope.pathId,
          region: scope.region, status: "suspended",
          retentionPolicy: "until_goal_complete",
          metadata: { instanceType: "t3.micro" },
        });
        const lifecycle = new EnvironmentLifecycleManager(registry, resources);
        const first = createLifecycleProcurementDependencies(lifecycle, {
          observeAuthenticatedEconomics: async () => quote,
          resolveMutationRequest: async () => ({
            externalId: scope.externalId!, region: scope.region,
            targetInstanceType: scope.resourceShape,
            source: "synthetic-trusted-host", evidence: ["Synthetic provider identity+shape."],
          }),
        }, authority);
        const tool = createEnvironmentTools(registry, {
          getTrustedProcurementDependencies: (provider, op) =>
            provider === "aws" && op === operation ? first : null,
        }).find(t => t.name === "environment_procurement_execute")!;
        const input = {
          ...original, operation, operation_key: scope.operationKey,
          provider: scope.provider,
          provider_account_id: scope.providerAccountId,
          resource_id: scope.resourceId, external_id: scope.externalId,
          region: scope.region, resource_shape: scope.resourceShape,
          policy_decision_id: exactP010Decision(db, scope, quote),
        };
        await expect(aws.resume(resources.get(scope.resourceId)!))
          .rejects.toBeInstanceOf(AwsEc2ProcurementNotDispatchedError);
        // The raw AWS provider must not accept an operation outside an active
        // claimed mandate even when STS has a matching account.
        expect(commands.some(a => a[1] === "start-instances" ||
          a[1] === "modify-instance-attribute")).toBe(false);

        const result = JSON.parse(await tool.execute(input, { db } as any));
        expect(result.dispatched).toBe(true);
        expect(result.status).toBe("pending");
        expect(result.financialEffectState).toBe("pending");
        expect(result.supplierSettlement).toBe("UNKNOWN");
        const effects = db.raw.prepare("SELECT COUNT(*) AS count FROM financial_effects")
          .get() as { count: number };
        expect(effects.count).toBe(1);
        const mutations = () => commands.filter(c => c[0] === "ec2" &&
          ["start-instances", "modify-instance-attribute"].includes(c[1]!));
        expect(mutations()).toHaveLength(1);
        const replay = JSON.parse(await tool.execute(input, { db } as any));
        expect(replay.status).toBe("not_dispatched");
        expect(mutations()).toHaveLength(1);
        expect(authority.authorizeBillableMutation({
          operation, resource: resources.get(scope.resourceId)!,
          accountId: scope.providerAccountId, instanceId: scope.externalId!,
          region: scope.region, targetInstanceType: scope.resourceShape,
        }).allowed).toBe(false);
        expect(db.raw.prepare("SELECT COUNT(*) AS count FROM transactions")
          .get()).toMatchObject({ count: 0 });
      } finally { db.close(); }
    });
  }

  it("does not retain financial commitments for source-proven already-running resume or recover", async () => {
    for (const operation of ["resume", "recover"] as const) {
      const { db, scope: baseline, args: original, registry } = setup();
      try {
        const scope: ProviderProcurementScope = {
          ...baseline, operation, operationKey: "no-dispatch-" + operation,
          provider: "aws", providerAccountId: "123456789012",
          resourceId: "observed-running-" + operation,
          externalId: "i-already-running",
          region: "us-east-1", resourceShape: "t3.micro",
        };
        const quote = createScenario();
        quote.provider = "aws"; quote.accountId = scope.providerAccountId;
        quote.financing.accountId = scope.providerAccountId;
        const authority = createAwsClaimedProvisionAuthority(db.raw);
        const calls: string[][] = [];
        const aws = new AwsEnvironmentProvider({
          runner: async (_command, argv) => {
            calls.push(argv);
            if (argv[0] === "ec2" && argv[1] === "describe-instances") {
              return {
                stdout: JSON.stringify({
                  InstanceId: scope.externalId,
                  State: { Name: "running" }, InstanceType: "t3.micro",
                }), stderr: "", exitCode: 0,
              };
            }
            throw new Error("No AWS capacity mutation allowed in already-running case");
          },
          authorizeBillableMutation: authority.authorizeBillableMutation,
        });
        registry.register(aws);
        const resources = new EnvironmentResourceStore(db.raw);
        resources.create({
          id: scope.resourceId, provider: "aws", externalId: scope.externalId,
          type: "aws-ec2-instance", status: "suspended",
          goalId: scope.goalId, taskId: scope.taskId, pathId: scope.pathId,
          region: scope.region, metadata: { instanceType: "t3.micro" },
        });
        const lifecycle = new EnvironmentLifecycleManager(registry, resources);
        const dependencies = createLifecycleProcurementDependencies(lifecycle, {
          observeAuthenticatedEconomics: async () => quote,
          resolveMutationRequest: async () => ({
            externalId: scope.externalId!, region: scope.region,
            targetInstanceType: scope.resourceShape,
            source: "trusted-synthetic-observer",
            evidence: ["EC2 identity and quoted shape match."],
          }),
        }, authority);
        const tool = createEnvironmentTools(registry, {
          getTrustedProcurementDependencies: () => dependencies,
        }).find(t => t.name === "environment_procurement_execute")!;
        const input = {
          ...original, operation, operation_key: scope.operationKey,
          provider: scope.provider,
          provider_account_id: scope.providerAccountId,
          resource_id: scope.resourceId, external_id: scope.externalId,
          region: scope.region, resource_shape: scope.resourceShape,
          policy_decision_id: exactP010Decision(db, scope, quote),
        };
        const result = JSON.parse(await tool.execute(input, { db } as any));
        expect(result.status).toBe("rejected");
        expect(result.dispatched).toBe(false);
        expect(result.financialEffectState).toBe("rejected");
        expect(result.supplierSettlement).toBe("UNKNOWN");
        expect(resources.get(scope.resourceId)?.status).toBe("running");
        expect(resources.get(scope.resourceId)?.metadata.mutationExternalEffectNotDispatched)
          .toBe(true);
        expect(calls.every(c => c[1] === "describe-instances")).toBe(true);
        expect(calls).toHaveLength(1);
        const replay = JSON.parse(await tool.execute(input, { db } as any));
        expect(replay.status).toBe("not_dispatched");
        expect(calls).toHaveLength(1);
        expect(db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get())
          .toMatchObject({ n: 0 });
      } finally { db.close(); }
    }
  });

  it("rejects an unproven target identity before AWS billable mutation", async () => {
    const { db, scope: baseline, args: original, registry } = setup();
    try {
      const scope: ProviderProcurementScope = {
        ...baseline, operation: "resize", provider: "aws",
        providerAccountId: "123456789012", resourceId: "owned-invalid-mutation",
        externalId: "i-valid", region: "us-east-1", resourceShape: "t3.small",
      };
      const quote = createScenario();
      quote.provider = "aws"; quote.accountId = scope.providerAccountId;
      quote.financing.accountId = scope.providerAccountId;
      let physicalCalls = 0;
      registry.register({
        id: "aws",
        inspect: async () => ({
          id: "aws", label: "Synthetic", availability: "available" as const,
          capabilities: [], evidence: [], constraints: [],
          observedAt: new Date().toISOString(),
        }),
        resize: async () => {
          physicalCalls++; return { status: "running" as const };
        },
      });
      const resources = new EnvironmentResourceStore(db.raw);
      resources.create({
        id: scope.resourceId, provider: "aws", externalId: scope.externalId,
        type: "aws-ec2-instance", region: scope.region, status: "suspended",
        goalId: scope.goalId, taskId: scope.taskId, pathId: scope.pathId,
        metadata: { instanceType: "t3.micro" },
      });
      const lifecycle = new EnvironmentLifecycleManager(registry, resources);
      const authority = createAwsClaimedProvisionAuthority(db.raw);
      const dependencies = createLifecycleProcurementDependencies(lifecycle, {
        observeAuthenticatedEconomics: async () => quote,
        resolveMutationRequest: async () => ({
          externalId: "i-other-account", region: scope.region,
          targetInstanceType: scope.resourceShape, source: "trusted-identity",
          evidence: ["Account mismatch."],
        }),
      }, authority);
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: () => dependencies,
      }).find(t => t.name === "environment_procurement_execute")!;
      const result = JSON.parse(await tool.execute({
        ...original, operation: scope.operation, provider: scope.provider,
        provider_account_id: scope.providerAccountId,
        resource_id: scope.resourceId, external_id: scope.externalId,
        region: scope.region, resource_shape: scope.resourceShape,
        policy_decision_id: exactP010Decision(db, scope, quote),
      }, { db } as any));
      expect(result.status).toBe("rejected");
      expect(result.dispatched).toBe(false);
      expect(result.financialEffectState).toBe("rejected");
      expect(physicalCalls).toBe(0);
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
