import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../agent/policy-engine.js";
import { AdaptiveStore } from "../intelligence/store.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { createTestDb } from "./mocks.js";
import { insertGoal, insertTask } from "../state/database.js";
import {
  executeReviewedProviderProcurement,
  procurementPolicyArgs,
  PROVIDER_PROCUREMENT_POLICY_TOOL,
  type ProviderProcurementScope,
  type ProviderProcurementExecutionDependencies,
} from "../economics/provider-procurement-execution.js";
import {
  getFinancialEffectByOperationKey,
  getProviderFundingSnapshotExposure,
  prepareFinancialEffect,
  settleFinancialEffect,
} from "../economics/financial-effects.js";
import type { ProviderProcurementScenarioInput } from "../economics/treasury-scenario.js";
import type { PolicyRequest, ToolContext } from "../types.js";

function scenario(): ProviderProcurementScenarioInput {
  return {
    provider: "aws", accountId: "123456789012", unit: "usd_cent",
    resourceNeedEvidence: ["Planned service requires a short-lived compute instance."],
    alternatives: [{
      id: "reusable", projectedCostCents: 1500, unit: "usd_cent",
      evidence: "Existing capacity reuse compared.",
    }],
    cost: {
      oneTimeCents: 1000, recurringCentsPerPeriod: 500, periods: 3,
      otherChargesCents: 500, unpricedComponents: [],
      billingTermsEvidence: ["Authenticated quote includes storage, IPv4, compute and stated term."],
    },
    financing: {
      accountId: "123456789012", unit: "usd_cent",
      basis: "externally_observed",
      observedAvailableCents: 10_000,
      evidence: ["Test-only authenticated USD funding source, never AWS LIVE."],
      observedAt: "2026-10-01T00:00:00Z",
      validUntil: "2030-01-01T00:00:00Z",
    },
    reservedCents: 2000, existingCommitmentsCents: 1000,
    additionalContingencyCents: 1000,
    contingencyEvidence: ["Test-only risk assessment of recovery charges."],
  };
}

function setup() {
  const db = createTestDb();
  const goalId = insertGoal(db.raw, { title: "Operate a SaaS", description: "Fund capacity" });
  const taskId = insertTask(db.raw, { goalId, title: "Acquire server", description: "Compare options" });
  const paths = new AdaptiveStore(db.raw);
  const path = paths.getOrCreatePath({
    goalId, hypothesis: "Capacity enables delivery",
    strategy: "Compare alternatives, then acquire with verified account authority",
    assumptions: ["Supplier terms verified"], requiredCapabilities: ["compute"],
    sequence: ["compare", "procure", "verify"], expectedOutcome: "Usable service",
  });
  paths.bindTask({ taskId, goalId, pathId: path.id });
  paths.setPathStatus(path.id, "selected");
  db.raw.prepare(
    "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(`orchestrator.review_feedback.${goalId}`,
    `approved and materialized; materialized_path=${path.id}`);
  const scope: ProviderProcurementScope = {
    operationKey: "provider-ec2-test-operation-1",
    operation: "provision", provider: "aws",
    providerAccountId: "123456789012", unit: "usd_cent",
    goalId, taskId, pathId: path.id,
    resourceId: "resource-001", region: "us-east-1",
    resourceShape: "t3.micro",
  };
  return { db, scope };
}

function policy(
  db: ReturnType<typeof createTestDb>,
  scope: ProviderProcurementScope,
  quote: ProviderProcurementScenarioInput,
  kind: "explicit_allow" | "default_allow" | "deny" = "explicit_allow",
): string {
  const rule = {
    id: "account-scoped-economic-authority-rule",
    description: "Synthetic policy for exact operation, not actual account spending rights",
    priority: 1,
    appliesTo: { by: "name" as const, names: [PROVIDER_PROCUREMENT_POLICY_TOOL] },
    evaluate: () => kind === "deny"
      ? { rule: "economic.authority", action: "deny" as const,
          reasonCode: "DENIED", humanMessage: "Not authorized." }
      : { rule: "economic.authority", action: "allow" as const,
          reasonCode: "ALLOW", humanMessage: "Synthetic explicit rule accepted." },
  };
  const engine = new PolicyEngine(db.raw, kind === "default_allow" ? [] : [rule]);
  const request: PolicyRequest = {
    tool: {
      name: PROVIDER_PROCUREMENT_POLICY_TOOL,
      description: "Synthetic account-provider procurement authorization",
      parameters: { type: "object", properties: {} },
      execute: async () => "not used",
      category: "financial",
      riskLevel: "dangerous",
    },
    args: procurementPolicyArgs(scope, quote),
    context: {} as ToolContext,
    turnContext: { inputSource: "agent", turnToolCallCount: 1 },
  };
  const decision = engine.evaluate(request);
  engine.persistDecision(decision, request);
  return decision.id!;
}

