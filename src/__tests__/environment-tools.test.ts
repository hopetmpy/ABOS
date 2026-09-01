import { describe, expect, it } from "vitest";
import { EnvironmentRegistry } from "../environments/registry.js";
import { createEnvironmentTools } from "../environments/tools.js";
import type { EnvironmentProvider } from "../environments/types.js";

function provider(): EnvironmentProvider {
  return {
    id: "mock",
    async inspect() {
      return {
        id: "mock",
        label: "Mock",
        availability: "available",
        capabilities: [],
        evidence: ["ready"],
        constraints: [],
        observedAt: new Date().toISOString(),
      };
    },
    async execute(args) {
      return {
        stdout: args.join("|"),
        stderr: "",
        exitCode: 0,
      };
    },
  };
}

describe("environment_exec tool", () => {
  it("routes argv to the selected registered provider without shell interpolation", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(provider());
    const tool = createEnvironmentTools(registry)[0]!;
    const result = await tool.execute(
      { environment: "mock", args: ["service", "operation", "--flag=value"] },
      {} as any,
    );
    expect(result).toContain("exit_code: 0");
    expect(result).toContain("service|operation|--flag=value");
  });

  it("refuses execution against unknown providers", async () => {
    const tool = createEnvironmentTools(new EnvironmentRegistry())[0]!;
    const result = await tool.execute(
      { environment: "missing", args: ["x"] },
      {} as any,
    );
    expect(result).toContain("BLOCKED");
  });
});
