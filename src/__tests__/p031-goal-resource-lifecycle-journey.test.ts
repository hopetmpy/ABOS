/**
 * P-031 synthetic source/integration journey across existing owners:
 * real P-025 Orchestrator review -> durable Task need -> P-018 sizing ->
 * trusted P-030 / P-010 financial dispatch -> P-018 provision + health ->
 * restart/replay -> Goal-scoped retention, without fictional supplier settlement.
 * No LIVE provider, external credentials, spend or business deliverable.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestDb } from "./mocks.js";
import { createGoal } from "../orchestration/task-graph.js";
import { getTasksByGoal } from "../state/database.js";
import { Orchestrator, getReviewedTaskPathReceipt } from "../orchestration/orchestrator.js";
import { ColonyMessaging } from "../orchestration/messaging.js";
import type { AbosDatabase, PolicyRequest } from "../types.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentRetentionCoordinator } from "../environments/retention.js";
import { EnvironmentSelector } from "../environments/selector.js";
import { createEnvironmentTools } from "../environments/tools.js";
import { createLifecycleProcurementDependencies } from "../environments/procurement-lifecycle-adapter.js";
import { PolicyEngine } from "../agent/policy-engine.js";
import {
  PROVIDER_PROCUREMENT_POLICY_TOOL,
  procurementPolicyArgs,
  type ProviderProcurementScope,
} from "../economics/provider-procurement-execution.js";
import type { ProviderProcurementScenarioInput } from "../economics/treasury-scenario.js";
import { getFinancialEffectByOperationKey } from "../economics/financial-effects.js";

describe("P-031 real owner chain, synthetic Goal through resource retirement", () => {
  it("preserves Task demand and economic authority across provision, replay, restart and retirement", async () => {
    // The strategic planner creates a real AgentWorkspace under HOME. Keep
    // the fixture isolated: never depend on an unrelated Codex/CI user HOME
    // being present, writable or unaffected by other workspace cleanups.
    const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p031-goal-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = testHome;
    const db = createTestDb();
    let provisions = 0;
    let destructions = 0;
    try {
      const goal = createGoal(db.raw, "Deliver resilient test service",
        "Discover compute and backup needs; provision only adequately sized capacity.");
      const tasks = [
        {
          title: "Provision qualified compute", description: "Observe the needed compute capacity and source.",
          resourceNeed: {
            basis: "Synthetic E3 load sample, NOT external workload metering",
            minimumCapacity: { cpuCores: 4, memoryMb: 8192 },
            neededByAt: "2026-12-01T15:00:00Z",
            expectedResourceDurationMs: 7_200_000,
          },
          dependencies: [] as number[],
        },
        {
          title: "Discover backup dependency", description: "Find independent backup terms and capability.",
          dependencies: [] as number[],
        },
        {
          title: "Review complete service", description: "Review all prerequisites, not just the first VM.",
          dependencies: [0, 1],
        },
      ].map((task, i) => ({
        ...task, agentRole: "generalist", estimatedCostCents: 100,
        timeoutMs: 90_000, priority: 80 - i, requiredCapabilities: [],
        preferredEnvironment: null,
      }));
      const plan = {
        analysis: "Resource availability is necessary, not sufficient, for full delivery.",
        strategy: "Discover independent needs, compare owned capacity, verify supplier economics.",
        path: {
          hypothesis: "Sized capacity and backup dependency discovery avoid incomplete service delivery.",
          assumptions: ["Supplier account identity and prices require independent observation."],
          requiredCapabilities: [], preferredEnvironment: null,
          expectedOutcome: "Resource plan with complete dependency evidence.",
        },
        alternatives: [{
          label: "reuse-first",
          strategy: "Measure existing owned resource and defer new procurement if sufficient.",
          hypothesis: "Reuse may avoid supplier cost.",
          assumptions: ["Owned capacity might fit after measurement."],
          requiredCapabilities: [], preferredEnvironment: "local",
          sequence: ["Inspect owned resource", "Verify backup dependency"],
          expectedOutcome: "Reduced expenditure where capacity is verified.",
          estimatedCostCents: 100,
          discriminants: ["Avoids new capacity when owned spare meets measured need."],
        }],
        decisionFactors: ["Source-measured capacity must fit and full service needs must be known."],
        preMortem: ["Backup dependency remains unresolved after compute provision."],
        falsificationConditions: ["Owned capacity measurements prove adequate."],
        tasks, risks: ["Supplier balances and bills remain independently sourced."],
        customRoles: [], estimatedTotalCostCents: 300, estimatedTimeMinutes: 60,
      };
      db.raw.prepare(
        "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      ).run(`orchestrator.plan.${goal.id}`, JSON.stringify(plan));
      db.raw.prepare(
        "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
      ).run("orchestrator.state", JSON.stringify({
        phase: "plan_review", goalId: goal.id, replanCount: 0,
        failedTaskId: null, failedError: null,
      }));
      const tracker = {
        getIdle: vi.fn().mockReturnValue([]),
        getBestForTask: vi.fn().mockReturnValue(null),
        updateStatus: vi.fn(), register: vi.fn(),
      };
      const orchestrator = new Orchestrator({
        db: db.raw, agentTracker: tracker,
        funding: {
          fundChild: vi.fn().mockResolvedValue({ success: true }),
          recallCredits: vi.fn().mockResolvedValue({ success: true, amountCents: 0 }),
          getBalance: vi.fn().mockResolvedValue(1_000),
        },
        messaging: new ColonyMessaging({
          deliver: vi.fn().mockResolvedValue(undefined),
          getRecipients: vi.fn().mockReturnValue([]),
        }, db as unknown as AbosDatabase),
        inference: { chat: vi.fn() } as any,
        identity: {
          name: "synthetic-e3", address: "0x1234", account: {},
          creatorAddress: "0x0000", sandboxId: "synthetic",
          apiKey: "test-only", createdAt: "2026-01-01T00:00:00Z",
        } as any,
        config: { disableSpawn: true },
      });
      expect((await orchestrator.tick()).phase).toBe("executing");
      expect(fs.existsSync(path.join(testHome, ".abos", "workspace", goal.id, "outputs"))).toBe(true);
      const materialized = getTasksByGoal(db.raw, goal.id);
      expect(materialized).toHaveLength(3);
      const computeTask = materialized.find(t => t.title === "Provision qualified compute")!;
      const finalTask = materialized.find(t => t.title === "Review complete service")!;
      const need = computeTask.resourceNeed!;
      const receipt = getReviewedTaskPathReceipt(db.raw, computeTask.id)!;
      expect(need).toEqual(tasks[0]!.resourceNeed);
      expect(computeTask.timeoutMs).toBe(90_000);
      expect(finalTask.status).toBe("blocked");
      expect(finalTask.dependencies).toHaveLength(2);
      expect(receipt.goalId).toBe(goal.id);

      const registry = new EnvironmentRegistry();
      registry.register({
        id: "synthetic",
        inspect: async () => ({
          id: "synthetic", label: "Synthetic isolated compute",
          availability: "available" as const,
          capabilities: [{
            id: "synthetic:compute", type: "cloud_resource" as const,
            provider: "synthetic", description: "Test-only compute",
            requirements: ["compute"], provides: ["compute"],
            permissions: [], available: true,
            state: "verified_available" as const,
            observedAt: new Date().toISOString(),
            authority: "p031-synthetic-e3", evidence: ["Test-only capability."],
          }],
          constraints: [], evidence: ["Not a LIVE provider."],
          observedAt: new Date().toISOString(),
        }),
        estimate: async () => ({
          estimatedCostCents: null, costCoverage: "unknown",
          evidence: ["An advertisement is not an authenticated contract."],
        }),
        provision: async request => {
          provisions++;
          expect(request.goalId).toBe(goal.id);
          expect(request.taskId).toBe(computeTask.id);
          expect(request.pathId).toBe(receipt.pathId);
          expect(request.region).toBe("lab-1");
          return {
            status: "running" as const,
            externalId: "fixture-vm",
            providerState: "running",
            evidence: ["Synthetic provider accepted resource, no actual charge."],
          };
        },
        health: async resource => ({
          healthy: resource.externalId === "fixture-vm",
          status: "running" as const,
          evidence: ["Independent synthetic health observation."],
        }),
        destroy: async () => {
          destructions++;
          return {
            status: "terminated" as const,
            providerState: "terminated",
            evidence: ["Synthetic physical release, billing remains UNKNOWN."],
          };
        },
      });
      const resources = new EnvironmentResourceStore(db.raw);
      resources.create({
        provider: "synthetic", externalId: "owned-small",
        type: "compute", goalId: goal.id, status: "running",
        capabilities: ["compute"],
        metadata: { capacity: { cpuCores: 2, memoryMb: 2048 } },
        retentionPolicy: "manual_retention",
      });
      const selector = new EnvironmentSelector(registry, {
        reuseEvaluator: (provider, req) => resources.findReusableCandidates({
          provider, requiredCapabilities: req.requiredCapabilities,
          minimumCapacity: req.minimumCapacity,
        }).length,
      });
      const selection = await selector.select({
        requiredCapabilities: ["compute"],
        minimumCapacity: need.minimumCapacity,
        expectedDurationMs: need.expectedResourceDurationMs,
        neededByAt: need.neededByAt,
      });
      expect(selection.selected?.environmentId).toBe("synthetic");
      expect(selection.selected?.estimate.reusableResourceCount).toBe(0);
      expect(selection.selected?.provisioningTiming?.status).toBe("unknown");

      const scope: ProviderProcurementScope = {
        operationKey: "p031-holistic-fixture-1",
        operation: "provision", provider: "synthetic",
        providerAccountId: "fixture-account", unit: "usd_cent",
        goalId: goal.id, taskId: computeTask.id, pathId: receipt.pathId,
        resourceId: "qualified-vm", region: "lab-1",
        resourceShape: "synthetic.medium",
      };
      const args = {
        operation_key: scope.operationKey, operation: scope.operation,
        provider: scope.provider, provider_account_id: scope.providerAccountId,
        unit: scope.unit, goal_id: scope.goalId, task_id: scope.taskId,
        path_id: scope.pathId, resource_id: scope.resourceId,
        region: scope.region, resource_shape: scope.resourceShape,
      };
      const unauthenticatedTool = createEnvironmentTools(registry)
        .find(t => t.name === "environment_procurement_execute")!;
      expect(await unauthenticatedTool.execute(args, { db } as any)).toContain("UNAVAILABLE");
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects")
        .get()).toMatchObject({ n: 0 });
      expect(provisions).toBe(0);

      const quote: ProviderProcurementScenarioInput = {
        provider: "synthetic", accountId: scope.providerAccountId, unit: "usd_cent",
        resourceNeedEvidence: ["Synthetic service requires measured compute capacity."],
        alternatives: [{
          id: "owned-under-capacity", projectedCostCents: 0, unit: "usd_cent",
          evidence: "Verified spare capacity 2 cores/2048 MiB is below requested size.",
        }],
        cost: {
          oneTimeCents: 200, recurringCentsPerPeriod: 100, periods: 2,
          otherChargesCents: 50, unpricedComponents: [],
          billingTermsEvidence: ["Synthetic full billing quote, including recurring and exit terms."],
          lifecycleTerms: {
            renewal: "manual", additionalCommittedRenewalCents: 0,
            additionalExitChargeCents: 0, source: "fixture agreement",
            evidence: ["Synthetic manual renewal."],
          },
          usageCoverage: {
            resourceId: scope.resourceId, resourceShape: scope.resourceShape,
            coveredDurationMs: need.expectedResourceDurationMs!,
            pricedBillingPeriods: 2, source: "fixture supplier quote",
            observedAt: "2026-10-01T00:00:00Z",
            validUntil: "2030-01-01T00:00:00Z",
            evidence: ["Two synthetic billing periods cover the expected resource lifetime."],
          },
        },
        financing: {
          accountId: scope.providerAccountId, unit: scope.unit,
          basis: "externally_observed", observedAvailableCents: 5_000,
          evidence: ["Injected E3 fixture balance, NOT actual bank or provider funds."],
          observedAt: "2026-10-01T00:00:00Z",
          validUntil: "2030-01-01T00:00:00Z",
        },
        existingCommitmentsCents: 200, reservedCents: 100,
        additionalContingencyCents: 300,
        contingencyEvidence: ["Synthetic contingency covers modeled replacement."],
      };
      const policy = new PolicyEngine(db.raw, [{
        id: "fixture-scoped-procurement-rule",
        description: "E3 explicit allow for this fixture only; no external authority",
        priority: 1,
        appliesTo: { by: "name" as const, names: [PROVIDER_PROCUREMENT_POLICY_TOOL] },
        evaluate: () => ({
          rule: "fixture.exact_scope", action: "allow" as const,
          reasonCode: "ALLOW", humanMessage: "Synthetic explicit P-010 rule.",
        }),
      }]);
      const source = {
        observeAuthenticatedEconomics: async () => quote,
        observeAuthenticatedResourceFit: async () => ({
          resourceId: scope.resourceId, resourceShape: scope.resourceShape,
          minimumCompatibleCapacity: { cpuCores: 4, memoryMb: 8192 },
          source: "synthetic provider shape inventory",
          observedAt: "2026-10-01T00:00:00Z",
          validUntil: "2030-01-01T00:00:00Z",
          evidence: ["Supplier shape independently mocked, no LIVE observation."],
        }),
        issuePolicyDecision: async () => {
          const request: PolicyRequest = {
            tool: {
              name: PROVIDER_PROCUREMENT_POLICY_TOOL,
              description: "Fixture provider-resource procurement",
              parameters: { type: "object", properties: {} },
              execute: async () => "", category: "financial", riskLevel: "dangerous",
            },
            args: procurementPolicyArgs(scope, quote),
            context: {} as any,
            turnContext: { inputSource: "agent", turnToolCallCount: 1 },
          };
          const decision = policy.evaluate(request);
          policy.persistDecision(decision, request);
          return decision.id!;
        },
        resolveProvisionRequest: async () => ({
          resourceType: "synthetic-compute",
          requiredCapabilities: ["compute"],
          retentionPolicy: "until_goal_complete",
          metadata: { instanceType: scope.resourceShape },
        }),
      };
      const lifecycle = new EnvironmentLifecycleManager(registry, resources);
      const tool = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: () =>
          createLifecycleProcurementDependencies(lifecycle, source),
      }).find(t => t.name === "environment_procurement_execute")!;
      const first = JSON.parse(await tool.execute(args, { db } as any));
      expect(first.status).toBe("usable");
      expect(first.dispatched).toBe(true);
      expect(first.financialEffectState).toBe("pending");
      expect(first.supplierSettlement).toBe("UNKNOWN");
      expect(provisions).toBe(1);
      const created = resources.get(scope.resourceId)!;
      expect(created.status).toBe("running");
      expect(created.externalId).toBe("fixture-vm");
      expect(created.lastHealthCheck).not.toBeNull();
      expect(created.taskId).toBe(computeTask.id);
      expect(created.goalId).toBe(goal.id);
      expect(finalTask.status).toBe("blocked");

      // Recreate P-018 managers with the same SQLite store, as after runtime
      // initialization. Replaying the same P-030 financial operation does
      // not allocate another resource or create another provider side effect.
      const restarted = new EnvironmentLifecycleManager(
        registry, new EnvironmentResourceStore(db.raw),
      );
      const afterRestart = createEnvironmentTools(registry, {
        getTrustedProcurementDependencies: () =>
          createLifecycleProcurementDependencies(restarted, source),
      }).find(t => t.name === "environment_procurement_execute")!;
      const replay = JSON.parse(await afterRestart.execute(args, { db } as any));
      expect(replay.status).toBe("not_dispatched");
      expect(replay.dispatched).toBe(false);
      expect(provisions).toBe(1);
      const retention = new EnvironmentRetentionCoordinator(db.raw, registry, restarted);
      const whileActive = await retention.sweep();
      expect(whileActive.destroyAttempts).toBe(0);
      expect(destructions).toBe(0);
      // Fixture represents later independent completion of the whole Goal,
      // not a claim that ABOS deployed an actual SaaS in this test.
      db.raw.prepare("UPDATE task_graph SET status = 'completed' WHERE goal_id = ?")
        .run(goal.id);
      db.raw.prepare("UPDATE goals SET status = 'completed' WHERE id = ?")
        .run(goal.id);
      const released = await retention.sweep();
      expect(released.destroyAttempts).toBe(1);
      expect(released.released).toBe(1);
      expect(destructions).toBe(1);
      expect(restarted.resources.get(scope.resourceId)?.status).toBe("terminated");
      const secondSweep = await retention.sweep();
      expect(secondSweep.destroyAttempts).toBe(0);
      expect(destructions).toBe(1);
      expect(getFinancialEffectByOperationKey(db.raw, scope.operationKey)?.state).toBe("pending");
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects")
        .get() as { n: number }).n).toBe(1);
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions")
        .get() as { n: number }).n).toBe(0);
    } finally {
      try {
        db.close();
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        // Only this test-owned directory can be removed. Never touch the
        // host account workspace or another agent\'s persistent state.
        fs.rmSync(testHome, { recursive: true, force: true });
      }
    }
  });
});
