import { createHash } from "node:crypto";
import type { TaskNode } from "../orchestration/task-graph.js";
import type { EnvironmentLifecycleManager } from "./lifecycle.js";
import {
  EnvironmentTaskExecutionError,
  type EnvironmentExecutionBridge,
  type EnvironmentTaskDispatchResult,
  type EnvironmentTaskExecutionResult,
  type EnvironmentTaskTarget,
} from "./task-executor.js";
import type {
  EnvironmentMigrationRecord,
  EnvironmentMigrationStore,
} from "./mobility-store.js";
import type { EnvironmentRegistry } from "./registry.js";
import type {
  EnvironmentSelectionResult,
  EnvironmentSelector,
} from "./selector.js";
import type {
  EnvironmentRequirements,
  EnvironmentResource,
} from "./types.js";

export interface EnvironmentMobilityPlan {
  migration: EnvironmentMigrationRecord;
  selection: EnvironmentSelectionResult;
  excludedEnvironmentIds: string[];
  excludedResourceIds: string[];
}

export interface EnvironmentMobilitySpawnResult
  extends EnvironmentTaskExecutionResult {
  migrationId: string | null;
  mobilityExcludedEnvironmentIds: string[];
  mobilityExcludedResourceIds: string[];
}

export interface EnvironmentRecoverySweepResult {
  evaluated: number;
  reconciled: number;
  recoverAttempts: number;
  recovered: number;
  unchangedSkipped: number;
  unknown: number;
  migrationsReconciled: number;
  retentionOwnedSkipped: number;
  evidence: string[];
}

/**
 * Provider-neutral continuity layer.
 *
 * This is not a second Orchestrator. It wraps environment selection/execution
 * with durable evidence about failed environment attempts and resource health.
 * Provider IDs are runtime data. No provider-pair migration routes are encoded.
 */
export class EnvironmentMobilityCoordinator {
  constructor(
    private readonly registry: EnvironmentRegistry,
    private readonly selector: EnvironmentSelector,
    private readonly lifecycle: EnvironmentLifecycleManager,
    readonly store: EnvironmentMigrationStore,
    private readonly execution: EnvironmentExecutionBridge,
  ) {}

  /**
   * Build a non-destructive migration plan for an owned resource.
   * Planning never provisions or destroys provider resources.
   */
  async plan(
    sourceResourceId: string,
    requirements: EnvironmentRequirements,
    reason: string,
  ): Promise<EnvironmentMobilityPlan> {
    const source = this.requireResource(sourceResourceId);
    const migration = this.store.create({
      goalId: requirements.goalId ?? source.goalId,
      pathId: requirements.pathId ?? source.pathId,
      taskId: requirements.taskId ?? source.taskId,
      sourceResourceId: source.id,
      sourceProvider: source.provider,
      status: "target_selecting",
      reason,
      requirements: requirements as unknown as Record<string, unknown>,
      evidence: [
        `Mobility planning started from resource=${source.id} provider=${source.provider}.`,
      ],
    });

    const excludedEnvironmentIds = uniqueStrings(
      requirements.excludedEnvironmentIds ?? [],
    );
    const excludedResourceIds = [source.id];
    const selection = await this.selector.select({
      ...requirements,
      excludedEnvironmentIds,
      metadata: {
        ...(requirements.metadata ?? {}),
        mobilitySourceResourceId: source.id,
        mobilityExcludedResourceIds: excludedResourceIds,
      },
    });

    const selected = selection.selected;
    const updated = this.store.transition(
      migration.id,
      selected ? "planned" : "blocked",
      {
        targetProvider: selected?.environmentId ?? null,
        evidence: [
          ...selection.unresolved,
          ...selection.candidates.flatMap((candidate) => [
            `${candidate.environmentId}: score=${candidate.score} eligible=${candidate.executionEligible}`,
            ...candidate.blockers.map(
              (blocker) => `${candidate.environmentId}: ${blocker}`,
            ),
          ]),
        ],
        metadata: {
          selectedEnvironment: selected?.environmentId ?? null,
          candidateCount: selection.candidates.length,
          excludedEnvironmentIds,
          excludedResourceIds,
        },
      },
      "plan",
    );

    return {
      migration: updated,
      selection,
      excludedEnvironmentIds,
      excludedResourceIds,
    };
  }

