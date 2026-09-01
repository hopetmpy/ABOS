import { describe, expect, it } from "vitest";
import { AwsEnvironmentProvider } from "../environments/aws.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { LocalEnvironmentProvider } from "../environments/local.js";
import type { EnvironmentCommandRunner } from "../environments/types.js";

describe("AWS environment provider", () => {
  it("reports unavailable when the AWS CLI is absent", async () => {
    const runner: EnvironmentCommandRunner = async () => ({
      stdout: "",
      stderr: "ENOENT aws",
      exitCode: 1,
    });
    const snapshot = await new AwsEnvironmentProvider(runner).inspect();
    expect(snapshot.availability).toBe("unavailable");
    expect(snapshot.capabilities.every((capability) => !capability.available)).toBe(true);
  });

  it("distinguishes installed AWS CLI from valid authorization", async () => {
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (args[0] === "--version") {
        return { stdout: "aws-cli/2", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "Unable to locate credentials", exitCode: 1 };
    };

    const snapshot = await new AwsEnvironmentProvider(runner).inspect();
    expect(snapshot.availability).toBe("requires_authorization");
  });

  it("exposes AWS capabilities after STS identity succeeds", async () => {
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (args[0] === "--version") {
        return { stdout: "aws-cli/2", stderr: "", exitCode: 0 };
      }
      return {
        stdout: JSON.stringify({ Account: "123456789012", Arn: "arn:aws:iam::123456789012:user/test" }),
        stderr: "",
        exitCode: 0,
      };
    };

    const snapshot = await new AwsEnvironmentProvider(runner).inspect();
    expect(snapshot.availability).toBe("available");
    expect(snapshot.capabilities.some((capability) => capability.id === "aws:ec2")).toBe(true);
    expect(snapshot.capabilities.every((capability) => capability.available)).toBe(true);
  });
});

describe("Conway environment provider", () => {
  it("reports degraded rather than fully available when no credits remain", async () => {
    const { ConwayEnvironmentProvider } = await import("../environments/conway.js");
    const snapshot = await new ConwayEnvironmentProvider({
      getCreditsBalance: async () => 0,
    }).inspect();

    expect(snapshot.availability).toBe("degraded");
    expect(snapshot.capabilities.every((capability) => !capability.available)).toBe(true);
    expect(snapshot.constraints.join(" ")).toContain("No Conway credits");
  });
});

describe("environment registry", () => {
  it("selects environments by capability instead of provider-specific branching", async () => {
    const registry = new EnvironmentRegistry();
    registry.register(new LocalEnvironmentProvider());

    const matches = await registry.findForCapability("filesystem");
    expect(matches.map((entry) => entry.id)).toContain("local");
  });
});
