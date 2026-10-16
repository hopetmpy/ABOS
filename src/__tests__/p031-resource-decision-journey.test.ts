import { describe, expect, it } from "vitest";
import { createTestDb } from "./mocks.js";
import { createGoal } from "../orchestration/task-graph.js";
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
      });      const larger = await selector.select({
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