  /**
   * Spawn through the canonical EnvironmentExecutionBridge while avoiding
   * equivalent failed environment attempts under unchanged conditions.
   */
  async spawn(task: TaskNode): Promise<EnvironmentMobilitySpawnResult> {
    const active = this.store.findActiveForTask(
      task.id,
      task.strategicPathId ?? null,
    );
    const exclusions = active
      ? await this.unchangedFailedEnvironmentExclusions(active, task)
      : [];
    const resourceExclusions = active
      ? failedResourceIds(active)
      : [];

    try {
      const spawned = await this.execution.spawn(task, {
        excludedEnvironmentIds: exclusions,
        excludedResourceIds: resourceExclusions,
        metadata: {
          mobilityMigrationId: active?.id ?? null,
          mobilityExcludedEnvironmentIds: exclusions,
          mobilityExcludedResourceIds: resourceExclusions,
          mobilitySourceResourceId: active?.sourceResourceId ?? null,
        },
      });

      let migration = active;
      if (migration) {
        migration = this.store.transition(
          migration.id,
          "target_ready",
          {
            targetResourceId: spawned.resourceId,
            targetProvider: spawned.environmentId,
            evidence: [
              `Mobility target became ready in environment=${spawned.environmentId}.`,
              ...spawned.evidence,
            ],
            metadata: {
              targetAddress: spawned.address,
              targetSandboxId: spawned.sandboxId,
              selectedEnvironment: spawned.environmentId,
            },
          },
          "target_ready",
        );
      }

      return {
        ...spawned,
        migrationId: migration?.id ?? null,
        mobilityExcludedEnvironmentIds: exclusions,
        mobilityExcludedResourceIds: resourceExclusions,
      };
    } catch (error) {
      const executionError =
        error instanceof EnvironmentTaskExecutionError ? error : null;

      if (!executionError?.environmentId) {
        if (active) {
          this.store.transition(
            active.id,
            "blocked",
            {
              evidence: executionError?.evidence ?? [
                error instanceof Error ? error.message : String(error),
              ],
              metadata: {
                excludedEnvironmentIds: exclusions,
                excludedResourceIds: resourceExclusions,
              },
            },
            "selection_blocked",
          );
        }
        throw error;
      }

      const migration = active ?? this.createFailureMigration(
        task,
        executionError.environmentId,
        executionError.operation,
        executionError.message,
      );
      const source = this.findTaskResource(
        task,
        executionError.environmentId,
      );
      const fingerprint = await this.environmentConditionFingerprint(
        executionError.environmentId,
        task,
      );

      const afterAttempt = this.store.recordAttempt(migration.id, {
        environmentId: executionError.environmentId,
        conditionFingerprint: fingerprint,
        stage: executionError.operation,
        evidence: executionError.evidence,
        metadata: {
          taskId: task.id,
          pathId: task.strategicPathId ?? null,
          sourceResourceId: source?.id ?? null,
          failureScope: source ? "resource" : "environment",
        },
      });

      const providerFailureEnvironments = source
        ? stringMetadata(
            afterAttempt.metadata,
            "providerFailureEnvironments",
          ).filter(
            (environmentId) =>
              environmentId !== executionError.environmentId,
          )
        : uniqueStrings([
            ...stringMetadata(afterAttempt.metadata, "providerFailureEnvironments"),
            executionError.environmentId,
          ]);
      const failedResources = source
        ? uniqueStrings([
            ...stringMetadata(afterAttempt.metadata, "failedResourceIds"),
            source.id,
          ])
        : stringMetadata(afterAttempt.metadata, "failedResourceIds");

      this.store.transition(
        afterAttempt.id,
        "target_failed",
        {
          sourceResourceId:
            migration.sourceResourceId ?? source?.id ?? null,
          sourceProvider:
            migration.sourceProvider ?? executionError.environmentId,
          targetProvider: executionError.environmentId,
          evidence: [
            `Environment attempt failed at stage=${executionError.operation} scope=${source ? "resource" : "environment"}.`,
            ...executionError.evidence,
          ],
          metadata: {
            providerFailureEnvironments,
            failedResourceIds: failedResources,
          },
        },
        "attempt_failed",
      );

      if (
        source &&
        !["terminated", "terminating", "failed"].includes(source.status)
      ) {
        this.lifecycle.resources.applyMutation(
          source.id,
          {
            status: "degraded",
            evidence: [
              `Execution failure recorded by mobility at stage=${executionError.operation}; resource requires fresh health/reconciliation evidence before reuse.`,
            ],
            metadata: {
              mobilityFailureEnvironment:
                executionError.environmentId,
              mobilityFailureStage:
                executionError.operation,
              mobilityFailureFingerprint: fingerprint,
              mobilityFailureAt:
                new Date().toISOString(),
            },
          },
          "mobility_failure",
          "Environment execution failure made this resource ineligible for blind reuse.",
        );
      }

      throw error;
    }
  }

