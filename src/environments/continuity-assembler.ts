import type { Database } from "better-sqlite3";
import { AdaptiveStore } from "../intelligence/store.js";
import { EventStream } from "../memory/event-stream.js";
import type { TaskResult } from "../orchestration/task-graph.js";
import {
  getGoalById,
  getTaskById,
} from "../state/database.js";
import {
  EnvironmentMigrationStore,
  type EnvironmentMigrationRecord,
} from "./mobility-store.js";
import {
  EnvironmentResourceStore,
} from "./resource-store.js";
import type { EnvironmentResource } from "./types.js";
import {
  EXECUTION_CONTINUATION_PROTOCOL_VERSION,
  scopeExecutionContinuationContext,
  type ContinuationArtifact,
  type ContinuationCheckpoint,
  type ContinuationDecision,
  type ContinuationEvidence,
  type ContinuationFailure,
  type ContinuationMemoryItem,
  type ContinuationPathView,
  type ContinuationPendingItem,
  type ContinuationSourceRef,
  type ExecutionContinuationContext,
} from "./continuity.js";

export interface ContinuityAssemblyOptions {
  /**
   * Explicit target Path for the next attempt. Undefined means use the current
   * Adaptive Task binding. Null means deliberately continue without a bound Path.
   */
  targetPathId?: string | null;
}

export interface ContinuityContributionInput {
  goalId: string;
  taskId: string;
  pathId: string | null;
  goalTitle: string;
  taskTitle: string;
  taskDescription: string;
}

export interface ContinuityContribution {
  memory?: ContinuationMemoryItem[];
  decisions?: ContinuationDecision[];
  artifacts?: ContinuationArtifact[];
  evidence?: ContinuationEvidence[];
  pending?: ContinuationPendingItem[];
  sources?: ContinuationSourceRef[];
  extensions?: Record<string, unknown>;
}

/**
 * Optional read-only extension point for additional canonical knowledge surfaces
 * (for example a future Task-linked memory or workspace reader).
 *
 * Contributors do not own the continuation context and cannot overwrite core
 * identity/Task/Path state.
 */
export interface ContinuityContributor {
  readonly id: string;
  contribute(input: ContinuityContributionInput): ContinuityContribution;
}

export interface ContinuityCheckpointReader {
  readonly id: string;
  readCheckpoint(
    input: ContinuityContributionInput,
  ): ContinuationCheckpoint | null;
}

export interface ContinuityAssemblerDependencies {
  adaptive?: AdaptiveStore;
  migrations?: EnvironmentMigrationStore;
  resources?: EnvironmentResourceStore;
  events?: EventStream;
  contributors?: ContinuityContributor[];
  checkpointReader?: ContinuityCheckpointReader;
}

/**
 * Read-only composer over existing ABOS authorities.
 *
 * It creates no tables, owns no lifecycle, selects no provider, provisions
 * nothing, and writes no Task/Path/migration/resource/memory state.
 */
export class ContinuityAssembler {
  private readonly adaptive: AdaptiveStore;
  private readonly migrations: EnvironmentMigrationStore;
  private readonly resources: EnvironmentResourceStore;
  private readonly events: EventStream;
  private readonly contributors: ContinuityContributor[];
  private readonly checkpointReader?: ContinuityCheckpointReader;

  constructor(
    private readonly db: Database,
    dependencies: ContinuityAssemblerDependencies = {},
  ) {
    this.adaptive = dependencies.adaptive ?? new AdaptiveStore(db);
    this.migrations =
      dependencies.migrations ?? new EnvironmentMigrationStore(db);
    this.resources =
      dependencies.resources ?? new EnvironmentResourceStore(db);
    this.events = dependencies.events ?? new EventStream(db);
    this.contributors = [...(dependencies.contributors ?? [])];
    this.checkpointReader = dependencies.checkpointReader;
  }