function adapters(quote: ProviderProcurementScenarioInput, calls: string[],
  outcome: "usable" | "pending" | "rejected" | "unknown" | "throw" = "usable",
): ProviderProcurementExecutionDependencies {
  return {
    observeAuthenticatedEconomics: async () => quote,
    verifyResourceUsability: async (scope) => ({
      usable: true, resourceId: scope.resourceId,
      evidence: ["Independent P-018 mock observed usable owned resource."],
    }),
    dispatch: async (scope, authorization) => {
      calls.push(scope.operationKey + ":" + authorization.policyDecisionId);
      if (outcome === "throw") throw new Error("synthetic transport lost: secret not persisted");
      return {
        status: outcome,
        providerEffectId: "mock-ec2-id",
        providerStatus: "synthetic",
        evidence: ["Provider mock observed, no AWS command executed."],
      };
    },
  };
}

describe("P-031 P-025 + P-030 + P-010 exact procurement execution chain", () => {
  it("executes a reviewed+funded+explicitly authorized synthetic provider once, without claiming payment", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario();
      const decisionId = policy(db, scope, quote);
      const calls: string[] = [];
      const deps = adapters(quote, calls);
      const run = await executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: decisionId, dependencies: deps,
        now: new Date("2026-10-15T00:00:00Z"),
      });
      expect(run.status).toBe("usable");
      expect(run.dispatched).toBe(true);
      expect(run.review?.totalProposedCommitmentCents).toBe(3000);
      expect(run.review?.freeAfterProposalAndContingencyCents).toBe(3000);
      expect(run.financialEffect?.state).toBe("pending");
      expect(run.financialEffect?.unit).toBe("usd_cent");
      expect(run.financialEffect?.request.providerAccountId).toBe("123456789012");
      expect(calls).toHaveLength(1);
      const repeat = await executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: decisionId, dependencies: deps,
      });
      expect(repeat.dispatched).toBe(false);
      expect(repeat.status).toBe("not_dispatched");
      expect(calls).toHaveLength(1);
      await expect(executeReviewedProviderProcurement(db.raw, {
        scope: { ...scope, resourceId: "resource-replay-other" },
        policyDecisionId: decisionId, dependencies: deps,
      })).rejects.toThrow("idempotency conflict");
      expect(calls).toHaveLength(1);
      const equivalentWithNewKey = { ...scope, operationKey: "provider-ec2-test-operation-2" };
      const secondPolicy = policy(db, equivalentWithNewKey, quote);
      await expect(executeReviewedProviderProcurement(db.raw, {
        scope: equivalentWithNewKey, policyDecisionId: secondPolicy, dependencies: deps,
      })).rejects.toThrow("overlaps unresolved intent");
      expect(calls).toHaveLength(1);
      const repricedQuote = scenario();
      repricedQuote.cost.oneTimeCents = 1250;
      const repricedScope = { ...scope, operationKey: "provider-ec2-repriced-operation" };
      const repricedDecision = policy(db, repricedScope, repricedQuote);
      await expect(executeReviewedProviderProcurement(db.raw, {
        scope: repricedScope, policyDecisionId: repricedDecision,
        dependencies: adapters(repricedQuote, calls),
      })).rejects.toThrow("overlaps unresolved intent");
      expect(calls).toHaveLength(1);
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n)
        .toBe(0);
    } finally { db.close(); }
  });

  it("blocks default P-010 allow with no explicit positive rule, even on an apparently funded account", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario(), calls: string[] = [];
      const decisionId = policy(db, scope, quote, "default_allow");
      await expect(executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: decisionId, dependencies: adapters(quote, calls),
      })).rejects.toThrow("default-allow");
      expect(calls).toEqual([]);
      expect(getFinancialEffectByOperationKey(db.raw, scope.operationKey)).toBeUndefined();
    } finally { db.close(); }
  });

  it("rejects policy deny and mismatch between policy-approved and requested account/resource terms", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario(), calls: string[] = [];
      const denied = policy(db, scope, quote, "deny");
      await expect(executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: denied, dependencies: adapters(quote, calls),
      })).rejects.toThrow("missing, inactive or not explicitly allowed");
      const approved = policy(db, scope, quote);
      const badScope = { ...scope, resourceId: "another-resource" };
      await expect(executeReviewedProviderProcurement(db.raw, {
        scope: badScope, policyDecisionId: approved,
        dependencies: adapters(quote, calls),
      })).rejects.toThrow("not bound to this exact");
      expect(calls).toEqual([]);
    } finally { db.close(); }
  });

  it("rejects strategy without a materialized P-025 path independently of funds or P-010", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario(), calls: string[] = [];
      const decisionId = policy(db, scope, quote);
      db.raw.prepare("DELETE FROM kv WHERE key = ?")
        .run(`orchestrator.review_feedback.${scope.goalId}`);
      await expect(executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: decisionId, dependencies: adapters(quote, calls),
      })).rejects.toThrow("P-025 task route");
      expect(calls).toHaveLength(0);
    } finally { db.close(); }
  });

  it("rejects budgets, wrong account/currency, missing supplier components and underfunding", async () => {
    for (const change of [
      (q: ProviderProcurementScenarioInput) => { q.financing.basis = "budget_threshold"; },
      (q: ProviderProcurementScenarioInput) => { q.financing.unit = "credit_cent"; },
      (q: ProviderProcurementScenarioInput) => { q.financing.accountId = "999999999999"; },
      (q: ProviderProcurementScenarioInput) => { q.cost.otherChargesCents = null; },
      (q: ProviderProcurementScenarioInput) => { q.cost.unpricedComponents = ["data egress UNKNOWN"]; },
      (q: ProviderProcurementScenarioInput) => { q.financing.observedAvailableCents = 500; },
      (q: ProviderProcurementScenarioInput) => { q.financing.validUntil = "2020-01-01T00:00:00Z"; },
    ]) {
      const { db, scope } = setup();
      try {
        const quote = scenario(); change(quote);
        const calls: string[] = [];
        const decisionId = policy(db, scope, quote);
        await expect(executeReviewedProviderProcurement(db.raw, {
          scope, policyDecisionId: decisionId, dependencies: adapters(quote, calls),
        })).rejects.toThrow(/financing observation|P-030 provider scenario/);
        expect(calls).toHaveLength(0);
        expect(getFinancialEffectByOperationKey(db.raw, scope.operationKey)).toBeUndefined();
      } finally { db.close(); }
    }
  });

  it("records UNKNOWN after a possible remote dispatch and never retries or invents settlement", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario(), calls: string[] = [];
      const decisionId = policy(db, scope, quote);
      const deps = adapters(quote, calls, "throw");
      const first = await executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: decisionId, dependencies: deps,
      });
      expect(first.dispatched).toBe(true);
      expect(first.status).toBe("unknown");
      expect(first.financialEffect?.state).toBe("unknown");
      expect(first.evidence.join(" ")).toContain("reconcile");
      const repeat = await executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: decisionId, dependencies: deps,
      });
      expect(repeat.dispatched).toBe(false);
      expect(calls).toHaveLength(1);
      expect(repeat.financialEffect?.state).toBe("unknown");
    } finally { db.close(); }
  });

  it("validates actual P-018 mock resource ownership and health before operational success", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario();
      const registry = new EnvironmentRegistry();
      registry.register({
        id: "aws", // Synthetic registered provider, never the real AWS CLI.
        inspect: async () => ({
          id: "aws", label: "Synthetic resource provider",
          availability: "available", capabilities: [], constraints: [],
          evidence: ["Fixture only"], observedAt: new Date().toISOString(),
        }),
        provision: async (request) => ({
          externalId: "synthetic-provider-resource-001",
          type: request.resourceType, status: "running",
          providerState: "running", evidence: ["Synthetic provision completed."],
        }),
        health: async () => ({
          healthy: true, status: "running", providerState: "running",
          evidence: ["Independent P-018 health probe observes running capacity."],
        }),
      });
      const resources = new EnvironmentResourceStore(db.raw);
      const lifecycle = new EnvironmentLifecycleManager(registry, resources);
      const calls: string[] = [];
      const decisionId = policy(db, scope, quote);
      const result = await executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: decisionId,
        dependencies: {
          observeAuthenticatedEconomics: async () => quote,
          dispatch: async (requestedScope) => {
            calls.push("provider-provision");
            await lifecycle.provision("aws", {
              resourceId: requestedScope.resourceId,
              resourceType: "simulated-worker",
              requiredCapabilities: [], retentionPolicy: "ephemeral",
              region: requestedScope.region,
              goalId: requestedScope.goalId,
              taskId: requestedScope.taskId,
              pathId: requestedScope.pathId,
            });
            return { status: "usable", evidence: ["Supplier accepted synthetic capacity."] };
          },
          verifyResourceUsability: async (requestedScope) => {
            const observed = await lifecycle.health(requestedScope.resourceId);
            return {
              usable: observed.status === "running" &&
                observed.provider === requestedScope.provider &&
                observed.externalId === "synthetic-provider-resource-001",
              resourceId: observed.id,
              evidence: ["P-018 registered ownership and independently probed running resource."],
            };
          },
        },
      });
      expect(result.status).toBe("usable");
      expect(result.financialEffect?.state).toBe("pending");
      expect(resources.get(scope.resourceId)?.externalId).toBe("synthetic-provider-resource-001");
      expect(calls).toEqual(["provider-provision"]);
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
    } finally { db.close(); }
  });

  it("never upgrades supplier acceptance to resource-ready when P-018 verification is absent", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario(), calls: string[] = [];
      const dependencies = adapters(quote, calls);
      delete dependencies.verifyResourceUsability;
      const decisionId = policy(db, scope, quote);
      const result = await executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: decisionId, dependencies,
      });
      expect(result.status).toBe("pending");
      expect(result.dispatched).toBe(true);
      expect(result.financialEffect?.state).toBe("pending");
      expect(result.evidence.join(" ")).toContain("verification UNAVAILABLE");
      expect((db.raw.prepare(
        "SELECT execution_state FROM policy_decisions WHERE id = ?",
      ).get(decisionId) as { execution_state: string }).execution_state).toBe("running");
      expect(calls).toHaveLength(1);
    } finally { db.close(); }
  });

  it("keeps supplier-accepted acquisition pending for another, failed or unverifiable resource", async () => {
    for (const verify of [
      async () => ({ usable: false, resourceId: "resource-001", evidence: ["Not ready"] }),
      async () => ({ usable: true, resourceId: "another-resource", evidence: ["Wrong resource"] }),
      async () => ({ usable: true, resourceId: "resource-001", evidence: [] }),
      async (): Promise<never> => { throw new Error("provider secret health endpoint"); },
    ]) {
      const { db, scope } = setup();
      try {
        const quote = scenario(), calls: string[] = [];
        const dependencies = adapters(quote, calls);
        dependencies.verifyResourceUsability = verify;
        const decisionId = policy(db, scope, quote);
        const result = await executeReviewedProviderProcurement(db.raw, {
          scope, policyDecisionId: decisionId, dependencies,
        });
        expect(result.status).toBe("pending");
        expect(result.financialEffect?.state).toBe("pending");
        expect(result.evidence.join(" ")).not.toContain("provider secret health endpoint");
        expect(calls).toHaveLength(1);
      } finally { db.close(); }
    }
  });

  it("holds successive separate-resource acquisitions against the same authenticated account funding snapshot", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario();
      const calls: string[] = [];
      const scope2 = { ...scope, operationKey: "provider-ec2-2",
        resourceId: "resource-002" };
      const scope3 = { ...scope, operationKey: "provider-ec2-3",
        resourceId: "resource-003" };
      const firstPolicy = policy(db, scope, quote);
      const secondPolicy = policy(db, scope2, quote);
      const thirdPolicy = policy(db, scope3, quote);
      const first = await executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: firstPolicy, dependencies: adapters(quote, calls),
      });
      expect(first.status).toBe("usable");
      expect(first.review?.freeAfterProposalAndContingencyCents).toBe(3000);
      const second = await executeReviewedProviderProcurement(db.raw, {
        scope: scope2, policyDecisionId: secondPolicy, dependencies: adapters(quote, calls),
      });
      expect(second.status).toBe("usable");
      expect(second.review?.freeAfterProposalAndContingencyCents).toBe(0);
      await expect(executeReviewedProviderProcurement(db.raw, {
        scope: scope3, policyDecisionId: thirdPolicy, dependencies: adapters(quote, calls),
      })).rejects.toThrow("insufficient after local commitments");
      expect(getFinancialEffectByOperationKey(db.raw, scope3.operationKey)).toBeUndefined();
      expect(calls).toHaveLength(2);
      const exposure = getProviderFundingSnapshotExposure(db.raw, {
        provider: "aws", providerAccountId: "123456789012",
        unit: "usd_cent", fundingObservedAt: "2026-10-01T00:00:00Z",
      });
      expect(exposure.additionalHeldCents).toBe(6000);
      expect(exposure.unresolvedCount).toBe(2);
    } finally { db.close(); }
  });

  it("keeps post-snapshot settled obligations held until a newer authenticated balance is observed", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario();
      const settledKey = "previous-provider-payment";
      prepareFinancialEffect(db.raw, {
        operationKey: settledKey, effectKind: "provider_resource_procurement",
        amountCents: 4000, unit: "usd_cent", provider: "aws",
        request: { providerAccountId: scope.providerAccountId, resourceId: "older-resource" },
      });
      settleFinancialEffect(db.raw, settledKey, {
        providerEffectId: "mock-provider-settlement",
        providerStatus: "observed-settled",
        evidence: ["Synthetic mock only: no actual supplier invoice."],
      }, () => null);
      const snapshot = getProviderFundingSnapshotExposure(db.raw, {
        provider: scope.provider, providerAccountId: scope.providerAccountId,
        unit: "usd_cent", fundingObservedAt: quote.financing.observedAt!,
      });
      expect(snapshot.completedAfterSnapshotCount).toBe(1);
      expect(snapshot.additionalHeldCents).toBe(4000);
      const calls: string[] = [];
      const id = policy(db, scope, quote);
      await expect(executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: id, dependencies: adapters(quote, calls),
      })).rejects.toThrow("insufficient after local commitments");
      expect(calls).toEqual([]);
    } finally { db.close(); }
  });

  it("holds unscoped provider obligations but excludes verified other-account/provider liabilities", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario(), calls: string[] = [];
      prepareFinancialEffect(db.raw, {
        operationKey: "other-aws-account", effectKind: "provider_resource_procurement",
        amountCents: 9000, unit: "usd_cent", provider: "aws",
        request: { providerAccountId: "222222222222", resourceId: "unrelated" },
      });
      prepareFinancialEffect(db.raw, {
        operationKey: "other-currency", effectKind: "provider_resource_procurement",
        amountCents: 9000, unit: "credit_cent", provider: "aws",
        request: { providerAccountId: scope.providerAccountId, resourceId: "conway-credit" },
      });
      const id = policy(db, scope, quote);
      const result = await executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: id, dependencies: adapters(quote, calls),
      });
      expect(result.status).toBe("usable");
      expect(result.review?.freeAfterProposalAndContingencyCents).toBe(3000);
      expect(calls).toHaveLength(1);
      prepareFinancialEffect(db.raw, {
        operationKey: "unknown-provider-account", effectKind: "provider_resource_procurement",
        amountCents: 200, unit: "usd_cent", provider: "aws",
        request: { resourceId: "unattributed" },
      });
      const scope2 = { ...scope, operationKey: "provider-ec2-next",
        resourceId: "resource-next" };
      const p2 = policy(db, scope2, quote);
      await expect(executeReviewedProviderProcurement(db.raw, {
        scope: scope2, policyDecisionId: p2, dependencies: adapters(quote, calls),
      })).rejects.toThrow("unscoped financial obligations");
      expect(calls).toHaveLength(1);
    } finally { db.close(); }
  });

  it("rejects missing, invalid, future or stale funding timestamps before any durable purchase", async () => {
    for (const observedAt of [null, "nonsense", "2031-01-01T00:00:00Z"]) {
      const { db, scope } = setup();
      try {
        const quote = scenario(), calls: string[] = [];
        quote.financing.observedAt = observedAt;
        const id = policy(db, scope, quote);
        await expect(executeReviewedProviderProcurement(db.raw, {
          scope, policyDecisionId: id,
          dependencies: adapters(quote, calls),
        })).rejects.toThrow("P-030 provider scenario");
        expect(calls).toEqual([]);
        expect(getFinancialEffectByOperationKey(db.raw, scope.operationKey))
          .toBeUndefined();
      } finally { db.close(); }
    }
  });

  it("does not confuse provider rejection with a paid invoice", async () => {
    const { db, scope } = setup();
    try {
      const quote = scenario(), calls: string[] = [];
      const decisionId = policy(db, scope, quote);
      const result = await executeReviewedProviderProcurement(db.raw, {
        scope, policyDecisionId: decisionId,
        dependencies: adapters(quote, calls, "rejected"),
      });
      expect(result.status).toBe("rejected");
      expect(result.financialEffect?.state).toBe("rejected");
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n)
        .toBe(0);
    } finally { db.close(); }
  });
});