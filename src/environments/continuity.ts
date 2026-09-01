import type { TaskResult } from "../orchestration/task-graph.js";

/**
 * Provider-neutral, derived execution-continuation contract.
 *
 * This object is NOT an authority. It is assembled from canonical ABOS state
 * and may be transported to an executor so the same Task can continue with
 * verified prior knowledge instead of starting from zero.
 *
 * Provider IDs, transport IDs, artifact schemes, integrity algorithms, and
 * metadata are intentionally open strings/records.
 */
export const EXECUTION_CONTINUATION_PROTOCOL_VERSION = 1 as const;

export type ContinuationEpistemicState =
  | "available"
  | "pending"
  | "unknown"
  | "unavailable";

export interface ContinuationSourceRef {
  /** Open authority identifier, e.g. task_graph, adaptive, environment_migration. */
  authority: string;
  recordId?: string | null;
  observedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ContinuationEvidence {
  content: string;
  source?: ContinuationSourceRef;
  metadata?: Record<string, unknown>;
}

export interface ContinuationFailure {
  pathId?: string | null;
  environmentId?: string | null;
  stage?: string | null;
  classification?: string | null;
  reason: string;
  evidence: ContinuationEvidence[];
  createdAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ContinuationDecision {
  decision: string;
  rationale?: string | null;
  pathId?: string | null;
  createdAt?: string | null;
  source?: ContinuationSourceRef;
  metadata?: Record<string, unknown>;
}

export interface ContinuationMemoryItem {
  content: string;
  kind?: string | null;
  relevance?: number | null;
  source?: ContinuationSourceRef;
  metadata?: Record<string, unknown>;
}

export interface ContinuationIntegrity {
  /** Open algorithm identifier. No global algorithm allowlist is implied. */
  algorithm: string;
  digest: string;
  metadata?: Record<string, unknown>;
}

export interface ContinuationArtifact {
  /**
   * Opaque provider-neutral reference. It may be a local path, URI, provider
   * reference, object-store URL, or another future scheme.
   */
  reference: string;
  state: ContinuationEpistemicState;
  materializedPath?: string | null;
  integrity?: ContinuationIntegrity | null;
  source?: ContinuationSourceRef;
  metadata?: Record<string, unknown>;
}

export interface ContinuationCheckpoint {
  /**
   * Checkpoints are executable-state hints scoped to exactly one strategic
   * Path. They must never be blindly reused after a Path change.
   */
  pathId: string;
  state: Record<string, unknown>;
  createdAt?: string | null;
  source?: ContinuationSourceRef;
  metadata?: Record<string, unknown>;
}

export interface ContinuationPendingItem {
  kind: string;
  description: string;
  state: Extract<ContinuationEpistemicState, "pending" | "unknown" | "unavailable">;
  source?: ContinuationSourceRef;
  metadata?: Record<string, unknown>;
}

export interface ContinuationPathView {
  id: string;
  status: string;
  hypothesis: string;
  strategy: string;
  assumptions: string[];
  requiredCapabilities: string[];
  environment?: string | null;
  executor?: string | null;
  sequence: string[];
  expectedOutcome: string;
  evidence: string[];
  metadata?: Record<string, unknown>;
}

export interface ExecutionContinuationContext {
  protocolVersion: typeof EXECUTION_CONTINUATION_PROTOCOL_VERSION;
  assembledAt: string;

  identity: {
    goalId: string;
    taskId: string;
    /**
     * Current strategic Path for the target attempt. Null means no Path is
     * currently bound; it does not mean the Task has no history.
     */
    pathId: string | null;
  };

  goal: {
    title: string;
    description: string;
    status: string;
    strategy: string | null;
    metadata?: Record<string, unknown>;
  };

  task: {
    title: string;
    description: string;
    status: string;
    result: TaskResult | null;
    metadata?: Record<string, unknown>;
  };

  /** Current target Path view, derived from Adaptive. */
  path: ContinuationPathView | null;

  history: {
    failures: ContinuationFailure[];
    decisions: ContinuationDecision[];
    evidence: ContinuationEvidence[];
  };

  memory: ContinuationMemoryItem[];
  artifacts: ContinuationArtifact[];
  pending: ContinuationPendingItem[];

