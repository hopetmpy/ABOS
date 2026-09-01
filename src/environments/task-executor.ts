import type { TaskNode, TaskResult } from "../orchestration/task-graph.js";
import type { EnvironmentLifecycleManager } from "./lifecycle.js";
import type { ExecutionContinuationContext } from "./continuity.js";
import {
  ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
  applyArtifactMaterializationResult,
  prepareArtifactMaterialization,
  type ArtifactMaterializationRequest,
  type ArtifactMaterializationResult,
  type ArtifactTransferManifest,
} from "./artifact-materialization.js";
import type {
  EnvironmentSelectionCandidate,
  EnvironmentSelectionResult,
  EnvironmentSelector,
} from "./selector.js";

export interface EnvironmentTaskExecutionAssessment {
  executable: boolean | null;
  evidence?: string[];
}

export interface EnvironmentTaskSpawnResult {
  address: string;
  name: string;
  sandboxId: string;
  resourceExternalId?: string;
  resourceType?: string;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentTaskTarget {
  address: string;
  name: string;
  spawned: boolean;
}

export interface EnvironmentTaskDispatchOptions {
  /**
   * Fresh derived continuation view assembled immediately before delivery.
   * Keeping this separate from target identity avoids provider-specific state.
   */
  continuationContext?: ExecutionContinuationContext;
  metadata?: Record<string, unknown>;
}

export interface EnvironmentTaskDispatchResult {
  /** Optional immediate semantic result for synchronous transports (SSM, RPC, etc.). */
  result?: TaskResult;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentTaskExecutor {
  readonly environmentId: string;
  assess?(
    task: TaskNode,
    options?: EnvironmentTaskSpawnOptions,
  ):
    | EnvironmentTaskExecutionAssessment
    | Promise<EnvironmentTaskExecutionAssessment>;
  spawn(
    task: TaskNode,
    options?: EnvironmentTaskSpawnOptions,
  ): Promise<EnvironmentTaskSpawnResult>;
  /**
   * Optional target-specific artifact transfer. This belongs to the Task
   * executor plane because the executor owns the concrete target transport.
   */
  materializeArtifacts?(
    task: TaskNode,
    target: EnvironmentTaskTarget,
    request: ArtifactMaterializationRequest,
  ): Promise<ArtifactMaterializationResult>;
  dispatch?(
    task: TaskNode,
    target: EnvironmentTaskTarget,
    options?: EnvironmentTaskDispatchOptions,
  ): Promise<EnvironmentTaskDispatchResult>;
}

export interface EnvironmentTaskSpawnOptions {
  preferredEnvironment?: string | null;
  excludedEnvironmentIds?: string[];
  /**
   * Resource-scoped exclusions preserve provider openness: a failed executor
   * does not automatically make every resource from the same provider invalid.
   */
  excludedResourceIds?: string[];
  /**
   * Derived continuation view for the same canonical Task. Executors may
   * consume it, but it does not become provider-owned state.
   */
  continuationContext?: ExecutionContinuationContext;
  metadata?: Record<string, unknown>;
}

export interface EnvironmentTaskExecutionResult
  extends EnvironmentTaskSpawnResult {
  environmentId: string;
  resourceId: string | null;
  selection: EnvironmentSelectionResult;
  selectionCandidate: EnvironmentSelectionCandidate;
  evidence: string[];
}

export class EnvironmentTaskExecutionError extends Error {
  constructor(
    readonly environmentId: string | null,
    message: string,
    readonly evidence: string[] = [],
    readonly operation: string = "unknown",
  ) {
    super(message);
    this.name = "EnvironmentTaskExecutionError";
  }
}

/**
 * Open registry for Task execution adapters.
 *
 * Environment IDs are data, not an allowlist. New providers register an adapter
 * at runtime without requiring a central switch statement.
 */
export class EnvironmentTaskExecutorRegistry {
  private readonly executors = new Map<string, EnvironmentTaskExecutor>();

  register(executor: EnvironmentTaskExecutor): void {
    const id = executor.environmentId.trim();
    if (!id) throw new Error("Environment task executor id cannot be empty.");
    this.executors.set(id, executor);
  }

  unregister(environmentId: string): boolean {
    return this.executors.delete(environmentId);
  }

  get(environmentId: string): EnvironmentTaskExecutor | null {
    return this.executors.get(environmentId) ?? null;
  }

  has(environmentId: string): boolean {
    return this.executors.has(environmentId);
  }

  list(): EnvironmentTaskExecutor[] {
    return [...this.executors.values()];
  }
}

/**
 * Resolves a Task to one environment executor and performs exactly one
 * environment attempt. If that selected attempt fails, the failure is surfaced
 * instead of being hidden by a silent provider fallback.
 */
export class EnvironmentExecutionBridge {
  constructor(
    private readonly selector: EnvironmentSelector,
    private readonly executors: EnvironmentTaskExecutorRegistry,
    private readonly lifecycle?: EnvironmentLifecycleManager,
  ) {}

