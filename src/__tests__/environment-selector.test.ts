import { describe, expect, it } from "vitest";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentSelector } from "../environments/selector.js";
import type {
  EnvironmentProvider,
  EnvironmentSnapshot,
} from "../environments/types.js";

function provider(input: {
  id: string;
  availability?: EnvironmentSnapshot["availability"];
  capabilities: string[];
  cost?: number | null;
  reliability?: number | null;
  operations?: string[];
}): EnvironmentProvider {
  return {
    id: input.id,
    operations: input.operations,
    inspect: async () => ({
      id: input.id,
      label: input.id,
      availability: input.availability ?? "available",
      capabilities: input.capabilities.map((capability) => ({
        id: `${input.id}:${capability}`,
        type: "cloud_resource",
        provider: input.id,
        description: capability,
        requirements: [capability],
        provides: [capability],
        permissions: [],
        environment: input.id,
        available: (input.availability ?? "available") !== "unavailable",
        state:
          (input.availability ?? "available") === "unavailable"
            ? "unavailable"
            : "verified_available",
        observedAt: new Date().toISOString(),
        authority: "environment-selector-test",
        evidence: ["test capability verified"],
      })),
      evidence: [],
      constraints: [],
      observedAt: new Date().toISOString(),
    }),
    estimate: async () => ({
      estimatedCostCents: input.cost,
      costCoverage: input.cost == null ? "unknown" : "complete",
      costUnit: "usd_cent",
      reliability: input.reliability,
    }),
  };
}

describe("P-031 independent resource-use duration source contract", () => {
  it("refuses zero, negative, fractional, unsafe, NaN and infinite durations before ranking or dispatch", async () => {
    const registry = new EnvironmentRegistry();
    let inspectCount = 0;
    registry.register({
      ...provider({ id: "priced-cloud", capabilities: ["compute"], cost: 100 }),
      inspect: async () => {
        inspectCount += 1;
        throw new Error("Provider should not be queried for malformed resource lifetime");
      },
    });
    const selector = new EnvironmentSelector(registry);
    for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity,
      Number.MAX_SAFE_INTEGER + 1]) {
      const result = await selector.select({
        requiredCapabilities: ["compute"], expectedDurationMs: value,
      });
      expect(result.selected).toBeNull();
      expect(result.candidates).toEqual([]);
      expect(result.unresolved.join(" ")).toContain("expectedDurationMs");
    }
    expect(inspectCount).toBe(0);
    // Duration genuinely UNKNOWN is still discoverable; no mandatory
    // purchasing timetable or universal fixed duration is invented.
    const normal = new EnvironmentSelector(new EnvironmentRegistry());
    const unknown = await normal.select({
      requiredCapabilities: [], expectedDurationMs: null,
    });
    expect(unknown.candidates).toEqual([]);
    expect(unknown.unresolved.join(" ")).not.toContain("expectedDurationMs");
  });
});