  /**
   * Dispatch through the canonical bridge and close a migration only after
   * semantic transport succeeds. A dispatch failure becomes durable mobility
   * evidence for the next distinct environment attempt.
   */
  async dispatch(
    environmentId: string,
    task: TaskNode,
    target: EnvironmentTaskTarget,
  ): Promise<EnvironmentTaskDispatchResult> {
    try {
      const result = await this.execution.dispatch(
        environmentId,
        task,
        target,
      );

      const active = this.store.findActiveForTask(
        task.id,
        task.strategicPathId ?? null,
      );
      if (active) {
        const targetResource = this.findResourceByAddress(
          environmentId,
          target.address,
        );
        this.store.transition(
          active.id,
          "completed",
          {
            targetResourceId:
              active.targetResourceId ?? targetResource?.id ?? null,
            targetProvider: environmentId,
            evidence: [
              `Task dispatch succeeded through migration target environment=${environmentId}.`,
              ...(result.evidence ?? []),
            ],
            metadata: {
              targetAddress: target.address,
              semanticResultImmediate: result.result != null,
            },
            completed: true,
          },
          "complete",
        );
      }

      return result;
    } catch (error) {
      const executionError =
        error instanceof EnvironmentTaskExecutionError
          ? error
          : new EnvironmentTaskExecutionError(
              environmentId,
              error instanceof Error ? error.message : String(error),
              [error instanceof Error ? error.message : String(error)],
              "dispatch",
            );

      const active = this.store.findActiveForTask(
        task.id,
        task.strategicPathId ?? null,
      );
      const source = this.findResourceByAddress(
        environmentId,
        target.address,
      );
      const migration = active ?? this.store.create({
        goalId: task.goalId,
        pathId: task.strategicPathId ?? null,
        taskId: task.id,
        sourceResourceId: source?.id ?? null,
        sourceProvider: environmentId,
        status: "source_failed",
        reason: executionError.message,
        requirements: taskRequirements(task),
        evidence: executionError.evidence,
        metadata: {
          sourceAddress: target.address,
        },
      });

      const fingerprint = await this.environmentConditionFingerprint(
        environmentId,
        task,
      );
      const afterAttempt = this.store.recordAttempt(migration.id, {
        environmentId,
        conditionFingerprint: fingerprint,
        stage: executionError.operation,
        evidence: executionError.evidence,
        metadata: {
          sourceResourceId: source?.id ?? null,
          sourceAddress: target.address,
          failureScope: source ? "resource" : "environment",
        },
      });
      const providerFailureEnvironments = source
        ? stringMetadata(
            afterAttempt.metadata,
            "providerFailureEnvironments",
          ).filter(
            (failedEnvironmentId) =>
              failedEnvironmentId !== environmentId,
          )
        : uniqueStrings([
            ...stringMetadata(afterAttempt.metadata, "providerFailureEnvironments"),
            environmentId,
          ]);
      const failedResources = source
        ? uniqueStrings([
            ...stringMetadata(afterAttempt.metadata, "failedResourceIds"),
            source.id,
          ])
        : stringMetadata(afterAttempt.metadata, "failedResourceIds");

      this.store.transition(
        afterAttempt.id,
        "target_failed",
        {
          sourceResourceId:
            migration.sourceResourceId ?? source?.id ?? null,
          sourceProvider:
            migration.sourceProvider ?? environmentId,
          evidence: executionError.evidence,
          metadata: {
            providerFailureEnvironments,
            failedResourceIds: failedResources,
          },
        },
        "dispatch_failed",
      );

      if (
        source &&
        !["terminated", "terminating", "failed"].includes(source.status)
      ) {
        this.lifecycle.resources.applyMutation(
          source.id,
          {
            status: "degraded",
            evidence: [
              `Dispatch failure in environment=${environmentId}; mobility requires fresh observation before reuse.`,
            ],
            metadata: {
              mobilityFailureFingerprint: fingerprint,
              mobilityFailureStage:
                executionError.operation,
              mobilityFailureAt:
                new Date().toISOString(),
            },
          },
          "mobility_failure",
          "Dispatch failure recorded for provider-neutral recovery/migration.",
        );
      }

      throw error;
    }
  }

