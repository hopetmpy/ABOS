import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getHomeDir } from "../platform/home.js";
import { RUNTIME_ROOT } from "../runtime-root.js";
import { isSensitiveFile } from "../agent/policy-rules/path-protection.js";
import {
  scopeExecutionContinuationContext,
  type ContinuationArtifact,
  type ContinuationEpistemicState,
  type ContinuationIntegrity,
  type ExecutionContinuationContext,
} from "./continuity.js";
import type { TaskNode } from "../orchestration/task-graph.js";

export const ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_CONTINUATION_ARTIFACT_DIR =
  ".abos-continuation-artifacts";

export interface ArtifactMaterializationSource {
  reference: string;
  localPath: string;
  targetName: string;
  bytes: number;
  integrity: ContinuationIntegrity;
  metadata?: Record<string, unknown>;
}

export interface ArtifactMaterializationRequest {
  protocolVersion: typeof ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION;
  goalId: string;
  taskId: string;
  pathId: string | null;
  sources: ArtifactMaterializationSource[];
  metadata?: Record<string, unknown>;
}

export interface ArtifactMaterializationEntryResult {
  reference: string;
  state: ContinuationEpistemicState;
  targetPath?: string | null;
  integrity?: ContinuationIntegrity | null;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface ArtifactMaterializationResult {
  protocolVersion: typeof ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION;
  entries: ArtifactMaterializationEntryResult[];
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface ArtifactTransferManifestEntry {
  reference: string;
  sourcePath: string;
  targetPath: string | null;
  bytes: number;
  state: ContinuationEpistemicState;
  sourceIntegrity: ContinuationIntegrity;
  targetIntegrity: ContinuationIntegrity | null;
  evidence: string[];
  metadata?: Record<string, unknown>;
}

export interface ArtifactTransferManifest {
  protocolVersion: typeof ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION;
  goalId: string;
  taskId: string;
  pathId: string | null;
  environmentId: string;
  targetAddress: string;
  createdAt: string;
  entries: ArtifactTransferManifestEntry[];
  evidence: string[];
  metadata?: Record<string, unknown>;
}

export interface ParentArtifactResolutionOptions {
  allowedRoots?: string[];
}

export interface PreparedArtifactMaterialization {
  request: ArtifactMaterializationRequest;
  continuationContext: ExecutionContinuationContext;
  evidence: string[];
}

/**
 * Resolve parent-host files already represented by the derived continuation.
 *
 * This is deliberately conservative about local filesystem authority:
 * only files physically observed inside known ABOS runtime/workspace roots are
 * exposed for transfer, and sensitive-file protection is reused. Unknown URI
 * schemes remain in the continuation unchanged for future resolvers.
 */
export function prepareArtifactMaterialization(
  task: TaskNode,
  context: ExecutionContinuationContext,
  options: ParentArtifactResolutionOptions = {},
): PreparedArtifactMaterialization {
  validateContextIdentity(task, context);

  const continuationContext = scopeExecutionContinuationContext(
    context,
    context.identity.pathId,
  );
  const roots = normalizeAllowedRoots(
    options.allowedRoots ?? defaultArtifactSourceRoots(),
  );
  const sources: ArtifactMaterializationSource[] = [];
  const evidence: string[] = [];
  const seen = new Set<string>();

  for (const artifact of continuationContext.artifacts) {
    const candidate = artifactSourceCandidate(artifact);
    if (!candidate) {
      continue;
    }

    const resolved = resolveObservedFile(candidate, roots);
    if (!resolved.ok) {
      if (artifact.state === "available") {
        markArtifactPending(
          continuationContext,
          artifact.reference,
          resolved.reason,
        );
      }
      evidence.push(
        `Artifact "${artifact.reference}" not prepared for transfer: ${resolved.reason}`,
      );
      continue;
    }

    if (seen.has(resolved.realPath)) {
      continue;
    }
    seen.add(resolved.realPath);

    const stat = fs.statSync(resolved.realPath);
    const integrity = sha256File(resolved.realPath);
    const targetName = safeTargetName(
      path.basename(resolved.realPath),
      integrity.digest,
    );

    const current = continuationContext.artifacts.find(
      (entry) => entry.reference === artifact.reference,
    );
    if (current) {
      current.state = "available";
      current.materializedPath = resolved.realPath;
      current.integrity = integrity;
      current.metadata = {
        ...(current.metadata ?? {}),
        parentObservedBytes: stat.size,
        parentObservedAt: new Date().toISOString(),
      };
    }

    sources.push({
      reference: artifact.reference,
      localPath: resolved.realPath,
      targetName,
      bytes: stat.size,
      integrity,
      metadata: {
        sourceRoot: resolved.root,
      },
    });
    evidence.push(
      `Prepared parent artifact "${artifact.reference}" bytes=${stat.size} sha256=${integrity.digest}.`,
    );
  }

  return {
    request: {
      protocolVersion: ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
      goalId: task.goalId,
      taskId: task.id,
      pathId: task.strategicPathId ?? null,
      sources,
    },
    continuationContext,
    evidence,
  };
}

/**
 * Apply a target executor's materialization observations to a delivery-specific
 * continuation view. This does not write canonical Task/artifact state.
 *
 * Integrity disagreement is never normalized into success.
 */
export function applyArtifactMaterializationResult(
  prepared: PreparedArtifactMaterialization,
  result: ArtifactMaterializationResult,
  target: {
    environmentId: string;
    address: string;
  },
): {
  continuationContext: ExecutionContinuationContext;
  manifest: ArtifactTransferManifest;
} {
  if (
    result.protocolVersion !==
    ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION
  ) {
    throw new Error(
      `Unsupported artifact materialization protocol: ${String(result.protocolVersion)}`,
    );
  }

  const context = scopeExecutionContinuationContext(
    prepared.continuationContext,
    prepared.continuationContext.identity.pathId,
  );
  const resultByReference = new Map(
    result.entries.map((entry) => [entry.reference, entry]),
  );
  const manifestEntries: ArtifactTransferManifestEntry[] = [];

  for (const source of prepared.request.sources) {
    const observation = resultByReference.get(source.reference);
    const evidence = [...(observation?.evidence ?? [])];
    let state: ContinuationEpistemicState =
      observation?.state ?? "unknown";
    let targetPath = observation?.targetPath ?? null;
    let targetIntegrity = observation?.integrity ?? null;

    if (!observation) {
      evidence.push(
        "Target executor returned no materialization observation for this artifact.",
      );
    }

    if (
      state === "available" &&
      (!targetPath || !targetIntegrity)
    ) {
      state = "unknown";
      evidence.push(
        "Target reported artifact available without both target path and integrity evidence.",
      );
    }

    if (
      state === "available" &&
      targetIntegrity &&
      !sameIntegrity(source.integrity, targetIntegrity)
    ) {
      state = "unknown";
      targetPath = null;
      evidence.push(
        `Target integrity mismatch: source=${source.integrity.algorithm}:${source.integrity.digest} target=${targetIntegrity.algorithm}:${targetIntegrity.digest}.`,
      );
    }

    const artifact = context.artifacts.find(
      (entry) => entry.reference === source.reference,
    );
    if (artifact) {
      artifact.state = state;
      artifact.materializedPath =
        state === "available" ? targetPath : null;
      artifact.integrity =
        state === "available"
          ? targetIntegrity
          : source.integrity;
      artifact.metadata = {
        ...(artifact.metadata ?? {}),
        materializationEnvironmentId: target.environmentId,
        materializationTargetAddress: target.address,
        materializationEvidence: evidence,
        ...(observation?.metadata ?? {}),
      };
    }

    if (state !== "available") {
      context.pending.push({
        kind: "artifact_materialization",
        description:
          `Artifact "${source.reference}" is not verified available on target ${target.address}: ${evidence.join(" ") || state}.`,
        state:
          state === "pending" || state === "unavailable"
            ? state
            : "unknown",
        metadata: {
          environmentId: target.environmentId,
          targetAddress: target.address,
        },
      });
    }

    manifestEntries.push({
      reference: source.reference,
      sourcePath: source.localPath,
      targetPath,
      bytes: source.bytes,
      state,
      sourceIntegrity: source.integrity,
      targetIntegrity,
      evidence,
      metadata: observation?.metadata,
    });
  }

  const manifest: ArtifactTransferManifest = {
    protocolVersion: ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
    goalId: prepared.request.goalId,
    taskId: prepared.request.taskId,
    pathId: prepared.request.pathId,
    environmentId: target.environmentId,
    targetAddress: target.address,
    createdAt: new Date().toISOString(),
    entries: manifestEntries,
    evidence: [
      ...prepared.evidence,
      ...(result.evidence ?? []),
    ],
    metadata: result.metadata,
  };

  context.extensions = {
    ...context.extensions,
    "artifact-materialization": manifest,
  };

  return {
    continuationContext: context,
    manifest,
  };
}

export function artifactTargetRelativePath(
  request: Pick<
    ArtifactMaterializationRequest,
    "goalId" | "taskId"
  >,
  source: ArtifactMaterializationSource,
): string {
  return path.posix.join(
    DEFAULT_CONTINUATION_ARTIFACT_DIR,
    safeSegment(request.goalId),
    safeSegment(request.taskId),
    source.targetName,
  );
}

function validateContextIdentity(
  task: TaskNode,
  context: ExecutionContinuationContext,
): void {
  const pathId = task.strategicPathId ?? null;
  if (
    context.identity.goalId !== task.goalId ||
    context.identity.taskId !== task.id ||
    context.identity.pathId !== pathId
  ) {
    throw new Error(
      `Artifact materialization identity mismatch: task=${task.goalId}/${task.id}/${pathId ?? "unbound"} context=${context.identity.goalId}/${context.identity.taskId}/${context.identity.pathId ?? "unbound"}.`,
    );
  }
}

function defaultArtifactSourceRoots(): string[] {
  return [
    RUNTIME_ROOT,
    path.join(getHomeDir(), ".abos", "workspace"),
  ];
}

function normalizeAllowedRoots(roots: string[]): string[] {
  return [...new Set(
    roots
      .map((root) => path.resolve(root))
      .filter(Boolean),
  )];
}

function artifactSourceCandidate(
  artifact: ContinuationArtifact,
): string | null {
  if (
    typeof artifact.materializedPath === "string" &&
    artifact.materializedPath.trim()
  ) {
    return artifact.materializedPath.trim();
  }

  const reference = artifact.reference.trim();
  if (!reference || /^[a-z][a-z0-9+.-]*:\/\//i.test(reference)) {
    return null;
  }

  return path.isAbsolute(reference)
    ? reference
    : path.resolve(RUNTIME_ROOT, reference);
}

function resolveObservedFile(
  candidate: string,
  roots: string[],
):
  | { ok: true; realPath: string; root: string }
  | { ok: false; reason: string } {
  let realPath: string;
  try {
    if (!fs.existsSync(candidate)) {
      return {
        ok: false,
        reason: "parent file was not observed",
      };
    }
    realPath = fs.realpathSync(candidate);
    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
      return {
        ok: false,
        reason: "parent artifact reference is not a regular file",
      };
    }
  } catch (error) {
    return {
      ok: false,
      reason:
        `parent file observation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (isSensitiveFile(realPath)) {
    return {
      ok: false,
      reason: "artifact resolves to a protected sensitive file",
    };
  }

  const root = roots.find((entry) => isWithinRoot(realPath, entry));
  if (!root) {
    return {
      ok: false,
      reason:
        "artifact is outside the current ABOS runtime/workspace transfer roots",
    };
  }

  return { ok: true, realPath, root };
}

function isWithinRoot(candidate: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot + path.sep)
  );
}

function markArtifactPending(
  context: ExecutionContinuationContext,
  reference: string,
  reason: string,
): void {
  const artifact = context.artifacts.find(
    (entry) => entry.reference === reference,
  );
  if (artifact) {
    artifact.state = "unknown";
    artifact.materializedPath = null;
  }
  context.pending.push({
    kind: "artifact_materialization",
    description:
      `Artifact "${reference}" cannot currently be resolved as a transferable parent-host file: ${reason}.`,
    state: "unknown",
  });
}

function sha256File(filePath: string): ContinuationIntegrity {
  const hash = createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }

  return {
    algorithm: "sha256",
    digest: hash.digest("hex"),
  };
}

function sameIntegrity(
  expected: ContinuationIntegrity,
  observed: ContinuationIntegrity,
): boolean {
  return (
    expected.algorithm.toLowerCase() ===
      observed.algorithm.toLowerCase() &&
    expected.digest.toLowerCase() ===
      observed.digest.toLowerCase()
  );
}

function safeTargetName(
  basename: string,
  digest: string,
): string {
  const safe = basename
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "artifact";
  return `${digest.slice(0, 16)}-${safe}`;
}

function safeSegment(value: string): string {
  const safe = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return safe || "unbound";
}