describe("P-031 provision timing from source-attributed provider quotes", () => {
  const DAY = 86_400_000;
  it("distinguishes future quoted window and elapsed window without authorizing purchase", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      ...provider({ id: "synthetic-cloud", capabilities: ["compute"] }),
      estimate: async () => ({
        startupLatencyMs: 4_000, // startup is not full supplier provisioning
        metadata: {
          provisioningLeadTimeMs: 7 * DAY,
          provisioningLeadTimeObservedAt: new Date().toISOString(),
          provisioningLeadTimeSource: "synthetic-supplier-quote",
        },
      }),
    });
    const select = new EnvironmentSelector(registry);
    const later = new Date(Date.now() + 21 * DAY).toISOString();
    const deferred = await select.select({
      requiredCapabilities: ["compute"], neededByAt: later,
    });
    expect(deferred.selected?.provisioningTiming).toMatchObject({
      status: "quoted_window_open",
      neededByAt: later,
      quotedProvisioningLeadTimeMs: 7 * DAY,
      quoteSource: "synthetic-supplier-quote",
    });
    expect(Date.parse(deferred.selected?.provisioningTiming?.latestQuotedStartAt ?? ""))
      .toBeGreaterThan(Date.now());
    expect(deferred.selected?.evidence.join(" ")).toContain("NOT procurement permission");
    const immediate = await select.select({
      requiredCapabilities: ["compute"],
      neededByAt: new Date(Date.now() + DAY).toISOString(),
    });
    expect(immediate.selected?.provisioningTiming?.status).toBe("quoted_window_elapsed");
    // A late quote is not a proven objective impossibility or buying authority.
    expect(immediate.selected?.executionEligible).toBe(true);
  });

  it("ranks evidenced on-time resource paths above unknown and late quotes without forbidding discovery", async () => {
    const registry = new EnvironmentRegistry();
    const observedAt = new Date().toISOString();
    const make = (id: string, cost: number, leadDays: number | null): EnvironmentProvider => ({
      ...provider({ id, capabilities: ["compute"], cost }),
      estimate: async () => ({
        estimatedCostCents: cost,
        costUnit: "usd_cent",
        costCoverage: "complete",
        metadata: leadDays === null ? {} : {
          provisioningLeadTimeMs: leadDays * DAY,
          provisioningLeadTimeObservedAt: observedAt,
          provisioningLeadTimeSource: "scenario-supplier-quote",
        },
      }),
    });
    registry.register(make("cheap-but-late", 1, 14));
    registry.register(make("unknown-lead", 2, null));
    registry.register(make("timely-with-quote", 100, 2));

    const selector = new EnvironmentSelector(registry);
    const neededByAt = new Date(Date.now() + 7 * DAY).toISOString();
    const timed = await selector.select({
      requiredCapabilities: ["compute"],
      neededByAt,
      preferredEnvironment: "cheap-but-late",
    });
    expect(timed.candidates.map(x => x.environmentId)).toEqual([
      "timely-with-quote", "unknown-lead", "cheap-but-late",
    ]);
    expect(timed.selected?.environmentId).toBe("timely-with-quote");
    expect(timed.selected?.provisioningTiming?.status).toBe("quoted_window_open");
    expect(timed.candidates[1]?.provisioningTiming?.status).toBe("unknown");
    expect(timed.candidates[2]?.provisioningTiming?.status).toBe("quoted_window_elapsed");
    expect(timed.candidates[2]?.executionEligible).toBe(true);
    expect(timed.selected?.evidence.join(" ")).toContain("NOT procurement permission");

    // Without an evidenced, explicit resource need date, do not silently
    // elevate old timing estimates above the objective's own preference.
    const untimed = await selector.select({
      requiredCapabilities: ["compute"],
      preferredEnvironment: "cheap-but-late",
    });
    expect(untimed.selected?.environmentId).toBe("cheap-but-late");

    const unknownOrLate = new EnvironmentRegistry();
    unknownOrLate.register(make("cheap-but-late", 1, 14));
    unknownOrLate.register(make("unknown-lead", 2, null));
    const exploratory = await new EnvironmentSelector(unknownOrLate).select({
      requiredCapabilities: ["compute"], neededByAt,
    });
    expect(exploratory.selected?.environmentId).toBe("unknown-lead");
    // An unknown supplier lead time is an opportunity to probe, NOT a
    // guaranteed ability to meet the deadline or authority to buy.
    expect(exploratory.candidates.map(x => x.executionEligible)).toEqual([true, true]);
  });

  it("preserves unknown when only startup latency, stale-free provenance missing, or invalid need date exists", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      ...provider({ id: "synthetic", capabilities: ["compute"] }),
      estimate: async () => ({
        startupLatencyMs: 1_000,
        metadata: { provisioningLeadTimeMs: 100_000 },
      }),
    });
    const select = new EnvironmentSelector(registry);
    const need = new Date(Date.now() + 10 * DAY).toISOString();
    const unknown = await select.select({
      requiredCapabilities: ["compute"], neededByAt: need,
    });
    expect(unknown.selected?.provisioningTiming).toMatchObject({
      status: "unknown", latestQuotedStartAt: null,
    });
    expect(unknown.selected?.evidence.join(" ")).toContain("startupLatencyMs is not an acquisition quote");
    expect(unknown.selected?.executionEligible).toBe(true);
    const invalid = await select.select({
      requiredCapabilities: ["compute"], neededByAt: "2026-11-01",
    });
    expect(invalid.selected).toBeNull();
    expect(invalid.unresolved.join(" ")).toContain("explicit timezone");
  });
  it("rejects impossible need dates before querying providers and accepts actual leap days", async () => {
    const invalidRegistry = new EnvironmentRegistry();
    let providerInspections = 0;
    invalidRegistry.register({
      ...provider({ id: "supplier", capabilities: ["compute"] }),
      inspect: async () => {
        providerInspections += 1;
        throw new Error("An impossible resource need date must not reach supplier selection");
      },
    });
    const invalidSelector = new EnvironmentSelector(invalidRegistry);
    for (const neededByAt of [
      "2026-02-30T12:00:00Z",
      "2026-04-31T09:00:00+05:30",
      "2027-02-29T09:00:00Z",
      "2026-12-01T24:00:00Z",
    ]) {
      const result = await invalidSelector.select({
        requiredCapabilities: ["compute"], neededByAt,
      });
      expect(result.selected).toBeNull();
      expect(result.candidates).toEqual([]);
      expect(result.unresolved.join(" ")).toContain("neededByAt");
    }
    expect(providerInspections).toBe(0);
    const validRegistry = new EnvironmentRegistry();
    validRegistry.register(provider({ id: "supplier", capabilities: ["compute"] }));
    const valid = await new EnvironmentSelector(validRegistry).select({
      requiredCapabilities: ["compute"], neededByAt: "2028-02-29T09:00:00+05:30",
    });
    expect(valid.selected?.environmentId).toBe("supplier");
    expect(valid.selected?.provisioningTiming?.status).toBe("unknown");
  });

  it("preserves UNKNOWN when a supplier lead-time observation has an impossible date", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      ...provider({ id: "supplier", capabilities: ["compute"] }),
      estimate: async () => ({
        metadata: {
          provisioningLeadTimeMs: DAY,
          provisioningLeadTimeObservedAt: "2026-02-30T10:00:00Z",
          provisioningLeadTimeSource: "supplier-data",
        },
      }),
    });
    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["compute"],
      neededByAt: new Date(Date.now() + 7 * DAY).toISOString(),
    });
    expect(result.selected?.provisioningTiming).toMatchObject({
      status: "unknown",
      quoteObservedAt: null,
      latestQuotedStartAt: null,
    });
    // Unverifiable supplier timing must not forbid other feasible discovery.
    expect(result.selected?.executionEligible).toBe(true);
  });
});