  async spawn(
    task: TaskNode,
    options: EnvironmentTaskSpawnOptions = {},
  ): Promise<EnvironmentTaskExecutionResult> {
    const selection = await this.selector.select({
      // Task capabilities belong to the executor/tool plane, not necessarily to
      // the infrastructure provider itself. They remain available to adapters
      // through task + metadata instead of being falsely treated as provider SKUs.
      requiredCapabilities: [],
      preferredEnvironment:
        options.preferredEnvironment !== undefined
          ? options.preferredEnvironment
          : task.preferredEnvironment ?? null,
      excludedEnvironmentIds: options.excludedEnvironmentIds ?? [],
      expectedDurationMs: task.metadata.timeoutMs,
      goalId: task.goalId,
      pathId: task.strategicPathId ?? null,
      taskId: task.id,
      metadata: {
        taskRequiredCapabilities: task.requiredCapabilities ?? [],
        agentRole: task.agentRole,
        ...(options.metadata ?? {}),
      },
    });

    const discoveryEvidence: string[] = [];
    let chosen:
      | {
          candidate: EnvironmentSelectionCandidate;
          executor: EnvironmentTaskExecutor;
          assessment: EnvironmentTaskExecutionAssessment;
        }
      | null = null;

    for (const candidate of selection.candidates) {
      if (!candidate.executionEligible) {
        discoveryEvidence.push(
          `${candidate.environmentId}: not execution-eligible: ${candidate.blockers.join("; ") || "unknown blocker"}`,
        );
        continue;
      }

      const executor = this.executors.get(candidate.environmentId);
      if (!executor) {
        discoveryEvidence.push(
          `${candidate.environmentId}: environment is eligible but no Task executor adapter is currently registered.`,
        );
        continue;
      }

      const assessment = executor.assess
        ? await safeAssess(executor, task, options)
        : {
            executable: null,
            evidence: [
              "Executor exposes no preflight assessment; capability remains unknown until attempted.",
            ],
          };

      discoveryEvidence.push(
        ...(assessment.evidence ?? []).map(
          (entry) => `${candidate.environmentId}: ${entry}`,
        ),
      );

      if (assessment.executable === false) {
        discoveryEvidence.push(
          `${candidate.environmentId}: executor reported this Task unavailable under current conditions.`,
        );
        continue;
      }

      chosen = { candidate, executor, assessment };
      break;
    }

    if (!chosen) {
      const evidence = [
        ...selection.unresolved,
        ...discoveryEvidence,
        "No registered environment Task executor is currently executable. This is unavailable/undiscovered capability evidence, not proof that the objective is impossible.",
      ];
      throw new EnvironmentTaskExecutionError(
        null,
        `Environment unavailable for task ${task.id}: no currently executable registered Task executor. The objective remains eligible for discovery, acquisition, composition, construction, authorization, or a changed environment.`,
        evidence,
        "selection",
      );
    }

    const attemptEvidence = [
      ...chosen.candidate.evidence,
      ...discoveryEvidence,
      ...(chosen.assessment.evidence ?? []),
      `Selected environment=${chosen.candidate.environmentId} score=${chosen.candidate.score}`,
    ];

    let spawned: EnvironmentTaskSpawnResult;
    try {
      spawned = await chosen.executor.spawn(task, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new EnvironmentTaskExecutionError(
        chosen.candidate.environmentId,
        `Environment task execution failed in "${chosen.candidate.environmentId}": ${message}`,
        [...attemptEvidence, `spawn failure: ${message}`],
        "spawn",
      );
    }

    const combinedEvidence = [
      ...attemptEvidence,
      ...(spawned.evidence ?? []),
    ];

    const resource = this.lifecycle
      ? this.lifecycle.adopt({
          provider: chosen.candidate.environmentId,
          externalId:
            spawned.resourceExternalId ||
            spawned.sandboxId ||
            spawned.address,
          type:
            spawned.resourceType ||
            `${chosen.candidate.environmentId}-task-executor`,
          goalId: task.goalId,
          pathId: task.strategicPathId ?? null,
          taskId: task.id,
          status: "running",
          capabilities: task.requiredCapabilities ?? [],
          estimatedCostCents:
            chosen.candidate.estimate.estimatedCostCents ?? null,
          retentionPolicy: "until_goal_complete",
          evidence: combinedEvidence,
          metadata: {
            ...(spawned.metadata ?? {}),
            executorAddress: spawned.address,
            executorName: spawned.name,
            selectedScore: chosen.candidate.score,
          },
        })
      : null;

    return {
      ...spawned,
      environmentId: chosen.candidate.environmentId,
      resourceId: resource?.id ?? null,
      selection,
      selectionCandidate: chosen.candidate,
      evidence: combinedEvidence,
    };
  }

  async dispatch(
    environmentId: string,
    task: TaskNode,
    target: EnvironmentTaskTarget,
    options: EnvironmentTaskDispatchOptions = {},
  ): Promise<EnvironmentTaskDispatchResult> {
    const executor = this.executors.get(environmentId);
    if (!executor) {
      throw new EnvironmentTaskExecutionError(
        environmentId,
        `Environment "${environmentId}" has no registered Task executor adapter for dispatch.`,
        [
          `No Task executor adapter is registered for environment=${environmentId}.`,
          "This is currently unavailable/undiscovered execution capability, not proof that the objective is impossible.",
        ],
        "dispatch",
      );
    }

    if (!executor.dispatch) {
      throw new EnvironmentTaskExecutionError(
        environmentId,
        `Environment "${environmentId}" does not currently expose Task dispatch.`,
        [
          `Task dispatch is unavailable for environment=${environmentId}.`,
          "Missing dispatch capability is not proof that the objective is impossible.",
        ],
        "dispatch",
      );
    }

    let effectiveOptions = options;
    let materializationManifest: ArtifactTransferManifest | null = null;

    if (options.continuationContext) {
      let prepared;
      try {
        prepared = prepareArtifactMaterialization(
          task,
          options.continuationContext,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        throw new EnvironmentTaskExecutionError(
          environmentId,
          `Artifact materialization preparation failed for "${environmentId}": ${message}`,
          [`artifact materialization preparation failure: ${message}`],
          "materialize",
        );
      }

      if (prepared.request.sources.length > 0) {
        let materialized: ArtifactMaterializationResult;
        if (executor.materializeArtifacts) {
          try {
            materialized = await executor.materializeArtifacts(
              task,
              target,
              prepared.request,
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            materialized = {
              protocolVersion:
                ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
              entries: prepared.request.sources.map((source) => ({
                reference: source.reference,
                state: "unavailable",
                evidence: [
                  `Target artifact materialization failed: ${message}`,
                ],
              })),
              evidence: [
                `Target artifact materializer for environment=${environmentId} failed without proving artifacts available: ${message}`,
              ],
            };
          }
        } else {
          materialized = {
            protocolVersion:
              ARTIFACT_MATERIALIZATION_PROTOCOL_VERSION,
            entries: prepared.request.sources.map((source) => ({
              reference: source.reference,
              state: "unavailable",
              evidence: [
                `Environment ${environmentId} has no target artifact materializer registered for this executor.`,
              ],
            })),
            evidence: [
              `Target artifact materialization is currently unavailable for environment=${environmentId}; this does not classify the artifact or objective as impossible.`,
            ],
          };
        }

        const applied = applyArtifactMaterializationResult(
          prepared,
          materialized,
          {
            environmentId,
            address: target.address,
          },
        );
        materializationManifest = applied.manifest;
        effectiveOptions = {
          ...options,
          continuationContext: applied.continuationContext,
          metadata: {
            ...(options.metadata ?? {}),
            artifactMaterialization: applied.manifest,
          },
        };
      } else {
        effectiveOptions = {
          ...options,
          continuationContext: prepared.continuationContext,
        };
      }
    }

    let result: EnvironmentTaskDispatchResult;
    try {
      result = await executor.dispatch(
        task,
        target,
        effectiveOptions,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new EnvironmentTaskExecutionError(
        environmentId,
        `Environment Task dispatch failed in "${environmentId}": ${message}`,
        [`dispatch failure: ${message}`],
        "dispatch",
      );
    }

    if (materializationManifest) {
      result = {
        ...result,
        metadata: {
          ...(result.metadata ?? {}),
          artifactMaterialization: materializationManifest,
        },
      };
    }

    if (this.lifecycle) {
      const resource = this.lifecycle.resources
        .list({ includeTerminated: true })
        .find(
          (entry) =>
            entry.provider === environmentId &&
            (
              entry.metadata.executorAddress === target.address ||
              entry.metadata.childAddress === target.address ||
              entry.externalId === target.address
            ),
        );

      if (resource) {
        this.lifecycle.resources.applyMutation(
          resource.id,
          {
            goalId: task.goalId,
            pathId: task.strategicPathId ?? null,
            taskId: task.id,
            evidence: result.evidence,
            metadata: {
              ...(result.metadata ?? {}),
              executorAddress: target.address,
              lastDispatchedTaskId: task.id,
            },
          },
          "task_dispatch",
          `Task ${task.id} dispatched through environment executor.`,
        );
      }
    }

    return result;
  }
}

async function safeAssess(
  executor: EnvironmentTaskExecutor,
  task: TaskNode,
  options: EnvironmentTaskSpawnOptions,
): Promise<EnvironmentTaskExecutionAssessment> {
  try {
    return await executor.assess!(task, options);
  } catch (error) {
    return {
      executable: null,
      evidence: [
        `Executor preflight assessment failed: ${error instanceof Error ? error.message : String(error)}. Treating capability as unknown rather than impossible.`,
      ],
    };
  }
}