  /**
   * Reconcile uncertain resources and attempt recover exactly once per observed
   * condition fingerprint. No resource is provisioned or destroyed here.
   */
  async sweepRecovery(): Promise<EnvironmentRecoverySweepResult> {
    const result: EnvironmentRecoverySweepResult = {
      evaluated: 0,
      reconciled: 0,
      recoverAttempts: 0,
      recovered: 0,
      unchangedSkipped: 0,
      unknown: 0,
      migrationsReconciled: 0,
      retentionOwnedSkipped: 0,
      evidence: [],
    };

    for (const migration of this.store.list({ activeOnly: true })) {
      if (!migration.targetResourceId) continue;
      const target = this.lifecycle.resources.get(
        migration.targetResourceId,
      );
      if (isRetentionOwnedForRelease(target)) {
        result.retentionOwnedSkipped += 1;
        result.evidence.push(
          `Mobility left migration target resource=${target.id} to the retention authority because retentionReleaseState=${String(target.metadata.retentionReleaseState)}.`,
        );
        continue;
      }

      if (!target) {
        this.store.transition(
          migration.id,
          "unknown",
          {
            evidence: [
              "Migration target resource ownership is no longer present in the canonical inventory.",
            ],
          },
          "reconcile",
        );
        result.migrationsReconciled += 1;
        continue;
      }

      if (this.registry.supportsOperation(target.provider, "reconcile")) {
        const reconciled = await this.lifecycle.reconcile(target.id);
        result.migrationsReconciled += 1;
        if (reconciled.status === "terminated") {
          this.store.transition(
            migration.id,
            "unknown",
            {
              evidence: [
                `Migration target ${target.id} reconciled as terminated before migration completion.`,
              ],
            },
            "reconcile",
          );
        }
      }
    }

    for (const original of this.lifecycle.resources.list()) {
      if (
        !["degraded", "unknown", "recovering"].includes(
          original.status,
        )
      ) {
        continue;
      }
      result.evaluated += 1;
      let resource = original;

      if (isRetentionOwnedForRelease(resource)) {
        result.retentionOwnedSkipped += 1;
        result.evidence.push(
          `Mobility skipped resource=${resource.id}; retention authority owns release state=${String(resource.metadata.retentionReleaseState)}.`,
        );
        continue;
      }

      if (this.registry.supportsOperation(resource.provider, "reconcile")) {
        resource = await this.lifecycle.reconcile(resource.id);
        result.reconciled += 1;
      }

      if (["running", "ready", "suspended"].includes(resource.status)) {
        continue;
      }

      if (resource.status === "unknown") {
        result.unknown += 1;
      }

      if (
        resource.status !== "degraded" ||
        !this.registry.supportsOperation(resource.provider, "recover")
      ) {
        continue;
      }

      const fingerprint = await this.resourceRecoveryFingerprint(
        resource,
      );
      const previous =
        typeof resource.metadata.mobilityRecoveryFingerprint === "string"
          ? resource.metadata.mobilityRecoveryFingerprint
          : null;

      if (previous === fingerprint) {
        result.unchangedSkipped += 1;
        result.evidence.push(
          `Recovery skipped for resource=${resource.id}; observed condition fingerprint is unchanged from the previous recovery attempt.`,
        );
        continue;
      }

      this.lifecycle.resources.applyMutation(
        resource.id,
        {
          metadata: {
            mobilityRecoveryFingerprint: fingerprint,
            mobilityRecoveryAttemptedAt:
              new Date().toISOString(),
          },
          evidence: [
            "Mobility recovery attempt authorized by a new observed condition fingerprint.",
          ],
        },
        "mobility_recovery",
        "Recovery attempt fingerprint recorded before provider mutation.",
      );
      result.recoverAttempts += 1;

      const recovered = await this.lifecycle.recover(resource.id);
      if (["running", "ready", "suspended"].includes(recovered.status)) {
        result.recovered += 1;
      } else {
        result.evidence.push(
          `Recovery did not restore resource=${resource.id}; status=${recovered.status} remains evidence for migration/replanning.`,
        );
      }
    }

    return result;
  }

