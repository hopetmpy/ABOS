import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
  applyArtifactMaterializationResult,
  prepareArtifactMaterialization,
} from "../environments/artifact-materialization.js";
import {
  EXECUTION_CONTINUATION_PROTOCOL_VERSION,
  type ExecutionContinuationContext,
} from "../environments/continuity.js";
import type { TaskNode } from "../orchestration/task-graph.js";

function task(): TaskNode {
  return {
    id: "task-materialize-1",
    parentId: null,
    goalId: "goal-materialize-1",
    title: "Continue with artifact",
    description: "Resume work using a verified artifact.",
    status: "assigned",
    assignedTo: "target://worker",
    agentRole: "generalist",
    priority: 50,
    dependencies: [],
    result: null,
    requiredCapabilities: ["filesystem"],
    preferredEnvironment: "future-target",
    strategicPathId: "path-materialize-1",
    metadata: {
      estimatedCostCents: 0,
      actualCostCents: 0,
      maxRetries: 0,
      retryCount: 0,
      timeoutMs: 60_000,
      createdAt: new Date(0).toISOString(),
      startedAt: null,
      completedAt: null,
    },
  };
}

function context(reference: string): ExecutionContinuationContext {
  const input = task();
  return {
    protocolVersion: EXECUTION_CONTINUATION_PROTOCOL_VERSION,
    assembledAt: new Date(0).toISOString(),
    identity: {
      goalId: input.goalId,
      taskId: input.id,
      pathId: input.strategicPathId ?? null,
    },
    goal: {
      title: "Materialization goal",
      description: "Continue work across environments.",
      status: "active",
      strategy: "Reuse verified work.",
    },
    task: {
      title: input.title,
      description: input.description,
      status: input.status,
      result: null,
    },
    path: {
      id: "path-materialize-1",
      status: "executing",
      hypothesis: "The verified artifact can be reused.",
      strategy: "Continue using the artifact.",
      assumptions: [],
      requiredCapabilities: ["filesystem"],
      environment: "future-target",
      executor: null,
      sequence: ["materialize", "continue"],
      expectedOutcome: "Task resumes.",
      evidence: [],
    },
    history: {
      failures: [],
      decisions: [],
      evidence: [],
    },
    memory: [],
    artifacts: [{
      reference,
      state: "available",
      materializedPath: reference,
    }],
    pending: [],
    checkpoint: null,
    sources: [{
      authority: "task_graph",
      recordId: input.id,
    }],
    extensions: {},
  };
}

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("parent -> target artifact materialization contract", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prepares a parent-observed file with bytes and SHA-256 evidence", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abos-artifact-root-"));
    dirs.push(root);
    const file = path.join(root, "partial.bin");
    fs.writeFileSync(file, "verified payload", { mode: 0o600 });

    const prepared = prepareArtifactMaterialization(
      task(),
      context(file),
      { allowedRoots: [root] },
    );

    expect(prepared.request.sources).toHaveLength(1);
    expect(prepared.request.sources[0]).toMatchObject({
      reference: file,
      localPath: file,
      bytes: Buffer.byteLength("verified payload"),
      integrity: {
        algorithm: "sha256",
        digest: digest("verified payload"),
      },
    });
    expect(
      prepared.continuationContext.artifacts[0]?.integrity?.digest,
    ).toBe(digest("verified payload"));
  });

  it("does not expose a parent file outside the authorized transfer roots", () => {
    const allowed = fs.mkdtempSync(path.join(os.tmpdir(), "abos-allowed-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "abos-outside-"));
    dirs.push(allowed, outside);
    const file = path.join(outside, "outside.txt");
    fs.writeFileSync(file, "outside");

    const prepared = prepareArtifactMaterialization(
      task(),
      context(file),
      { allowedRoots: [allowed] },
    );

    expect(prepared.request.sources).toEqual([]);
    expect(prepared.continuationContext.artifacts[0]?.state).toBe("unknown");
    expect(prepared.continuationContext.pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "artifact_materialization",
          state: "unknown",
        }),
      ]),
    );
  });

  it("marks target availability unknown when target integrity disagrees with the parent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abos-artifact-root-"));
    dirs.push(root);
    const file = path.join(root, "artifact.txt");
    fs.writeFileSync(file, "source");

    const prepared = prepareArtifactMaterialization(
      task(),
      context(file),
      { allowedRoots: [root] },
    );

    const applied = applyArtifactMaterializationResult(
      prepared,
      {
        protocolVersion: ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
        entries: [{
          reference: file,
          state: "available",
          targetPath: "/remote/artifact.txt",
          integrity: {
            algorithm: "sha256",
            digest: digest("different"),
          },
          evidence: ["Target reported a different digest."],
        }],
      },
      {
        environmentId: "future-target",
        address: "future://worker",
      },
    );

    expect(applied.continuationContext.artifacts[0]?.state).toBe("unknown");
    expect(
      applied.continuationContext.artifacts[0]?.materializedPath,
    ).toBeNull();
    expect(applied.manifest.entries[0]?.state).toBe("unknown");
    expect(applied.manifest.entries[0]?.evidence.join(" ")).toMatch(
      /integrity mismatch/i,
    );
  });

  it("produces a delivery context and manifest only after matching target integrity", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abos-artifact-root-"));
    dirs.push(root);
    const file = path.join(root, "artifact.txt");
    fs.writeFileSync(file, "same bytes");
    const expectedDigest = digest("same bytes");

    const prepared = prepareArtifactMaterialization(
      task(),
      context(file),
      { allowedRoots: [root] },
    );

    const applied = applyArtifactMaterializationResult(
      prepared,
      {
        protocolVersion: ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
        entries: [{
          reference: file,
          state: "available",
          targetPath:
            "/opt/abos/.abos-continuation-artifacts/goal/task/artifact.txt",
          integrity: {
            algorithm: "sha256",
            digest: expectedDigest,
          },
          evidence: ["Target hash observed."],
        }],
      },
      {
        environmentId: "future-target",
        address: "future://worker",
      },
    );

    expect(applied.continuationContext.artifacts[0]).toMatchObject({
      reference: file,
      state: "available",
      materializedPath:
        "/opt/abos/.abos-continuation-artifacts/goal/task/artifact.txt",
      integrity: {
        algorithm: "sha256",
        digest: expectedDigest,
      },
    });
    expect(applied.manifest).toMatchObject({
      protocolVersion: ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
      goalId: "goal-materialize-1",
      taskId: "task-materialize-1",
      pathId: "path-materialize-1",
      environmentId: "future-target",
      targetAddress: "future://worker",
      entries: [{
        reference: file,
        state: "available",
        sourceIntegrity: {
          algorithm: "sha256",
          digest: expectedDigest,
        },
        targetIntegrity: {
          algorithm: "sha256",
          digest: expectedDigest,
        },
      }],
    });
    expect(
      applied.continuationContext.extensions["artifact-materialization"],
    ).toEqual(applied.manifest);
  });
});
