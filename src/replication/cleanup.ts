/**
 * Sandbox Cleanup
 *
 * Cleans up sandbox resources for stopped/failed children.
 * Transitions children to cleaned_up state after destruction.
 */

import type { Database as DatabaseType } from "better-sqlite3";
import type { ConwayClient } from "../types.js";
import type { ChildLifecycle } from "./lifecycle.js";
import { EnvironmentResourceStore } from "../environments/resource-store.js";
import { createLogger } from "../observability/logger.js";
const logger = createLogger("replication.cleanup");

export class SandboxCleanup {
  constructor(
    private conway: ConwayClient,
    private lifecycle: ChildLifecycle,
    private db: DatabaseType,
  ) {}

  /**
   * Clean up a single child's sandbox.
   * Only works for children in stopped or failed state.
   */
  async cleanup(childId: string): Promise<void> {
    const state = this.lifecycle.getCurrentState(childId);
    if (state !== "stopped" && state !== "failed") {
      throw new Error(`Cannot clean up child in state: ${state}`);
    }

    // Look up sandbox ID
    const childRow = this.db
      .prepare("SELECT sandbox_id FROM children WHERE id = ?")
      .get(childId) as { sandbox_id: string } | undefined;

    // The child state must never say cleaned_up merely because a legacy
    // Conway client returned a successful no-op. P-018 has the canonical,
    // crash-recoverable physical release owner, and an uncertain DELETE must
    // not be retried blindly through a second cleanup implementation.
    if (childRow?.sandbox_id) {
      const matching = new EnvironmentResourceStore(this.db)
        .list({ provider: "conway", includeTerminated: true })
        .filter(resource => resource.externalId === childRow.sandbox_id);
      if (matching.length !== 1 ||
          matching[0]!.status !== "terminated" ||
          matching[0]!.metadata.retentionReleaseState !== "released") {
        throw new Error(
          "Conway child sandbox release is not verified by P-018. Keep the child stopped/failed until provider-neutral retention confirms deletion.",
        );
      }
    }
    this.lifecycle.transition(childId, "cleaned_up", childRow?.sandbox_id
      ? `sandbox ${childRow.sandbox_id} physically released by P-018`
      : "child has no external sandbox identity to release");
  }

  /**
   * Clean up all stopped and failed children.
   */
  async cleanupAll(): Promise<number> {
    const stopped = this.lifecycle.getChildrenInState("stopped");
    const failed = this.lifecycle.getChildrenInState("failed");
    let cleaned = 0;

    for (const child of [...stopped, ...failed]) {
      try {
        await this.cleanup(child.id);
        cleaned++;
      } catch (error) {
        logger.error(`Failed to clean up child ${child.id}`, error instanceof Error ? error : undefined);
      }
    }

    return cleaned;
  }

  /**
   * Clean up children that have been in stopped/failed state for too long.
   */
  async cleanupStale(maxAgeHours: number): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeHours * 3600_000).toISOString();
    const stale = this.db.prepare(
      "SELECT id FROM children WHERE status IN ('failed', 'stopped') AND last_checked < ?",
    ).all(cutoff) as Array<{ id: string }>;

    let cleaned = 0;
    for (const child of stale) {
      try {
        await this.cleanup(child.id);
        cleaned++;
      } catch (error) {
        logger.error(`Failed to clean up stale child ${child.id}`, error instanceof Error ? error : undefined);
      }
    }

    return cleaned;
  }
}