describe("EnvironmentSelector", () => {
  it("selects by evidence rather than provider order or provider name", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider({
      id: "provider-expensive",
      capabilities: ["remote compute", "linux"],
      cost: 90,
      reliability: 0.99,
    }));
    registry.register(provider({
      id: "provider-efficient",
      capabilities: ["remote compute", "linux"],
      cost: 30,
      reliability: 0.95,
    }));

    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["remote compute"],
      maxEstimatedCostCents: 100, maxEstimatedCostUnit: "usd_cent",
    });

    expect(result.selected?.environmentId).toBe("provider-efficient");
    expect(result.candidates).toHaveLength(2);
  });

  it("treats preferred environment as preference, not an absolute lock", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider({
      id: "preferred-but-unavailable",
      availability: "unavailable",
      capabilities: ["compute"],
      cost: 1,
    }));
    registry.register(provider({
      id: "alternate",
      capabilities: ["compute"],
      cost: 10,
    }));

    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["compute"],
      preferredEnvironment: "preferred-but-unavailable",
      maxEstimatedCostCents: 100, maxEstimatedCostUnit: "usd_cent",
    });

    expect(result.selected?.environmentId).toBe("alternate");
    expect(result.candidates.find((entry) =>
      entry.environmentId === "preferred-but-unavailable"
    )?.blockers.join(" ")).toContain("availability=unavailable");
  });

  it("does not claim impossibility when no environment is executable", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider({
      id: "unknown-provider",
      availability: "unknown",
      capabilities: [],
      cost: null,
    }));

    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["novel capability"],
    });

    expect(result.selected).toBeNull();
    expect(result.unresolved.join(" ").toLowerCase()).toContain("not proof");
    expect(result.unresolved.join(" ").toLowerCase()).toContain("impossible");
  });

  it("requires explicit lifecycle operations when the task needs them", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider({
      id: "inspect-only",
      capabilities: ["compute"],
      cost: 0,
    }));
    registry.register({
      ...provider({
        id: "provisioner",
        capabilities: ["compute"],
        cost: 20,
      }),
      provision: async () => ({
        externalId: "resource-1",
        status: "ready",
      }),
    });

    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["compute"],
      requiredOperations: ["provision"],
      maxEstimatedCostCents: 100, maxEstimatedCostUnit: "usd_cent",
    });

    expect(result.selected?.environmentId).toBe("provisioner");
    expect(result.candidates.find((entry) =>
      entry.environmentId === "inspect-only"
    )?.missingOperations).toContain("provision");
  });

  it("fails closed on an explicit budget when provider cost is unknown", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider({
      id: "unknown-cost",
      capabilities: ["compute"],
      cost: null,
    }));

    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["compute"],
      maxEstimatedCostCents: 50, maxEstimatedCostUnit: "usd_cent",
    });

    expect(result.selected).toBeNull();
    expect(result.candidates[0]?.blockers.join(" ")).toContain(
      "coverage=unknown",
    );
  });

  it("fails closed on partial cost coverage under an explicit budget", async () => {
    const registry = new EnvironmentRegistry();
    const partial = provider({
      id: "partial-cost",
      capabilities: ["compute"],
      cost: 5,
    });
    partial.estimate = async () => ({
      estimatedCostCents: 5,
      costCoverage: "partial",
      evidence: ["compute-only estimate"],
    });
    registry.register(partial);

    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["compute"],
      maxEstimatedCostCents: 10, maxEstimatedCostUnit: "usd_cent",
    });

    expect(result.selected).toBeNull();
    expect(result.candidates[0]?.blockers.join(" ")).toContain(
      "coverage=partial",
    );
  });

  it("uses provider-neutral reusable resource evidence as ranking evidence", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider({
      id: "no-reuse",
      capabilities: ["compute"],
      cost: 5,
      reliability: 0.9,
    }));
    registry.register(provider({
      id: "has-reuse",
      capabilities: ["compute"],
      cost: 5,
      reliability: 0.9,
    }));

    const result = await new EnvironmentSelector(registry, {
      reuseEvaluator: (environmentId) =>
        environmentId === "has-reuse" ? 1 : 0,
    }).select({
      requiredCapabilities: ["compute"],
      maxEstimatedCostCents: 10, maxEstimatedCostUnit: "usd_cent",
    });

    expect(result.selected?.environmentId).toBe("has-reuse");
    expect(
      result.candidates.find(
        (candidate) => candidate.environmentId === "has-reuse",
      )?.estimate.evidence?.join(" "),
    ).toContain("reusable candidates=1");
  });

  it("does not treat provider-reported spare capacity as ABOS-owned inventory", async () => {
    const registry = new EnvironmentRegistry();
    const reported = provider({
      id: "a-vendor-claimed-spare", capabilities: ["compute"], cost: 5,
    });
    reported.estimate = async () => ({
      estimatedCostCents: 5, costCoverage: "complete", costUnit: "usd_cent",
      reusableResourceCount: 900,
      evidence: ["Supplier claims spare capacity, not ABOS-owned."],
    });
    registry.register(reported);
    registry.register(provider({
      id: "z-verified-inventory", capabilities: ["compute"], cost: 5,
    }));

    const observed = await new EnvironmentSelector(registry, {
      reuseEvaluator: id => id === "z-verified-inventory" ? 1 : 0,
    }).select({ requiredCapabilities: ["compute"] });
    expect(observed.selected?.environmentId).toBe("z-verified-inventory");
    expect(observed.candidates.find(c => c.environmentId === "a-vendor-claimed-spare")
      ?.estimate.reusableResourceCount).toBe(0);
    expect(observed.candidates.find(c => c.environmentId === "a-vendor-claimed-spare")
      ?.evidence.join(" ")).toContain("ABOS ownership and spare capacity are not established");

    const noInventory = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["compute"],
    });
    expect(noInventory.candidates.find(c => c.environmentId === "a-vendor-claimed-spare")
      ?.estimate.reusableResourceCount).toBeNull();
    expect(noInventory.selected?.environmentId).toBe("a-vendor-claimed-spare");
  });

  it("treats budget amount and unit as an inseparable economic contract", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider({
      id: "priced", capabilities: ["compute"], cost: 10,
    }));
    const selector = new EnvironmentSelector(registry);
    for (const request of [
      { requiredCapabilities: ["compute"], maxEstimatedCostCents: 100 },
      { requiredCapabilities: ["compute"], maxEstimatedCostUnit: "usd_cent" },
      { requiredCapabilities: ["compute"], maxEstimatedCostCents: 100,
        maxEstimatedCostUnit: "credit_cent" },
    ]) {
      const result = await selector.select(request);
      expect(result.selected).toBeNull();
      expect(result.candidates[0]?.blockers.join(" ")).toMatch(
        /amount and exact monetary unit|does not match explicit budget unit/,
      );
    }
    const comparable = await selector.select({
      requiredCapabilities: ["compute"], maxEstimatedCostCents: 10,
      maxEstimatedCostUnit: "usd_cent",
    });
    expect(comparable.selected?.environmentId).toBe("priced");
  });

  it("never ranks incomparable currencies or partial quotes as cheaper total cost", async () => {
    const registry = new EnvironmentRegistry();
    const usd = provider({
      id: "a-usd", capabilities: ["compute"], cost: 100, reliability: 0.9,
    });
    const credits = provider({
      id: "z-credits", capabilities: ["compute"], cost: 1, reliability: 0.9,
    });
    credits.estimate = async () => ({
      estimatedCostCents: 1, costCoverage: "complete",
      costUnit: "credit_cent", reliability: 0.9,
    });
    registry.register(usd);
    registry.register(credits);
    const selector = new EnvironmentSelector(registry);
    const unbudgeted = await selector.select({
      requiredCapabilities: ["compute"],
    });
    // No conversion rate exists: score ties, so stable name ordering, NOT
    // numeric 1 credit vs 100 USD, decides the otherwise equivalent options.
    expect(unbudgeted.selected?.environmentId).toBe("a-usd");
    const budgeted = await selector.select({
      requiredCapabilities: ["compute"], maxEstimatedCostCents: 150,
      maxEstimatedCostUnit: "usd_cent",
    });
    expect(budgeted.selected?.environmentId).toBe("a-usd");
    expect(budgeted.candidates.find(c => c.environmentId === "z-credits")
      ?.blockers.join(" ")).toContain("does not match explicit budget unit");
    // A partial quote cannot win an unbudgeted total-cost tie-break either.
    credits.estimate = async () => ({
      estimatedCostCents: 1, costCoverage: "partial", costUnit: "usd_cent",
      reliability: 0.9,
    });
    expect((await selector.select({ requiredCapabilities: ["compute"] }))
      .selected?.environmentId).toBe("a-usd");
  });

  it("lets policy exclude a route without treating the objective as impossible", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider({
      id: "candidate-a",
      capabilities: ["compute"],
      cost: 1,
    }));
    registry.register(provider({
      id: "candidate-b",
      capabilities: ["compute"],
      cost: 2,
    }));

    const result = await new EnvironmentSelector(registry, {
      policyEvaluator: (candidate) => ({
        allowed: candidate.environmentId !== "candidate-a",
        reason: "candidate-a prohibited for this objective",
      }),
    }).select({
      requiredCapabilities: ["compute"],
      maxEstimatedCostCents: 10, maxEstimatedCostUnit: "usd_cent",
    });

    expect(result.selected?.environmentId).toBe("candidate-b");
    expect(result.candidates.find((entry) =>
      entry.environmentId === "candidate-a"
    )?.blockers.join(" ")).toContain("policy");
  });

  it("does not elevate legacy available=true to execution-ready", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      id: "legacy",
      inspect: async () => ({
        id: "legacy",
        label: "legacy",
        availability: "available",
        capabilities: [{
          id: "legacy:compute",
          type: "cloud_resource",
          provider: "legacy",
          description: "Legacy compute advertisement",
          requirements: ["compute"],
          provides: ["compute"],
          permissions: [],
          available: true,
        }],
        evidence: ["legacy provider advertised compute"],
        constraints: [],
        observedAt: new Date().toISOString(),
      }),
      canSatisfy: async () => ({ satisfiable: true, missingCapabilities: [] }),
    });

    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["compute"],
    });

    expect(result.selected).toBeNull();
    expect(result.candidates[0]?.missingCapabilities).toContain("compute");
  });

  it("does not treat free-form description text as an execution contract", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      id: "fuzzy",
      inspect: async () => ({
        id: "fuzzy",
        label: "fuzzy",
        availability: "available",
        capabilities: [{
          id: "fuzzy:generic",
          type: "service",
          provider: "fuzzy",
          description: "This description mentions privileged remote compute but does not contractually provide it.",
          requirements: ["generic service"],
          provides: ["generic service"],
          permissions: [],
          available: true,
          state: "verified_available",
          observedAt: new Date().toISOString(),
          authority: "test",
          evidence: ["generic service probed"],
        }],
        evidence: [],
        constraints: [],
        observedAt: new Date().toISOString(),
      }),
      canSatisfy: async () => ({ satisfiable: true, missingCapabilities: [] }),
    });

    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["remote compute"],
    });

    expect(result.selected).toBeNull();
    expect(result.candidates[0]?.missingCapabilities).toContain("remote compute");
  });

  it("does not let provider canSatisfy override canonical readiness", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      id: "optimistic",
      inspect: async () => ({
        id: "optimistic",
        label: "optimistic",
        availability: "available",
        capabilities: [{
          id: "optimistic:compute",
          type: "cloud_resource",
          provider: "optimistic",
          description: "Compute discovered but not functionally verified.",
          requirements: ["compute"],
          provides: ["compute"],
          permissions: [],
          available: true,
          state: "discovered_unverified",
          observedAt: new Date().toISOString(),
          authority: "provider-discovery",
          evidence: ["service listed"],
        }],
        evidence: [],
        constraints: [],
        observedAt: new Date().toISOString(),
      }),
      canSatisfy: async () => ({
        satisfiable: true,
        capabilityFit: 1,
        missingCapabilities: [],
        evidence: ["provider claims yes"],
      }),
    });

    const result = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["compute"],
    });

    expect(result.selected).toBeNull();
    expect(result.candidates[0]?.satisfaction.satisfiable).toBe(false);
  });
});
