import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  materializeArtifactsToConwaySandbox,
} from "../environments/conway-artifact-materializer.js";
import type { ConwayClient } from "../types.js";

describe("Conway artifact materializer", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes parent bytes into the child sandbox and verifies target SHA-256", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "abos-conway-materialize-"),
    );
    dirs.push(dir);
    const sourcePath = path.join(dir, "input.bin");
    const body = Buffer.from([10, 20, 30, 40, 250]);
    fs.writeFileSync(sourcePath, body);
    const sha256 = createHash("sha256")
      .update(body)
      .digest("hex");

    const writes: Array<{ path: string; content: string }> = [];
    const commands: string[] = [];
    const scoped = {
      exec: vi.fn(async (command: string) => {
        commands.push(command);
        if (command.includes("ABOS_MATERIALIZED_BYTES")) {
          return {
            stdout:
              `ABOS_MATERIALIZED_BYTES=${body.length}\nABOS_MATERIALIZED_SHA256=${sha256}\n`,
            stderr: "",
            exitCode: 0,
          };
        }
        return {
          stdout: "",
          stderr: "",
          exitCode: 0,
        };
      }),
      writeFile: vi.fn(async (targetPath: string, content: string) => {
        writes.push({ path: targetPath, content });
      }),
    };

    const conway = {
      createScopedClient: vi.fn(() => scoped),
    } as unknown as ConwayClient;

    const result = await materializeArtifactsToConwaySandbox(
      conway,
      "sandbox-child-1",
      {
        protocolVersion: 1,
        goalId: "goal-1",
        taskId: "task-1",
        pathId: "path-1",
        sources: [{
          reference: "artifact-1",
          localPath: sourcePath,
          targetName: `${sha256.slice(0, 16)}-input.bin`,
          bytes: body.length,
          integrity: {
            algorithm: "sha256",
            digest: sha256,
          },
        }],
      },
    );

    expect(conway.createScopedClient).toHaveBeenCalledWith(
      "sandbox-child-1",
    );
    expect(writes).toHaveLength(1);
    expect(
      Buffer.from(writes[0]!.content, "base64"),
    ).toEqual(body);
    expect(writes[0]?.path).toMatch(
      /^\/root\/abos\/\.abos-continuation-artifacts\/goal-1\/task-1\//,
    );
    expect(commands.some((command) =>
      command.includes("sha256sum")
    )).toBe(true);
    expect(result.entries[0]).toMatchObject({
      reference: "artifact-1",
      state: "available",
      integrity: {
        algorithm: "sha256",
        digest: sha256,
      },
    });
    expect(result.metadata?.transport).toBe(
      "conway_sandbox_file_api",
    );
  });

  it("never reports available when the sandbox returns a different digest", async () => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "abos-conway-materialize-"),
    );
    dirs.push(dir);
    const sourcePath = path.join(dir, "input.txt");
    const body = Buffer.from("expected");
    fs.writeFileSync(sourcePath, body);
    const sha256 = createHash("sha256")
      .update(body)
      .digest("hex");
    const wrong = createHash("sha256")
      .update("different")
      .digest("hex");

    const scoped = {
      exec: vi.fn(async (command: string) => ({
        stdout: command.includes("ABOS_MATERIALIZED_BYTES")
          ? `ABOS_MATERIALIZED_BYTES=${body.length}\nABOS_MATERIALIZED_SHA256=${wrong}\n`
          : "",
        stderr: "",
        exitCode: 0,
      })),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };
    const conway = {
      createScopedClient: vi.fn(() => scoped),
    } as unknown as ConwayClient;

    const result = await materializeArtifactsToConwaySandbox(
      conway,
      "sandbox-child-1",
      {
        protocolVersion: 1,
        goalId: "goal-1",
        taskId: "task-1",
        pathId: null,
        sources: [{
          reference: "artifact-1",
          localPath: sourcePath,
          targetName: "artifact.txt",
          bytes: body.length,
          integrity: {
            algorithm: "sha256",
            digest: sha256,
          },
        }],
      },
    );

    expect(result.entries[0]?.state).toBe("unknown");
    expect(result.entries[0]?.targetPath).toBeNull();
    expect(result.entries[0]?.evidence?.join(" ")).toMatch(
      /verification mismatch/i,
    );
  });
});
