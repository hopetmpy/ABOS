import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { CapabilityResolver } from "../capabilities/resolver.js";

describe("CapabilityResolver", () => {
  it("uses an existing capability when one already satisfies the requirement", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      id: "local:python",
      type: "cli",
      provider: "local",
      description: "Python execution",
      requirements: ["python"],
      permissions: [],
      environment: "local",
      available: true,
    });

    const result = new CapabilityResolver(registry).resolve({
      requirement: "python",
      preferredEnvironment: "local",
    });

    expect(result.kind).toBe("use_existing");
    expect(result.candidates[0]?.id).toBe("local:python");
  });

  it("changes environment instead of declaring failure when capability exists elsewhere", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      id: "aws:lambda",
      type: "cloud_resource",
      provider: "aws",
      description: "Serverless function execution",
      requirements: ["serverless"],
      permissions: [],
      environment: "aws",
      available: true,
    });

    const result = new CapabilityResolver(registry).resolve({
      requirement: "serverless",
      preferredEnvironment: "local",
    });

    expect(result.kind).toBe("change_environment");
    expect(result.nextActions.join(" ")).toContain("aws");
  });

  it("treats absent capability as construct/discover work, not impossibility", () => {
    const result = new CapabilityResolver(new CapabilityRegistry()).resolve({
      requirement: "novel capability that is not registered",
    });

    expect(result.kind).toBe("construct");
    expect(result.rationale).toContain("UNKNOWN");
    expect(result.nextActions.join(" ").toLowerCase()).toContain("research");
  });
});
