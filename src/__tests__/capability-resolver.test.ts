import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { CapabilityResolver } from "../capabilities/resolver.js";

describe("CapabilityResolver", () => {
  it("uses an existing capability only when current state is verified_available", () => {
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
      state: "verified_available",
      observedAt: "2026-09-13T23:00:00.000Z",
      evidence: ["python executable probe succeeded"],
    });

    const result = new CapabilityResolver(registry).resolve({
      requirement: "python",
      preferredEnvironment: "local",
    });

    expect(result.kind).toBe("use_existing");
    expect(result.candidates[0]?.id).toBe("local:python");
  });

  it("does not treat legacy available=true as verified after restart-style reconstruction", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      id: "legacy:python",
      type: "cli",
      provider: "legacy",
      description: "Python execution",
      requirements: ["python"],
      permissions: [],
      environment: "local",
      available: true,
    });

    const result = new CapabilityResolver(registry).resolve({ requirement: "python" });

    expect(result.kind).toBe("probe");
    expect(result.rationale).toContain("VERIFIED_AVAILABLE");
    expect(result.candidates[0]?.available).toBe(false);
  });

  it("does not treat an empty permission declaration as universal authorization", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      id: "service:write",
      type: "service",
      provider: "test",
      description: "A service capability",
      requirements: ["write data"],
      permissions: [],
      environment: "local",
      available: true,
      state: "verified_available",
      evidence: ["service health probe passed"],
    });

    const result = new CapabilityResolver(registry).resolve({
      requirement: "write data",
      requiredPermissions: ["data:write"],
    });

    expect(result.kind).not.toBe("use_existing");
  });

  it("changes environment instead of declaring failure when a verified capability exists elsewhere", () => {
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
      state: "verified_available",
      evidence: ["AWS STS verified and provider probe passed"],
    });

    const result = new CapabilityResolver(registry).resolve({
      requirement: "serverless",
      preferredEnvironment: "local",
    });

    expect(result.kind).toBe("change_environment");
    expect(result.nextActions.join(" ")).toContain("aws");
  });

  it("keeps unauthorized capability distinct from available or impossible", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      id: "aws:ec2",
      type: "cloud_resource",
      provider: "aws",
      description: "EC2 compute",
      requirements: ["compute"],
      permissions: [],
      environment: "aws",
      available: false,
      state: "unauthorized",
      evidence: ["AWS STS rejected current credentials"],
    });

    const result = new CapabilityResolver(registry).resolve({ requirement: "compute" });

    expect(result.kind).toBe("blocked");
    expect(result.rationale).toContain("UNAUTHORIZED");
    expect(result.nextActions.join(" ")).toContain("authorization");
  });

  it("keeps prohibited routes blocked without declaring the objective impossible", () => {
    const registry = new CapabilityRegistry();
    registry.register({
      id: "policy:blocked-route",
      type: "service",
      provider: "policy",
      description: "A policy-blocked route",
      requirements: ["special operation"],
      permissions: [],
      available: false,
      state: "prohibited",
      evidence: ["policy authority prohibits this route"],
    });

    const result = new CapabilityResolver(registry).resolve({
      requirement: "special operation",
    });

    expect(result.kind).toBe("blocked");
    expect(result.rationale).toContain("PROHIBITED");
    expect(result.rationale).toContain("route");
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
