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
        permissions: [],
        environment: input.id,
        available: (input.availability ?? "available") !== "unavailable",
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
});
