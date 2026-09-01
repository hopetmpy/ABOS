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

  it("redacts provider credentials before returning output to the model", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      id: "mock-secret",
      async inspect() {
        return {
          id: "mock-secret",
          label: "Mock Secret",
          availability: "available",
          capabilities: [],
          evidence: ["ready"],
          constraints: [],
          observedAt: new Date().toISOString(),
        };
      },
      async execute() {
        return {
          stdout: JSON.stringify({
            AccessKeyId: "AKIAABCDEFGHIJKLMNOP",
            SecretAccessKey: "super-secret-value",
            SessionToken: "temporary-session-token",
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    const tool = createEnvironmentTools(registry)[0]!;
    const result = await tool.execute(
      { environment: "mock-secret", args: ["identity"] },
      {} as any,
    );

    expect(result).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(result).not.toContain("super-secret-value");
    expect(result).not.toContain("temporary-session-token");
    expect(result).toContain("[REDACTED");
  });

  it("bounds provider output before returning it to the model", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      id: "mock-large",
      async inspect() {
        return {
          id: "mock-large",
          label: "Mock Large",
          availability: "available",
          capabilities: [],
          evidence: ["ready"],
          constraints: [],
          observedAt: new Date().toISOString(),
        };
      },
      async execute() {
        return {
          stdout: "x".repeat(70_000),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    const tool = createEnvironmentTools(registry)[0]!;
    const result = await tool.execute(
      { environment: "mock-large", args: ["dump"] },
      {} as any,
    );

    expect(result.length).toBeLessThan(65_000);
    expect(result).toContain("[TRUNCATED:");
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