  async unchangedFailedEnvironmentExclusions(
    migration: EnvironmentMigrationRecord,
    task: TaskNode,
  ): Promise<string[]> {
    const exclusions: string[] = [];

    for (const environmentId of stringMetadata(
      migration.metadata,
      "providerFailureEnvironments",
    )) {
      const previous =
        migration.conditionFingerprints[environmentId];
      if (!previous) continue;

      const current = await this.environmentConditionFingerprint(
        environmentId,
        task,
      );
      if (current === previous) {
        exclusions.push(environmentId);
      }
    }

    return uniqueStrings(exclusions);
  }

  private createFailureMigration(
    task: TaskNode,
    environmentId: string,
    stage: string,
    reason: string,
  ): EnvironmentMigrationRecord {
    const source = this.findTaskResource(task, environmentId);
    return this.store.create({
      goalId: task.goalId,
      pathId: task.strategicPathId ?? null,
      taskId: task.id,
      sourceResourceId: source?.id ?? null,
      sourceProvider: environmentId,
      status: "source_failed",
      reason,
      requirements: taskRequirements(task),
      evidence: [
        `Initial environment failure recorded at stage=${stage}.`,
      ],
      metadata: {
        sourceAddress:
          source && typeof source.metadata.executorAddress === "string"
            ? source.metadata.executorAddress
            : null,
      },
    });
  }

