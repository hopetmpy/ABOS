import { createHash } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { EnvironmentRegistry } from "./registry.js";
import type { EnvironmentLifecycleManager } from "./lifecycle.js";
import type { EnvironmentResource } from "./types.js";

export interface EnvironmentRetentionSweepResult {
  evaluated: number;
  releaseEligible: number;
  destroyAttempts: number;
  released: number;
  pendingObservation: number;
  unavailable: number;
  artifactHolds: number;
  evidence: string[];
}

interface RetentionDecision {
  release: boolean;
  reason: string;
}

/**
 * Provider-neutral automatic retention coordinator.
 *
 * Retention policy is data. This coordinator never branches on provider names.
 * It only releases resources when persisted Task/Goal state proves that the
 * resource's declared retention boundary has been reached.
 *
 * Destructive retries are observation-gated: after an uncertain destroy, ABOS
 * reconciles provider state first and will not repeat the same destructive path
 * against the same observed condition.
 */
export class EnvironmentRetentionCoordinator {
  constructor(
    private readonly db: Database,
    private readonly registry: EnvironmentRegistry,
    private readonly lifecycle: EnvironmentLifecycleManager,
  ) {}

  async sweep(): Promise<EnvironmentRetentionSweepResult> {
    const result: EnvironmentRetentionSweepResult = {
      evaluated: 0,
      releaseEligible: 0,
      destroyAttempts: 0,
      released: 0,
      pendingObservation: 0,
      unavailable: 0,
      artifactHolds: 0,
      evidence: [],
    };

    for (const initial of this.lifecycle.resources.list()) {
      result.evaluated += 1;
      const decision = this.retentionDecision(initial);
      if (!decision.release) continue;
      result.releaseEligible += 1;

      let resource = initial;
      if (hasPendingLocalArtifacts(resource)) {
        resource = await this.holdForArtifactCollection(
          resource,
          decision.reason,
          result,
        );
        result.artifactHolds += 1;
        continue;
      }
      if (resource.metadata.retentionReleaseState === "pending_observation") {
        resource = await this.observeAfterUncertainDestroy(resource, result);
        if (resource.status === "terminated") {
          result.released += 1;
          continue;
        }

        const actualExists = resource.metadata.actualExists;
        if (actualExists !== true) {
          result.pendingObservation += 1;
          continue;
        }

        const currentFingerprint = resourceFingerprint(resource);
        const previousFingerprint =
          typeof resource.metadata.retentionDestroyFingerprint === "string"
            ? resource.metadata.retentionDestroyFingerprint
            : null;

        if (currentFingerprint === previousFingerprint) {
          result.pendingObservation += 1;
          result.evidence.push(
            `Retention release for resource ${resource.id} remains pending: provider observation is unchanged after an uncertain destroy, so ABOS will not blindly repeat the same destructive attempt.`,
          );
          continue;
        }
      }

      if (!this.registry.supportsOperation(resource.provider, "destroy")) {
        result.unavailable += 1;
        if (resource.metadata.retentionReleaseState !== "destroy_unavailable") {
          this.lifecycle.resources.applyMutation(
            resource.id,
            {
              evidence: [
                `Retention boundary reached (${decision.reason}), but provider "${resource.provider}" does not currently expose destroy. This is unavailable lifecycle capability, not proof of objective impossibility.`,
              ],
              metadata: {
                retentionReleaseState: "destroy_unavailable",
                retentionReleaseReason: decision.reason,
              },
            },
            "retention",
            "Automatic retention release cannot currently invoke provider destruction.",
          );
        }
        continue;
      }

      const fingerprint = resourceFingerprint(resource);
      this.lifecycle.resources.applyMutation(
        resource.id,
        {
          metadata: {
            retentionReleaseState: "destroy_requested",
            retentionReleaseReason: decision.reason,
            retentionDestroyFingerprint: fingerprint,
            retentionDestroyRequestedAt: new Date().toISOString(),
            retentionDestroyAttempts:
              numberValue(resource.metadata.retentionDestroyAttempts) + 1,
          },
          evidence: [
            `Retention boundary reached: ${decision.reason}. Provider-neutral destroy requested.`,
          ],
        },
        "retention",
        "Automatic retention boundary reached.",
      );

      result.destroyAttempts += 1;
      const after = await this.lifecycle.destroy(resource.id);

      if (after.status === "terminated") {
        const released = this.lifecycle.resources.applyMutation(
          after.id,
          {
            metadata: {
              retentionReleaseState: "released",
              retentionReleasedAt: new Date().toISOString(),
            },
            evidence: [
              "Automatic retention release completed and provider resource is terminated.",
            ],
          },
          "retention",
          "Automatic retention release completed.",
        );
        this.markLegacyExecutorReleased(released);
        result.released += 1;
        continue;
      }

      this.lifecycle.resources.applyMutation(
        after.id,
        {
          metadata: {
            retentionReleaseState: "pending_observation",
            retentionDestroyFingerprint: fingerprint,
          },
          evidence: [
            "Destroy did not produce verified termination. Future retention sweeps must observe/reconcile provider state before any new destructive attempt.",
          ],
        },
        "retention",
        "Automatic retention release requires provider observation.",
      );
      result.pendingObservation += 1;
    }

    return result;
  }

