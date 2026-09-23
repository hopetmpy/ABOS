import { describe, expect, it } from "vitest";
import { capabilityStateOf } from "../capabilities/model.js";
import { AwsEnvironmentProvider } from "../environments/aws.js";
import { ConwayEnvironmentProvider } from "../environments/conway.js";
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentSelector } from "../environments/selector.js";
import { createEnvironmentTools } from "../environments/tools.js";
import type { EnvironmentCommandRunner } from "../environments/types.js";

describe("P018 provider readiness reconciliation", () => {
  it("does not elevate Conway credits into verified sandbox or inference capability", async () => {
    const conway = new ConwayEnvironmentProvider({
      getCreditsBalance: async () => 5_000,
    });

    const snapshot = await conway.inspect();
    expect(snapshot.availability).toBe("available");
    expect(snapshot.capabilities.map(capabilityStateOf)).toEqual([
      "discovered_unverified",
      "discovered_unverified",
    ]);

    const registry = new EnvironmentRegistry();
    registry.register(conway);
    const selection = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["remote compute"],
    });

    expect(selection.selected).toBeNull();
    expect(selection.candidates[0]?.missingCapabilities).toContain(
      "remote compute",
    );
  });

  it("does not elevate AWS CLI plus successful STS identity into service readiness", async () => {
    const runner: EnvironmentCommandRunner = async (_command, args) => {
      if (args[0] === "--version") {
        return { exitCode: 0, stdout: "aws-cli/2.test", stderr: "" };
      }
      if (args[0] === "sts" && args[1] === "get-caller-identity") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            Account: "123456789012",
            Arn: "arn:aws:iam::123456789012:user/test",
            UserId: "AIDATEST",
          }),
          stderr: "",
        };
      }
      if (args[0] === "configure" && args[1] === "get" && args[2] === "region") {
        return { exitCode: 0, stdout: "us-east-1\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "unimplemented test command" };
    };
    const aws = new AwsEnvironmentProvider({ runner });

    const snapshot = await aws.inspect();
    expect(snapshot.availability).toBe("available");
    expect(snapshot.evidence.join(" ")).toContain(
      "AWS STS caller identity verified",
    );
    expect(snapshot.capabilities).toHaveLength(8);
    expect(
      snapshot.capabilities.every(
        (capability) => capabilityStateOf(capability) === "discovered_unverified",
      ),
    ).toBe(true);

    const registry = new EnvironmentRegistry();
    registry.register(aws);
    const selection = await new EnvironmentSelector(registry).select({
      requiredCapabilities: ["ec2"],
    });

    expect(selection.selected).toBeNull();
    expect(selection.candidates[0]?.missingCapabilities).toContain("ec2");
  });

  it("projects full capability lifecycle truth through environment_capabilities", async () => {
    const registry = new EnvironmentRegistry();
    registry.register({
      id: "projection-test",
      inspect: async () => ({
        id: "projection-test",
        label: "Projection Test",
        availability: "available",
        capabilities: [
          {
            id: "projection-test:legacy",
            type: "service",
            provider: "projection-test",
            description: "legacy availability only",
            requirements: ["legacy"],
            provides: ["legacy"],
            permissions: [],
            available: true,
          },
          {
            id: "projection-test:verified",
            type: "service",
            provider: "projection-test",
            description: "verified capability",
            requirements: ["verified"],
            provides: ["verified"],
            permissions: ["network"],
            available: true,
            state: "verified_available",
            observedAt: "2026-09-23T19:00:00.000Z",
            authority: "projection-test-probe",
            evidence: ["functional probe succeeded"],
          },
        ],
        evidence: ["provider observed"],
        constraints: [],
        observedAt: "2026-09-23T19:00:00.000Z",
      }),
    });

    const tool = createEnvironmentTools(registry).find(
      (candidate) => candidate.name === "environment_capabilities",
    );
    expect(tool).toBeDefined();

    const projected = JSON.parse(await tool!.execute({}, {} as any));
    const capabilities = projected[0].capabilities;
    expect(capabilities[0]).toMatchObject({
      id: "projection-test:legacy",
      available: true,
      state: "discovered_unverified",
      provides: ["legacy"],
      authority: null,
      evidence: [],
    });
    expect(capabilities[1]).toMatchObject({
      id: "projection-test:verified",
      available: true,
      state: "verified_available",
      authority: "projection-test-probe",
      provides: ["verified"],
      permissions: ["network"],
      evidence: ["functional probe succeeded"],
    });
  });
});
