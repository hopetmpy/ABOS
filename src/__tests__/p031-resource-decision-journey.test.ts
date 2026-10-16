import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "./mocks.js";
import { createGoal, getReadyTasks } from "../orchestration/task-graph.js";
import { getTasksByGoal } from "../state/database.js";
import { Orchestrator, getReviewedTaskPathReceipt } from "../orchestration/orchestrator.js";
import { ColonyMessaging } from "../orchestration/messaging.js";
import type { AbosDatabase } from "../types.js";
import { buildPlannerContext } from "../orchestration/planner-context.js";
import { buildPlannerPrompt } from "../orchestration/planner.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentSelector } from "../environments/selector.js";
import type { EnvironmentProvider } from "../environments/types.js";
import { assessProviderProcurementScenario } from "../economics/treasury-scenario.js";

function observedProvider(id: string): EnvironmentProvider {
  return {
    id,
    inspect: async () => ({
      id, label: id, availability: "available",
      capabilities: [{
        id: `${id}:compute`,
        type: "cloud_resource",
        provider: id,
        description: "Verified generic compute capability in synthetic provider",
        requirements: ["compute"], provides: ["compute"], permissions: [],
        environment: id, available: true, state: "verified_available",
        observedAt: "2026-10-15T12:00:00.000Z",
        authority: "synthetic-e3-test",
        evidence: ["Synthetic provider observation; not a LIVE account."],
      }],
      evidence: ["Synthetic provider snapshot; not an external deployment."],
      constraints: [],
      observedAt: "2026-10-15T12:00:00.000Z",
    }),
    estimate: async () => ({
      estimatedCostCents: 1500,
      costUnit: "usd_cent",
      costCoverage: "complete",
      reliability: 0.8,
      evidence: ["Synthetic pricing input; neither invoiced cost nor spending authority."],
    }),
  };
}