  assemble(
    taskId: string,
    options: ContinuityAssemblyOptions = {},
  ): ExecutionContinuationContext {
    const task = getTaskById(this.db, taskId);
    if (!task) {
      throw new Error(`Cannot assemble continuity: Task not found: ${taskId}`);
    }

    const goal = getGoalById(this.db, task.goalId);
    if (!goal) {
      throw new Error(
        `Cannot assemble continuity: canonical Goal not found for Task ${taskId}: ${task.goalId}`,
      );
    }

    const binding = this.adaptive.getTaskBinding(task.id);
    const targetPathId =
      options.targetPathId !== undefined
        ? options.targetPathId
        : binding?.pathId ?? null;

    const pending: ContinuationPendingItem[] = [];
    const result = parseTaskResult(task.result);
    if (task.result != null && !result) {
      pending.push({
        kind: "task_result",
        description:
          "TaskGraph contains a result that cannot be verified as the canonical TaskResult shape.",
        state: "unknown",
        source: source("task_graph", task.id, task.completedAt),
      });
    }

    const persistedPath =
      targetPathId == null ? undefined : this.adaptive.getPath(targetPathId);
    const path = toPathView(
      persistedPath,
      task.goalId,
      task.id,
      targetPathId,
      pending,
    );

    const attempts = this.adaptive
      .listAttempts(goal.id, Number.MAX_SAFE_INTEGER)
      .filter((attempt) => attempt.taskId === task.id);
    const attemptIds = new Set(attempts.map((attempt) => attempt.id));
    const attemptedPathIds = new Set(attempts.map((attempt) => attempt.pathId));
    if (targetPathId) attemptedPathIds.add(targetPathId);

    const adaptiveEvidence = this.adaptive
      .listEvidence(goal.id, { limit: 500 })
      .filter((entry) =>
        (entry.attemptId != null && attemptIds.has(entry.attemptId)) ||
        (entry.pathId != null && attemptedPathIds.has(entry.pathId)) ||
        (entry.attemptId == null && entry.pathId == null)
      );

    const migrations = this.migrations.list({ taskId: task.id });
    const taskResources = this.resources.list({
      taskId: task.id,
      includeTerminated: true,
    });
    const resources = includeMigrationResources(
      taskResources,
      migrations,
      this.resources,
    );

    const failures: ContinuationFailure[] = attempts
      .filter((attempt) =>
        !["success", "partial_success"].includes(attempt.outcome)
      )
      .map((attempt) => ({
        pathId: attempt.pathId,
        environmentId: null,
        stage: null,
        classification: attempt.failureClass ?? null,
        reason:
          attempt.failureReason ??
          `Adaptive attempt ended with outcome=${attempt.outcome}.`,
        evidence: attempt.evidence.map((content) => ({
          content,
          source: source("adaptive_attempts", attempt.id, attempt.createdAt),
        })),
        createdAt: attempt.createdAt,
        metadata: {
          outcome: attempt.outcome,
          conditionFingerprint: attempt.conditionFingerprint,
          noveltyScore: attempt.noveltyScore,
          retryEligible: attempt.retryEligible,
        },
      }));

    const evidence: ContinuationEvidence[] = [];

    for (const entry of adaptiveEvidence) {
      evidence.push({
        content: entry.content,
        source: source("adaptive_evidence", entry.id, entry.createdAt, {
          pathId: entry.pathId,
          attemptId: entry.attemptId,
          kind: entry.kind,
          confidence: entry.confidence,
          originalSource: entry.source,
        }),
      });
    }

    for (const migration of migrations) {
      for (const item of migration.evidence) {
        evidence.push({
          content: item,
          source: source(
            "environment_migrations",
            migration.id,
            migration.updatedAt,
          ),
        });
      }
      for (const event of this.migrations.listEvents(migration.id)) {
        if (event.reason) {
          evidence.push({
            content: event.reason,
            source: source(
              "environment_migration_events",
              event.id,
              event.createdAt,
              { operation: event.operation },
            ),
          });
        }
        for (const item of event.evidence) {
          evidence.push({
            content: item,
            source: source(
              "environment_migration_events",
              event.id,
              event.createdAt,
              { operation: event.operation },
            ),
          });
        }
      }
    }

    for (const resource of resources) {
      for (const item of resource.evidence) {
        evidence.push({
          content: item,
          source: source(
            "environment_resources",
            resource.id,
            resource.updatedAt,
            { provider: resource.provider, status: resource.status },
          ),
        });
      }
      for (const event of this.resources.listEvents(resource.id)) {
        if (event.reason) {
          evidence.push({
            content: event.reason,
            source: source(
              "environment_resource_events",
              event.id,
              event.createdAt,
              {
                provider: event.provider,
                operation: event.operation,
              },
            ),
          });
        }
        for (const item of event.evidence) {
          evidence.push({
            content: item,
            source: source(
              "environment_resource_events",
              event.id,
              event.createdAt,
              {
                provider: event.provider,
                operation: event.operation,
              },
            ),
          });
        }
      }
    }

    for (const event of this.events
      .getByGoal(goal.id)
      .filter((entry) => entry.taskId === task.id)) {
      evidence.push({
        content: event.content,
        source: source("event_stream", event.id, event.createdAt, {
          eventType: event.type,
          agentAddress: event.agentAddress,
        }),
      });
    }

    const artifacts = new Map<string, ContinuationArtifact>();
    if (result) {
      for (const reference of result.artifacts) {
        mergeArtifact(artifacts, {
          reference,
          state: "unknown",
          source: source("task_graph", task.id, task.completedAt),
        });
      }
    }

    for (const resource of resources) {
      collectResourceArtifacts(resource, artifacts, pending);
    }

    const contributionInput: ContinuityContributionInput = {
      goalId: goal.id,
      taskId: task.id,
      pathId: targetPathId,
      goalTitle: goal.title,
      taskTitle: task.title,
      taskDescription: task.description,
    };

    const memory: ContinuationMemoryItem[] = [];
    const decisions: ContinuationDecision[] = [];
    const sources: ContinuationSourceRef[] = [
      source("task_graph", task.id, task.completedAt ?? task.startedAt ?? task.createdAt),
      source("goals", goal.id, goal.completedAt ?? goal.createdAt),
    ];
    const extensions: Record<string, unknown> = {};

    if (binding) {
      sources.push(
        source("adaptive_task_bindings", binding.taskId, binding.updatedAt),
      );
    }
    if (persistedPath) {
      sources.push(
        source("adaptive_paths", persistedPath.id, persistedPath.updatedAt),
      );
    }
    for (const attempt of attempts) {
      sources.push(
        source("adaptive_attempts", attempt.id, attempt.createdAt),
      );
    }
    for (const migration of migrations) {
      sources.push(
        source("environment_migrations", migration.id, migration.updatedAt),
      );
    }
    for (const resource of resources) {
      sources.push(
        source("environment_resources", resource.id, resource.updatedAt, {
          provider: resource.provider,
        }),
      );
    }

    for (const contributor of this.contributors) {
      try {
        const contribution = contributor.contribute(contributionInput);
        memory.push(...(contribution.memory ?? []));
        decisions.push(...(contribution.decisions ?? []));
        for (const artifact of contribution.artifacts ?? []) {
          mergeArtifact(artifacts, artifact);
        }
        evidence.push(...(contribution.evidence ?? []));
        pending.push(...(contribution.pending ?? []));
        sources.push(...(contribution.sources ?? []));
        if (contribution.extensions) {
          extensions[contributor.id] = contribution.extensions;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pending.push({
          kind: "continuity_contributor",
          description:
            `Contributor "${contributor.id}" is currently unavailable: ${message}`,
          state: "unavailable",
          source: source("continuity_contributor", contributor.id, null),
        });
      }
    }

    let checkpoint: ContinuationCheckpoint | null = null;
    if (this.checkpointReader) {
      try {
        const candidate = this.checkpointReader.readCheckpoint(
          contributionInput,
        );
        if (candidate && candidate.pathId === targetPathId) {
          checkpoint = candidate;
          sources.push(
            candidate.source ??
              source(
                "continuity_checkpoint",
                this.checkpointReader.id,
                candidate.createdAt ?? null,
              ),
          );
        } else if (candidate) {
          pending.push({
            kind: "checkpoint",
            description:
              `Checkpoint reader "${this.checkpointReader.id}" returned state for Path ${candidate.pathId}, but target Path is ${targetPathId ?? "unbound"}; executable state was not reused.`,
            state: "unknown",
            source: candidate.source,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pending.push({
          kind: "checkpoint",
          description:
            `Checkpoint reader "${this.checkpointReader.id}" is currently unavailable: ${message}`,
          state: "unavailable",
          source: source(
            "continuity_checkpoint",
            this.checkpointReader.id,
            null,
          ),
        });
      }
    }

    if (targetPathId && !path) {
      pending.push({
        kind: "strategic_path",
        description:
          `Target Path ${targetPathId} could not be verified from Adaptive state.`,
        state: "unknown",
        source: source("adaptive_paths", targetPathId, null),
      });
    }

    const context: ExecutionContinuationContext = {
      protocolVersion: EXECUTION_CONTINUATION_PROTOCOL_VERSION,
      assembledAt: new Date().toISOString(),
      identity: {
        goalId: goal.id,
        taskId: task.id,
        pathId: targetPathId,
      },
      goal: {
        title: goal.title,
        description: goal.description,
        status: goal.status,
        strategy: goal.strategy,
        metadata: {
          expectedRevenueCents: goal.expectedRevenueCents,
          actualRevenueCents: goal.actualRevenueCents,
          deadline: goal.deadline,
          createdAt: goal.createdAt,
          completedAt: goal.completedAt,
        },
      },
      task: {
        title: task.title,
        description: task.description,
        status: task.status,
        result,
        metadata: {
          parentId: task.parentId,
          assignedTo: task.assignedTo,
          agentRole: task.agentRole,
          priority: task.priority,
          dependencies: [...task.dependencies],
          requiredCapabilities: [...(binding?.requiredCapabilities ?? [])],
          preferredEnvironment: binding?.preferredEnvironment ?? null,
          estimatedCostCents: task.estimatedCostCents,
          actualCostCents: task.actualCostCents,
          maxRetries: task.maxRetries,
          retryCount: task.retryCount,
          timeoutMs: task.timeoutMs,
          createdAt: task.createdAt,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
        },
      },
      path,
      history: {
        failures,
        decisions,
        evidence: dedupeEvidence(evidence),
      },
      memory,
      artifacts: [...artifacts.values()],
      pending: dedupePending(pending),
      checkpoint,
      sources: dedupeSources(sources),
      extensions,
    };

    return scopeExecutionContinuationContext(context, targetPathId);
  }
}

function toPathView(
  path: ReturnType<AdaptiveStore["getPath"]>,
  goalId: string,
  taskId: string,
  targetPathId: string | null,
  pending: ContinuationPendingItem[],
): ContinuationPathView | null {
  if (!path || targetPathId == null) return null;
  if (path.goalId !== goalId) {
    pending.push({
      kind: "strategic_path",
      description:
        `Target Path ${targetPathId} belongs to Goal ${path.goalId}, not ${goalId}.`,
      state: "unknown",
      source: source("adaptive_paths", path.id, path.updatedAt),
    });
    return null;
  }
  if (path.taskId != null && path.taskId !== taskId) {
    pending.push({
      kind: "strategic_path",
      description:
        `Target Path ${targetPathId} is bound to Task ${path.taskId}, not ${taskId}.`,
      state: "unknown",
      source: source("adaptive_paths", path.id, path.updatedAt),
    });
    return null;
  }
  return {
    id: path.id,
    status: path.status,
    hypothesis: path.hypothesis,
    strategy: path.strategy,
    assumptions: [...path.assumptions],
    requiredCapabilities: [...path.requiredCapabilities],
    environment: path.environment ?? null,
    executor: path.executor ?? null,
    sequence: [...path.sequence],
    expectedOutcome: path.expectedOutcome,
    evidence: [...(path.evidence ?? [])],
    metadata: {
      expectedCostCents: path.expectedCostCents ?? 0,
      signature: path.signature,
      createdAt: path.createdAt,
      updatedAt: path.updatedAt,
    },
  };
}

function includeMigrationResources(
  initial: EnvironmentResource[],
  migrations: EnvironmentMigrationRecord[],
  store: EnvironmentResourceStore,
): EnvironmentResource[] {
  const byId = new Map(initial.map((resource) => [resource.id, resource]));
  for (const migration of migrations) {
    for (const id of [
      migration.sourceResourceId,
      migration.targetResourceId,
    ]) {
      if (!id || byId.has(id)) continue;
      const resource = store.get(id);
      if (resource) byId.set(id, resource);
    }
  }
  return [...byId.values()];
}

function collectResourceArtifacts(
  resource: EnvironmentResource,
  artifacts: Map<string, ContinuationArtifact>,
  pending: ContinuationPendingItem[],
): void {
  const resourceSource = source(
    "environment_resources",
    resource.id,
    resource.updatedAt,
    { provider: resource.provider },
  );

  for (const reference of stringArray(resource.metadata.remoteArtifacts)) {
    mergeArtifact(artifacts, {
      reference,
      state: "pending",
      source: resourceSource,
      metadata: {
        provider: resource.provider,
        resourceId: resource.id,
        artifactHost: resource.metadata.artifactHost ?? null,
      },
    });
    pending.push({
      kind: "artifact_materialization",
      description:
        `Artifact "${reference}" remains pending on resource ${resource.id}.`,
      state: "pending",
      source: resourceSource,
    });
  }

  const collected = Array.isArray(resource.metadata.collectedArtifacts)
    ? resource.metadata.collectedArtifacts
    : [];
  for (const item of collected) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const localPath =
      typeof record.localPath === "string" ? record.localPath.trim() : "";
    if (!localPath) continue;
    mergeArtifact(artifacts, {
      reference: localPath,
      state: "available",
      materializedPath: localPath,
      source: resourceSource,
      metadata: {
        provider: resource.provider,
        resourceId: resource.id,
        remotePath:
          typeof record.remotePath === "string" ? record.remotePath : null,
        bytes:
          typeof record.bytes === "number" && Number.isFinite(record.bytes)
            ? record.bytes
            : null,
        compressedBytes:
          typeof record.compressedBytes === "number" &&
          Number.isFinite(record.compressedBytes)
            ? record.compressedBytes
            : null,
      },
    });
  }

  if (
    resource.metadata.artifactCollectionState === "pending" &&
    stringArray(resource.metadata.remoteArtifacts).length === 0
  ) {
    pending.push({
      kind: "artifact_collection",
      description:
        `Resource ${resource.id} reports pending artifact collection, but no verified remote artifact list is currently available.`,
      state: "unknown",
      source: resourceSource,
    });
  }
}

function mergeArtifact(
  target: Map<string, ContinuationArtifact>,
  incoming: ContinuationArtifact,
): void {
  const reference = incoming.reference.trim();
  if (!reference) return;

  const normalized = { ...incoming, reference };
  const existing = target.get(reference);
  if (!existing) {
    target.set(reference, normalized);
    return;
  }

  const rank = {
    unavailable: 0,
    unknown: 1,
    pending: 2,
    available: 3,
  } as const;
  const preferred =
    rank[incoming.state] > rank[existing.state] ? incoming : existing;

  target.set(reference, {
    ...existing,
    ...preferred,
    reference,
    materializedPath:
      preferred.materializedPath ?? existing.materializedPath ?? null,
    integrity: preferred.integrity ?? existing.integrity ?? null,
    metadata: {
      ...(existing.metadata ?? {}),
      ...(incoming.metadata ?? {}),
    },
  });
}

function parseTaskResult(value: unknown): TaskResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.success !== "boolean" ||
    typeof candidate.output !== "string" ||
    !Array.isArray(candidate.artifacts) ||
    !candidate.artifacts.every((entry) => typeof entry === "string") ||
    typeof candidate.costCents !== "number" ||
    !Number.isFinite(candidate.costCents) ||
    typeof candidate.duration !== "number" ||
    !Number.isFinite(candidate.duration)
  ) {
    return null;
  }
  return {
    success: candidate.success,
    output: candidate.output,
    artifacts: [...candidate.artifacts] as string[],
    costCents: candidate.costCents,
    duration: candidate.duration,
  };
}

function source(
  authority: string,
  recordId?: string | null,
  observedAt?: string | null,
  metadata?: Record<string, unknown>,
): ContinuationSourceRef {
  return {
    authority,
    recordId: recordId ?? null,
    observedAt: observedAt ?? null,
    metadata,
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dedupeEvidence(
  items: ContinuationEvidence[],
): ContinuationEvidence[] {
  const seen = new Set<string>();
  const result: ContinuationEvidence[] = [];
  for (const item of items) {
    const content = item.content.trim();
    if (!content) continue;
    const key = [
      content,
      item.source?.authority ?? "",
      item.source?.recordId ?? "",
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...item, content });
  }
  return result;
}

function dedupePending(
  items: ContinuationPendingItem[],
): ContinuationPendingItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [
      item.kind,
      item.description,
      item.state,
      item.source?.authority ?? "",
      item.source?.recordId ?? "",
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeSources(
  items: ContinuationSourceRef[],
): ContinuationSourceRef[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [
      item.authority,
      item.recordId ?? "",
      item.observedAt ?? "",
    ].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