  /**
   * Executable state that is safe only for its exact strategic Path.
   * Durable history belongs above and survives Path changes.
   */
  checkpoint: ContinuationCheckpoint | null;

  /** Records consulted while assembling this derived view. */
  sources: ContinuationSourceRef[];

  /**
   * Open extension point for future providers/capabilities/transports without
   * changing the core contract or introducing central allowlists.
   */
  extensions: Record<string, unknown>;
}

/**
 * Apply the core Path-scoping invariant before delivery to an executor.
 *
 * Same Path: a matching checkpoint may survive.
 * Different Path: durable knowledge survives, but old executable state is
 * removed. The input context is never mutated.
 */
export function scopeExecutionContinuationContext(
  context: ExecutionContinuationContext,
  targetPathId: string | null,
): ExecutionContinuationContext {
  const samePath = context.identity.pathId === targetPathId;
  const checkpoint =
    samePath && context.checkpoint?.pathId === targetPathId
      ? cloneCheckpoint(context.checkpoint)
      : null;

  return {
    ...context,
    identity: {
      ...context.identity,
      pathId: targetPathId,
    },
    goal: {
      ...context.goal,
      metadata: cloneRecord(context.goal.metadata),
    },
    task: {
      ...context.task,
      result: context.task.result
        ? {
            ...context.task.result,
            artifacts: [...context.task.result.artifacts],
          }
        : null,
      metadata: cloneRecord(context.task.metadata),
    },
    path: context.path
      ? {
          ...context.path,
          assumptions: [...context.path.assumptions],
          requiredCapabilities: [...context.path.requiredCapabilities],
          sequence: [...context.path.sequence],
          evidence: [...context.path.evidence],
          metadata: cloneRecord(context.path.metadata),
        }
      : null,
    history: {
      failures: context.history.failures.map(cloneFailure),
      decisions: context.history.decisions.map(cloneDecision),
      evidence: context.history.evidence.map(cloneEvidence),
    },
    memory: context.memory.map(cloneMemory),
    artifacts: context.artifacts.map(cloneArtifact),
    pending: context.pending.map(clonePending),
    checkpoint,
    sources: context.sources.map((source) => ({
      ...source,
      metadata: cloneRecord(source.metadata),
    })),
    extensions: { ...context.extensions },
  };
}

function cloneSource(
  source: ContinuationSourceRef | undefined,
): ContinuationSourceRef | undefined {
  if (!source) return undefined;
  return {
    ...source,
    metadata: cloneRecord(source.metadata),
  };
}

function cloneEvidence(evidence: ContinuationEvidence): ContinuationEvidence {
  return {
    ...evidence,
    source: cloneSource(evidence.source),
    metadata: cloneRecord(evidence.metadata),
  };
}

function cloneFailure(failure: ContinuationFailure): ContinuationFailure {
  return {
    ...failure,
    evidence: failure.evidence.map(cloneEvidence),
    metadata: cloneRecord(failure.metadata),
  };
}

function cloneDecision(decision: ContinuationDecision): ContinuationDecision {
  return {
    ...decision,
    source: cloneSource(decision.source),
    metadata: cloneRecord(decision.metadata),
  };
}

function cloneMemory(memory: ContinuationMemoryItem): ContinuationMemoryItem {
  return {
    ...memory,
    source: cloneSource(memory.source),
    metadata: cloneRecord(memory.metadata),
  };
}

function cloneArtifact(artifact: ContinuationArtifact): ContinuationArtifact {
  return {
    ...artifact,
    integrity: artifact.integrity
      ? {
          ...artifact.integrity,
          metadata: cloneRecord(artifact.integrity.metadata),
        }
      : artifact.integrity,
    source: cloneSource(artifact.source),
    metadata: cloneRecord(artifact.metadata),
  };
}

function cloneCheckpoint(
  checkpoint: ContinuationCheckpoint,
): ContinuationCheckpoint {
  return {
    ...checkpoint,
    state: { ...checkpoint.state },
    source: cloneSource(checkpoint.source),
    metadata: cloneRecord(checkpoint.metadata),
  };
}

function clonePending(pending: ContinuationPendingItem): ContinuationPendingItem {
  return {
    ...pending,
    source: cloneSource(pending.source),
    metadata: cloneRecord(pending.metadata),
  };
}

function cloneRecord(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return value ? { ...value } : undefined;
}
