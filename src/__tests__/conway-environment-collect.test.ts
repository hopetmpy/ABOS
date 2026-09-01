import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConwayEnvironmentProvider,
} from "../environments/conway.js";
import type { EnvironmentResource } from "../environments/types.js";
import { getHomeDir } from "../platform/home.js";

function resource(
  goalId: string,
  overrides: Partial<EnvironmentResource> = {},
): EnvironmentResource {
  return {
    id: "resource-conway-collect-1",
    provider: "conway",
    externalId: "sandbox-1",
    type: "conway-sandbox",
    goalId,
    pathId: "path-1",
    taskId: "task-1",
    status: "running",
    region: null,
    capabilities: ["remote compute"],
    estimatedCostCents: null,
    actualCostCents: 0,
    credentialsReference: null,
    retentionPolicy: "until_goal_complete",
    providerState: "running",
    evidence: [],
    metadata: {
      remoteArtifacts: ["outputs/result.bin"],
      artifactCollectionState: "pending",
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lastHealthCheck: null,
    ...overrides,
  };
}

describe("ConwayEnvironmentProvider collect", () => {
  const cleanup: string[] = [];

  afterEach(() => {
    for (const target of cleanup.splice(0)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("collects a child runtime artifact to the canonical parent workspace with matching SHA-256", async () => {
    const body = Buffer.from([1, 2, 3, 4, 5, 250]);
    const sha256 = createHash("sha256")
      .update(body)
      .digest("hex");
    const goalId =
      `goal-conway-collect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const goalRoot = path.join(
      getHomeDir(),
      ".abos",
      "workspace",
      goalId,
    );
    cleanup.push(goalRoot);

    const exec = vi.fn(async (command: string) => {
      if (command.includes("ABOS_ARTIFACT_BYTES")) {
        return {
          stdout:
            `ABOS_ARTIFACT_BYTES=${body.length}\nABOS_ARTIFACT_SHA256=${sha256}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      if (command.includes("dd if=")) {
        return {
          stdout: body.toString("base64"),
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const provider = new ConwayEnvironmentProvider({
      getCreditsBalance: async () => 100,
      createScopedClient: vi.fn(() => ({ exec })),
    });

    expect(provider.collect).toBeTypeOf("function");
    const result = await provider.collect!(
      resource(goalId),
    );

    expect(result.artifacts).toHaveLength(1);
    expect(result.metadata?.artifactCollectionState).toBe(
      "collected",
    );
    expect(result.metadata?.remoteArtifacts).toEqual([]);
    expect(
      fs.readFileSync(result.artifacts[0]!),
    ).toEqual(body);
    expect(
      JSON.stringify(result.metadata?.collectedArtifacts),
    ).toContain(sha256);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("preserves a remote artifact as pending when collected bytes do not match provider hash evidence", async () => {
    const body = Buffer.from("actual");
    const claimedHash = createHash("sha256")
      .update("claimed-other-bytes")
      .digest("hex");
    const goalId =
      `goal-conway-pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const goalRoot = path.join(
      getHomeDir(),
      ".abos",
      "workspace",
      goalId,
    );
    cleanup.push(goalRoot);

    const provider = new ConwayEnvironmentProvider({
      getCreditsBalance: async () => 100,
      createScopedClient: () => ({
        exec: async (command: string) => {
          if (command.includes("ABOS_ARTIFACT_BYTES")) {
            return {
              stdout:
                `ABOS_ARTIFACT_BYTES=${body.length}\nABOS_ARTIFACT_SHA256=${claimedHash}\n`,
              stderr: "",
              exitCode: 0,
            };
          }
          return {
            stdout: body.toString("base64"),
            stderr: "",
            exitCode: 0,
          };
        },
      }),
    });

    const result = await provider.collect!(
      resource(goalId),
    );

    expect(result.artifacts).toEqual([]);
    expect(result.metadata?.artifactCollectionState).toBe(
      "pending",
    );
    expect(result.metadata?.remoteArtifacts).toEqual([
      "outputs/result.bin",
    ]);
    expect(result.evidence?.join(" ")).toMatch(
      /integrity mismatch/i,
    );
  });
});
