import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { createCapabilityTools } from "../capabilities/tools.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import type { EnvironmentProvider } from "../environments/types.js";

describe("capability discovery tools", () => {
  it("resolves across evidence-backed environment capabilities", async () => {
    const capabilities = new CapabilityRegistry();
    const environments = new EnvironmentRegistry();
    const provider: EnvironmentProvider = {
      id: "remote",
      async inspect() {
        return {
          id: "remote",
          label: "Remote",
          availability: "available",
          evidence: ["remote provider probe passed"],
          constraints: [],
          observedAt: "2026-09-13T23:00:00.000Z",
          capabilities: [{
            id: "remote:object-store",
            type: "cloud_resource",
            provider: "remote",
            description: "Object storage",
            requirements: ["object storage"],
            permissions: [],
            environment: "remote",
            available: true,
          }],
        };
      },
    };
    environments.register(provider);

    const tool = createCapabilityTools(capabilities, environments)
      .find((entry) => entry.name === "resolve_capability")!;
    const raw = await tool.execute({ requirement: "object storage" }, {} as any);
    const result = JSON.parse(raw) as {
      kind: string;
      candidates: Array<{
        id: string;
        state: string;
        authority: string;
        evidence: string[];
      }>;
    };

    expect(result.kind).toBe("use_existing");
    expect(result.candidates.map((candidate) => candidate.id))
      .toContain("remote:object-store");
    expect(result.candidates[0]?.state).toBe("verified_available");
    expect(result.candidates[0]?.authority).toBe("environment:remote");
    expect(result.candidates[0]?.evidence).toContain("remote provider probe passed");
  });

  it("does not promote degraded environment advertisements to use_existing", async () => {
    const capabilities = new CapabilityRegistry();
    const environments = new EnvironmentRegistry();
    const provider: EnvironmentProvider = {
      id: "remote",
      async inspect() {
        return {
          id: "remote",
          label: "Remote",
          availability: "degraded",
          evidence: ["health probe degraded"],
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
        };
      },
    };
    environments.register(provider);

    const tool = createCapabilityTools(capabilities, environments)
      .find((entry) => entry.name === "resolve_capability")!;
    const raw = await tool.execute({ requirement: "compute" }, {} as any);
    const result = JSON.parse(raw) as {
      kind: string;
      candidates: Array<{ state: string; available: boolean }>;
    };

    expect(result.kind).not.toBe("use_existing");
    expect(result.candidates[0]?.state).toBe("degraded");
    expect(result.candidates[0]?.available).toBe(false);
  });

  it("keeps authorization absence explicit in environment inspection", async () => {
    const capabilities = new CapabilityRegistry();
    const environments = new EnvironmentRegistry();
    environments.register({
      id: "cloud",
      async inspect() {
        return {
          id: "cloud",
          label: "Cloud",
          availability: "requires_authorization",
          evidence: ["credentials unavailable"],
          constraints: ["authorization required"],
          observedAt: "2026-09-13T23:02:00.000Z",
          capabilities: [{
            id: "cloud:compute",
            type: "cloud_resource",
            provider: "cloud",
            description: "Cloud compute",
            requirements: ["compute"],
            permissions: [],
            environment: "cloud",
            available: false,
          }],
        };
      },
    });

    const tool = createCapabilityTools(capabilities, environments)
      .find((entry) => entry.name === "inspect_environments")!;
    const raw = await tool.execute({}, {} as any);
    const result = JSON.parse(raw) as Array<{
      availability: string;
      capabilities: Array<{ state: string; available: boolean }>;
    }>;

    expect(result[0]?.availability).toBe("requires_authorization");
    expect(result[0]?.capabilities[0]?.state).toBe("unauthorized");
    expect(result[0]?.capabilities[0]?.available).toBe(false);
  });

  it("reports UNKNOWN work as construction/discovery rather than impossibility", async () => {
    const tool = createCapabilityTools(
      new CapabilityRegistry(),
      new EnvironmentRegistry(),
    ).find((entry) => entry.name === "resolve_capability")!;

    const raw = await tool.execute({ requirement: "unseen capability" }, {} as any);
    const result = JSON.parse(raw) as { kind: string; rationale: string };

    expect(result.kind).toBe("construct");
    expect(result.rationale).toContain("UNKNOWN");
  });
});