describe("P-031 coherent Goal → owned inventory → selection → treasury evidence", () => {
  it("materializes a reviewed mixed-service objective as a complete, dependency-aware Task graph without authorizing purchase", async () => {
    const db = createTestDb();
    try {
      const goal = createGoal(db.raw, "Launch a recoverable SaaS",
        "Deploy a service needing compute, domain/DNS, an external API and backup.");
      const inventory = new EnvironmentResourceStore(db.raw);
      inventory.create({
        provider: "synthetic-compute", type: "vm", status: "ready",
        goalId: goal.id, capabilities: ["compute"],
        metadata: { capacity: { cpuCores: 2, memoryMb: 2048 } },
      });
      // These tasks discover dependencies. None claims deployment readiness
      // or external purchasing authority before the observations exist.
      const tasks = [
        { title: "Inspect owned compute", description: "Measure available capacity and demand.",
          resourceNeed: {
            basis: "Synthetic load observations for this workload",
            minimumCapacity: { cpuCores: 4, memoryMb: 8192 },
            neededByAt: "2026-12-01T15:00:00Z",
            expectedResourceDurationMs: 7_200_000,
          }, dependencies: [] as number[] },
        { title: "Discover domain terms", description: "Observe authoritative registrar and DNS requirements.",
          dependencies: [] as number[] },
        { title: "Discover API terms", description: "Observe access, pricing and restrictions of required API.",
          dependencies: [] as number[] },
        { title: "Discover backup terms", description: "Observe storage and recovery choices.",
          dependencies: [] as number[] },
        { title: "Review complete service economics",
          description: "Combine all observed requirements before any material acquisition.",
          dependencies: [0, 1, 2, 3] },
      ].map((task, i) => ({
        ...task, agentRole: "generalist",
        estimatedCostCents: 100, priority: 80 - i,
        timeoutMs: 90_000, requiredCapabilities: [],
        preferredEnvironment: null,
      }));
      const plan = {
        analysis: "Inspect all independent service dependencies before deployment.",
        strategy: "Discover needs first, preserve local compute, then select acquisitions.",
        path: {
          hypothesis: "Source-backed dependency discovery prevents partial SaaS deployment.",
          assumptions: ["Supplier account evidence has not yet been observed."],
          requiredCapabilities: [], preferredEnvironment: null,
          expectedOutcome: "Complete verified dependency and economic assessment.",
        },
        alternatives: [{
          label: "alternate-local-first",
          strategy: "Build an isolated local prototype and probe provider costs later.",
          hypothesis: "Local prototype may reduce initial external dependencies.",
          assumptions: ["Local machine may be sufficient to test the interface."],
          requiredCapabilities: [], preferredEnvironment: "local",
          sequence: ["Prototype locally", "Inspect account terms"],
          expectedOutcome: "A local proof before deciding on providers.",
          estimatedCostCents: 350,
          discriminants: ["Uses a different environment and order of work."],
        }],
        decisionFactors: ["Known compute is undersized; all supplier terms remain UNKNOWN."],
        preMortem: ["Domain, API or backup might be missing after compute deployment."],
        falsificationConditions: ["Observed services prove to have materially different requirements."],
        tasks, risks: ["Unpriced subscriptions cannot be treated as free resources."],
        customRoles: [], estimatedTotalCostCents: 500, estimatedTimeMinutes: 90,
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
      const funding = {
        fundChild: vi.fn().mockResolvedValue({ success: true }),
        recallCredits: vi.fn().mockResolvedValue({ success: true, amountCents: 0 }),
        getBalance: vi.fn().mockResolvedValue(1000),
      };
      const transport = {
        deliver: vi.fn().mockResolvedValue(undefined),
        getRecipients: vi.fn().mockReturnValue([]),
      };
      const orchestrator = new Orchestrator({
        db: db.raw, agentTracker: tracker, funding,
        messaging: new ColonyMessaging(transport, db as unknown as AbosDatabase),
        inference: { chat: vi.fn() } as any,
        identity: {
          name: "e3-actor", address: "0x1234",
          account: {}, creatorAddress: "0x0000",
          sandboxId: "e3-sandbox", apiKey: "synthetic", createdAt: "2026-01-01T00:00:00Z",
        } as any,
        config: { disableSpawn: true },
      });
      const review = await orchestrator.tick();
      expect(review.phase).toBe("executing");
      const materialized = getTasksByGoal(db.raw, goal.id);
      expect(materialized.map(task => task.title).sort()).toEqual(tasks.map(t => t.title).sort());
      const capacityTask = materialized.find(task => task.title === "Inspect owned compute")!;
      expect(capacityTask.resourceNeed).toEqual(tasks[0]!.resourceNeed);
      expect(capacityTask.timeoutMs).toBe(90_000);
      expect(getReviewedTaskPathReceipt(db.raw, capacityTask.id)?.goalId).toBe(goal.id);
      const final = materialized.find(task => task.title === "Review complete service economics")!;
      expect(final.dependencies).toHaveLength(4);
      expect(final.dependencies.every(id => materialized.some(t => t.id === id))).toBe(true);
      expect(final.status).toBe("blocked");
      expect(getReadyTasks(db.raw).find(t => t.id === final.id)).toBeUndefined();
      expect(inventory.list()).toHaveLength(1);
      expect((db.raw.prepare("SELECT COUNT(*) AS count FROM financial_effects")
        .get() as { count: number }).count).toBe(0);
      // An incomplete dependency contract cannot be interpreted as an
      // authorizing token to buy a server or open a new provider account.
    } finally { db.close(); }
  });

  it("reuses a Task-compatible owned compute candidate while keeping uncovered SaaS dependencies discoverable", async () => {
    const db = createTestDb();
    try {
      const goal = createGoal(
        db.raw, "Deliver subscription SaaS",
        "Deploy and validate a SaaS with compute, backups and an external domain.",
      );
      const inventory = new EnvironmentResourceStore(db.raw);
      const owned = inventory.create({
        provider: "cloud-owned", externalId: "vm-existing", type: "vm",
        goalId: goal.id, status: "running", capabilities: ["compute"],
        metadata: { instanceType: "small" },
      });
      const context = await buildPlannerContext({ db: db.raw, goalId: goal.id });
      expect(context.ownedResources).toMatchObject({
        status: "observed", total: 1,
        resources: [{ id: owned.id, goalId: goal.id, instanceType: "small" }],
      });
      const prompt = buildPlannerPrompt(context);
      expect(prompt).toContain("Deploy and validate a SaaS");
      expect(prompt).toContain("Canonical P-018 owned resource inventory");
      expect(prompt).toContain("Map dependencies of the FULL deliverable");
      expect(prompt).toContain("earliest resource need, provisioning lead time");
      expect(prompt).not.toContain("vm-existing\": \"authorized_to_purchase");

      const registry = new EnvironmentRegistry();
      registry.register(observedProvider("cloud-empty"));
      registry.register(observedProvider("cloud-owned"));
      const selector = new EnvironmentSelector(registry, {
        reuseEvaluator: (provider, requirements) => inventory.findReusableCandidates({
          provider,
          requiredCapabilities: requirements.requiredCapabilities,
          requiredInstanceType:
            typeof requirements.metadata?.instanceType === "string"
              ? requirements.metadata.instanceType : null,
        }).length,
      });
      const compatible = await selector.select({
        requiredCapabilities: ["compute"], metadata: { instanceType: "small" },
      });
      expect(compatible.selected?.environmentId).toBe("cloud-owned");
      expect(compatible.selected?.estimate.reusableResourceCount).toBe(1);

      // The same owned VM may satisfy an initial load but must not be
      // counted as enough when measured demand increases.
      inventory.applyMutation(owned.id, {
        metadata: { capacity: { cpuCores: 2, memoryMb: 2048 } },
      }, "capacity_observed");
      const sizedSelector = new EnvironmentSelector(registry, {
        reuseEvaluator: (provider, requirements) => inventory.findReusableCandidates({
          provider,
          requiredCapabilities: requirements.requiredCapabilities,
          minimumCapacity: requirements.minimumCapacity,
        }).length,
      });
      const initialDemand = await sizedSelector.select({
        requiredCapabilities: ["compute"],
        minimumCapacity: { cpuCores: 2, memoryMb: 2048 },
      });
      expect(initialDemand.candidates.find(x => x.environmentId === "cloud-owned")
        ?.estimate.reusableResourceCount).toBe(1);
      const surgeDemand = await sizedSelector.select({
        requiredCapabilities: ["compute"],
        minimumCapacity: { cpuCores: 8, memoryMb: 8192 },
      });
      expect(surgeDemand.candidates.find(x => x.environmentId === "cloud-owned")
        ?.estimate.reusableResourceCount).toBe(0);
      expect(surgeDemand.selected).not.toBeNull();
      // It may search external larger capacity; no purchase is authorized.
      expect(inventory.list()).toHaveLength(1);

      const larger = await selector.select({
        requiredCapabilities: ["compute"], metadata: { instanceType: "large" },
      });
      expect(larger.candidates.find(x => x.environmentId === "cloud-owned")
        ?.estimate.reusableResourceCount).toBe(0);
      // The provider could still discover/provision a larger resource;
      // lack of matching owned spare is not global impossibility.
      expect(larger.selected).not.toBeNull();

      const backupNeeded = await selector.select({
        requiredCapabilities: ["compute", "backup"],
      });
      expect(backupNeeded.selected).toBeNull();
      expect(backupNeeded.unresolved.join(" ").toLowerCase()).toContain("not proof");
      expect(inventory.list()).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("never turns a synthetic supplier quote or budget into a purchase despite a missing dependency", () => {
    const treasury = assessProviderProcurementScenario({
      provider: "cloud-owned", accountId: "synthetic-account", unit: "usd_cent",
      resourceNeedEvidence: ["SaaS plan includes a backup capacity gap."],
      alternatives: [{
        id: "reuse-first",
        unit: "usd_cent", projectedCostCents: 0,
        evidence: "Existing compute may be reused; backup is still missing.",
      }],
      cost: {
        oneTimeCents: 1500, recurringCentsPerPeriod: 500, periods: 3,
        otherChargesCents: null,
        unpricedComponents: ["domain and backup costs not quoted"],
        billingTermsEvidence: ["Illustrative scenario terms only."],
      },
      financing: {
        accountId: "synthetic-account", unit: "usd_cent",
        observedAvailableCents: 20000, basis: "budget_threshold",
        evidence: ["Budget is not externally authenticated liquidity."],
      },
      existingCommitmentsCents: 0,
      reservedCents: 0,
      additionalContingencyCents: null,
      contingencyEvidence: [],
    });
    expect(treasury.status).toBe("needs_evidence");
    expect(treasury.totalProposedCommitmentCents).toBeNull();
    expect(treasury.freeBeforeProposalCents).toBeNull();
    expect(treasury.freeAfterProposalAndContingencyCents).toBeNull();
    expect(treasury.limitations.join(" ")).toContain("NOT P-010 authorization");
  });
});
