import { describe, expect, it, vi } from "vitest";
import { AdaptiveStore } from "../intelligence/store.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { createEnvironmentTools } from "../environments/tools.js";
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
