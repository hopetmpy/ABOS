import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { capabilityStateOf } from "../capabilities/model.js";

describe("CapabilityRegistry", () => {
  it("does not promote tool/skill existence to verified runtime availability", () => {
    const registry = new CapabilityRegistry();
    registry.ingestTools([{ name: "exec", description: "Execute a local command" }]);
    registry.ingestSkills([{ name: "research", description: "Research a problem", enabled: true }]);

    const tool = registry.get("tool:exec")!;
    const skill = registry.get("skill:research")!;

    expect(tool.available).toBe(false);
    expect(capabilityStateOf(tool)).toBe("discovered_unverified");
    expect(skill.available).toBe(false);
    expect(capabilityStateOf(skill)).toBe("discovered_unverified");
  });

  it("treats legacy available=true without evidence state as unverified", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      id: "legacy:python",
      type: "cli",
      provider: "legacy",
      description: "Legacy Python claim",
      requirements: ["python"],
      permissions: [],
      available: true,
    });

    expect(registry.get("legacy:python")?.available).toBe(false);
    expect(capabilityStateOf(registry.get("legacy:python")!)).toBe("discovered_unverified");
    expect(registry.findSupporting("python")).toEqual([]);
  });

  it("projects a current available environment observation into verified capability truth", () => {
    const registry = new CapabilityRegistry();
    registry.registerEnvironmentSnapshot({
      id: "aws",
      label: "AWS",
      availability: "available",
      evidence: ["AWS STS caller identity verified."],
      constraints: [],
      observedAt: "2026-09-13T23:00:00.000Z",
      capabilities: [{
        id: "aws:lambda",
        type: "cloud_resource",
        provider: "aws",
        description: "Serverless function execution",
        requirements: ["serverless", "function"],
        permissions: [],
        environment: "aws",
        available: true,
      }],
    });

    const capability = registry.get("aws:lambda")!;
    expect(capability.available).toBe(true);
    expect(capabilityStateOf(capability)).toBe("verified_available");
    expect(capability.authority).toBe("environment:aws");
    expect(capability.observedAt).toBe("2026-09-13T23:00:00.000Z");
    expect(capability.evidence).toContain("AWS STS caller identity verified.");
    expect(registry.findSupporting("serverless").map((entry) => entry.id))
      .toContain("aws:lambda");
  });

  it("does not promote a degraded environment capability even when the provider advertises it", () => {
    const registry = new CapabilityRegistry();
    registry.registerEnvironmentSnapshot({
      id: "remote",
      label: "Remote",
      availability: "degraded",
      evidence: ["provider reachable but execution health is degraded"],
      constraints: ["execution health degraded"],
      observedAt: "2026-09-13T23:01:00.000Z",
      capabilities: [{
        id: "remote:compute",
        type: "executor",
        provider: "remote",
        description: "Remote compute",
        requirements: ["compute"],
        permissions: [],
        environment: "remote",
        available: true,
      }],
    });

    const capability = registry.get("remote:compute")!;
    expect(capability.available).toBe(false);
    expect(capabilityStateOf(capability)).toBe("degraded");
  });
});