  private async holdForArtifactCollection(
    resource: EnvironmentResource,
    releaseReason: string,
    result: EnvironmentRetentionSweepResult,
  ): Promise<EnvironmentResource> {
    const alreadyHeld =
      resource.metadata.retentionReleaseState === "artifact_hold";
    let current = resource;

    if (
      !alreadyHeld &&
      !["suspended", "terminated"].includes(current.status) &&
      this.registry.supportsOperation(current.provider, "suspend")
    ) {
      current = await this.lifecycle.suspend(current.id);
    }

    if (!alreadyHeld) {
      current = this.lifecycle.resources.applyMutation(
        current.id,
        {
          evidence: [
            `Retention boundary reached (${releaseReason}), but local executor artifacts remain uncollected. Resource destruction is held to preserve deliverables.`,
            current.status === "suspended"
              ? "Provider resource was suspended to reduce compute cost while preserving artifact state."
              : "Provider does not currently provide a verified suspended state; resource is retained until artifact collection evidence exists.",
          ],
          metadata: {
            retentionReleaseState: "artifact_hold",
            retentionReleaseReason: releaseReason,
            artifactHoldSince: new Date().toISOString(),
          },
        },
        "retention",
        "Automatic release deferred until remote artifact collection completes.",
      );
    }

    result.evidence.push(
      `Resource ${current.id} retained for ${pendingArtifactCount(current)} uncollected local artifact(s).`,
    );
    return current;
  }

  private retentionDecision(resource: EnvironmentResource): RetentionDecision {
    switch (resource.retentionPolicy) {
      case "ephemeral": {
        if (resource.status === "failed") {
          return {
            release: true,
            reason: "ephemeral resource itself failed before or during execution",
          };
        }

        if (!resource.taskId) {
          return {
            release: false,
            reason: "ephemeral resource has no Task ownership evidence",
          };
        }
        const row = this.db.prepare(
          "SELECT status FROM task_graph WHERE id = ?",
        ).get(resource.taskId) as { status: string } | undefined;
        const terminal = !!row &&
          ["completed", "failed", "cancelled"].includes(row.status);
        return {
          release: terminal,
          reason: terminal
            ? `ephemeral Task ${resource.taskId} settled with status=${row!.status}`
            : "owning Task is not terminal",
        };
      }

      case "until_goal_complete": {
        if (!resource.goalId) {
          return {
            release: false,
            reason: "resource has no Goal ownership evidence",
          };
        }
        const row = this.db.prepare(
          "SELECT status FROM goals WHERE id = ?",
        ).get(resource.goalId) as { status: string } | undefined;
        const terminal = !!row &&
          ["completed", "failed"].includes(row.status);
        return {
          release: terminal,
          reason: terminal
            ? `Goal ${resource.goalId} settled with status=${row!.status}`
            : "owning Goal is not terminal",
        };
      }

      case "persistent":
      case "manual_retention":
        return {
          release: false,
          reason: `retention policy=${resource.retentionPolicy} requires no automatic release`,
        };

      default:
        return {
          release: false,
          reason: `unknown/open retention policy=${resource.retentionPolicy}; ABOS will not invent destructive semantics`,
        };
    }
  }

