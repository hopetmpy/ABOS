import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../capabilities/registry.js";

describe("CapabilityRegistry", () => {
  it("unifies tools, skills, and environment capabilities without replacing their implementations", () => {
    const registry = new CapabilityRegistry();
    registry.ingestTools([{ name: "exec", description: "Execute a local command" }]);
    registry.ingestSkills([{ name: "research", description: "Research a problem", enabled: true }]);
    registry.register({
      id: "aws:lambda",
      type: "cloud_resource",
      provider: "aws",
      description: "Serverless function execution",
      requirements: ["serverless", "function"],
      permissions: [],
      environment: "aws",
      available: true,
    });

    expect(registry.get("tool:exec")?.available).toBe(true);
    expect(registry.get("skill:research")?.type).toBe("skill");
    expect(registry.findSupporting("serverless").map((entry) => entry.id))
      .toContain("aws:lambda");
  });
});