  private findTaskResource(
    task: TaskNode,
    environmentId: string,
  ): EnvironmentResource | null {
    const candidates = this.lifecycle.resources
      .list({ includeTerminated: true })
      .filter(
        (resource) =>
          resource.provider === environmentId &&
          (
            resource.taskId === task.id ||
            (
              resource.goalId === task.goalId &&
              resource.pathId ===
                (task.strategicPathId ?? null)
            )
          ),
      )
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt)
      );
    return candidates[0] ?? null;
  }

  private findResourceByAddress(
    environmentId: string,
    address: string,
  ): EnvironmentResource | null {
    return this.lifecycle.resources
      .list({ includeTerminated: true })
      .find(
        (resource) =>
          resource.provider === environmentId &&
          (
            resource.metadata.executorAddress === address ||
            resource.metadata.childAddress === address ||
            resource.externalId === address
          ),
      ) ?? null;
  }

  private async environmentConditionFingerprint(
    environmentId: string,
    task: TaskNode,
  ): Promise<string> {
    const provider = this.registry.get(environmentId);
    let snapshot: Record<string, unknown>;

    try {
      const observed = provider
        ? await provider.inspect()
        : null;
      snapshot = observed
        ? {
            availability: observed.availability,
            capabilities: observed.capabilities
              .map((capability) => ({
                id: capability.id,
                available: capability.available,
                requirements: [...capability.requirements].sort(),
                permissions: [...capability.permissions].sort(),
              }))
              .sort((a, b) => a.id.localeCompare(b.id)),
            constraints: [...observed.constraints].sort(),
            costModel: observed.costModel ?? null,
            operations:
              this.registry.getSupportedOperations(environmentId),
          }
        : {
            availability: "provider_not_registered",
            operations: [],
          };
    } catch (error) {
      snapshot = {
        availability: "inspection_failed",
        error:
          error instanceof Error ? error.message : String(error),
        operations:
          this.registry.getSupportedOperations(environmentId),
      };
    }

    return sha256Stable({
      environmentId,
      snapshot,
      task: {
        id: task.id,
        pathId: task.strategicPathId ?? null,
        role: task.agentRole ?? null,
        requiredCapabilities: [
          ...(task.requiredCapabilities ?? []),
        ].sort(),
        preferredEnvironment:
          task.preferredEnvironment ?? null,
      },
    });
  }

  private async resourceRecoveryFingerprint(
    resource: EnvironmentResource,
  ): Promise<string> {
    let providerFingerprint = "unavailable";
    try {
      const snapshot = await this.registry
        .get(resource.provider)
        ?.inspect();
      providerFingerprint = sha256Stable({
        availability:
          snapshot?.availability ?? "unknown",
        constraints:
          snapshot?.constraints ?? [],
        operations:
          this.registry.getSupportedOperations(
            resource.provider,
          ),
      });
    } catch {
      providerFingerprint = "inspection_failed";
    }

    return sha256Stable({
      resource: {
        id: resource.id,
        provider: resource.provider,
        externalId: resource.externalId,
        status: resource.status,
        providerState: resource.providerState,
        actualExists:
          resource.metadata.actualExists ?? null,
      },
      providerFingerprint,
    });
  }

  private requireResource(id: string): EnvironmentResource {
    const resource = this.lifecycle.resources.get(id);
    if (!resource) {
      throw new Error(
        `Environment mobility source resource not found: ${id}`,
      );
    }
    return resource;
  }
}

function taskRequirements(task: TaskNode): Record<string, unknown> {
  return {
    requiredCapabilities:
      task.requiredCapabilities ?? [],
    preferredEnvironment:
      task.preferredEnvironment ?? null,
    expectedDurationMs:
      task.metadata.timeoutMs,
    goalId: task.goalId,
    pathId:
      task.strategicPathId ?? null,
    taskId: task.id,
    agentRole:
      task.agentRole ?? null,
  };
}

function sha256Stable(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value), "utf8")
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${stableStringify(entry)}`,
    )
    .join(",")}}`;
}

function isRetentionOwnedForRelease(
  resource: EnvironmentResource,
): boolean {
  const state =
    typeof resource.metadata.retentionReleaseState === "string"
      ? resource.metadata.retentionReleaseState
      : "";
  return new Set([
    "artifact_hold",
    "destroy_requested",
    "pending_observation",
    "destroy_unavailable",
    "released",
  ]).has(state);
}

function failedResourceIds(
  migration: EnvironmentMigrationRecord,
): string[] {
  return uniqueStrings([
    ...stringMetadata(migration.metadata, "failedResourceIds"),
    ...stringMetadata(migration.metadata, "excludedResourceIds"),
  ]);
}

function stringMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string[] {
  const value = metadata[key];
  return Array.isArray(value)
    ? uniqueStrings(
        value.filter((entry): entry is string => typeof entry === "string"),
      )
    : [];
}

function uniqueStrings(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}