  private async observeAfterUncertainDestroy(
    resource: EnvironmentResource,
    result: EnvironmentRetentionSweepResult,
  ): Promise<EnvironmentResource> {
    if (!this.registry.supportsOperation(resource.provider, "reconcile")) {
      result.evidence.push(
        `Retention release for resource ${resource.id} is pending observation, but provider "${resource.provider}" does not currently expose reconcile. No blind destroy retry will occur.`,
      );
      return resource;
    }

    const reconciled = await this.lifecycle.reconcile(resource.id);
    if (reconciled.status === "terminated") {
      const released = this.lifecycle.resources.applyMutation(
        reconciled.id,
        {
          metadata: {
            retentionReleaseState: "released",
            retentionReleasedAt: new Date().toISOString(),
          },
          evidence: [
            "Provider reconciliation verified termination after an earlier uncertain destroy.",
          ],
        },
        "retention",
        "Retention release verified by reconciliation.",
      );
      this.markLegacyExecutorReleased(released);
      return released;
    }

    if (reconciled.metadata.actualExists === false) {
      const absent = this.lifecycle.resources.applyMutation(
        reconciled.id,
        {
          status: "terminated",
          metadata: {
            retentionReleaseState: "released",
            retentionReleasedAt: new Date().toISOString(),
          },
          evidence: [
            "Provider reconciliation verified actualExists=false. For retention purposes the resource is released; ABOS does not fabricate a provider-side destruction event.",
          ],
        },
        "retention",
        "Retention boundary satisfied by provider-verified resource absence.",
      );
      this.markLegacyExecutorReleased(absent);
      return absent;
    }

    return reconciled;
  }

  private markLegacyExecutorReleased(resource: EnvironmentResource): void {
    const addresses = [
      resource.metadata.executorAddress,
      resource.metadata.childAddress,
    ].filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    );

    const update = this.db.prepare(
      "UPDATE children SET status = 'cleaned_up' WHERE address = ? OR sandbox_id = ?",
    );

    for (const address of addresses) {
      update.run(address, resource.externalId ?? address);
    }

    if (addresses.length === 0 && resource.externalId) {
      update.run(resource.externalId, resource.externalId);
    }
  }
}

function hasPendingLocalArtifacts(
  resource: EnvironmentResource,
): boolean {
  if (resource.metadata.artifactCollectionState !== "pending") {
    return false;
  }

  const artifacts = Array.isArray(resource.metadata.remoteArtifacts)
    ? resource.metadata.remoteArtifacts.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
    : [];

  return artifacts.some((artifact) => !hasDurableExternalScheme(artifact));
}

function pendingArtifactCount(resource: EnvironmentResource): number {
  return Array.isArray(resource.metadata.remoteArtifacts)
    ? resource.metadata.remoteArtifacts.filter(
        (value): value is string =>
          typeof value === "string" &&
          value.trim().length > 0 &&
          !hasDurableExternalScheme(value),
      ).length
    : 0;
}

function hasDurableExternalScheme(value: string): boolean {
  return /^(?:https?|s3|gs|ipfs|ar):\/\//i.test(value.trim());
}

function resourceFingerprint(resource: EnvironmentResource): string {
  return createHash("sha256")
    .update(JSON.stringify({
      provider: resource.provider,
      externalId: resource.externalId,
      status: resource.status,
      providerState: resource.providerState,
      actualExists: resource.metadata.actualExists ?? null,
    }))
    .digest("hex");
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
