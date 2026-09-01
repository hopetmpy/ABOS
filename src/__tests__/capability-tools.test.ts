import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { createCapabilityTools } from "../capabilities/tools.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import type { EnvironmentProvider } from "../environments/types.js";

describe("capability discovery tools", () => {
  it("resolves across environment-advertised capabilities", async () => {
    const capabilities = new CapabilityRegistry();
    const environments = new EnvironmentRegistry();
    const provider: EnvironmentProvider = {
      id: "remote",
      async inspect() {
        return {
          id: "remote",
          label: "Remote",
          availability: "available",
          evidence: ["ok"],
          constraints: [],
          observedAt: new Date().toISOString(),
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
    const result = JSON.parse(raw) as { kind: string; candidates: Array<{ id: string }> };

    expect(result.kind).toBe("use_existing");
    expect(result.candidates.map((candidate) => candidate.id))
      .toContain("remote:object-store");
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
