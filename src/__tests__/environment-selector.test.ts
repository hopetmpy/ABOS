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
      reliability: input.reliability,
    }),
  };
}

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
      maxEstimatedCostCents: 100,
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
      maxEstimatedCostCents: 100,
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
      maxEstimatedCostCents: 100,
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
      maxEstimatedCostCents: 50,
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
      maxEstimatedCostCents: 10,
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
      maxEstimatedCostCents: 10,
    });

    expect(result.selected?.environmentId).toBe("has-reuse");
    expect(
      result.candidates.find(
        (candidate) => candidate.environmentId === "has-reuse",
      )?.estimate.evidence?.join(" "),
    ).toContain("reusable candidates=1");
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
      maxEstimatedCostCents: 10,
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
