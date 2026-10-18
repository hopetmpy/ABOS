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
import { EnvironmentRegistry } from "../environments/registry.js";
import { EnvironmentLifecycleManager } from "../environments/lifecycle.js";
import { EnvironmentRetentionCoordinator } from "../environments/retention.js";
import { ConwayEnvironmentProvider } from "../environments/conway.js";
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

    const sandboxId = childRow?.sandbox_id?.trim() ?? "";
    if (!sandboxId) {
      this.lifecycle.transition(childId, "cleaned_up", "child has no external sandbox identity");
      return;
    }

    const resources = new EnvironmentResourceStore(this.db);
    const owned = resources.list({ includeTerminated: true })
      .filter(resource => resource.externalId === sandboxId);
    if (owned.length !== 1) {
      throw new Error(
        "Child sandbox release is not attributable to one canonical P-018 owned resource; child remains stopped/failed.",
      );
    }
    const resource = owned[0]!;
    if (typeof resource.metadata.childId === "string" &&
        resource.metadata.childId !== childId) {
      throw new Error("Child sandbox resource belongs to a different P-018 child; no deletion.");
    }

    const released = (observed: typeof resource) =>
      observed.status === "terminated" &&
      observed.metadata.retentionReleaseState === "released";

    if (!released(resource)) {
      if (resource.provider !== "conway" ||
          resource.type !== "conway-sandbox" ||
          resource.retentionPolicy !== "manual_retention") {
        throw new Error(
          "Child sandbox is not verified released and is not eligible for explicit P-018 Conway manual retention.",
        );
      }
      const registry = new EnvironmentRegistry();
      registry.register(new ConwayEnvironmentProvider(this.conway));
      const coordinator = new EnvironmentRetentionCoordinator(
        this.db,
        registry,
        new EnvironmentLifecycleManager(registry, resources),
      );
      // P-018 persists destroy_requested before remote I/O, protects
      // artifacts and prevents duplicate DELETE after a timeout/restart.
      // Other resources are never included in this explicitly scoped sweep.
      await coordinator.sweep({ explicitManualResourceId: resource.id });
      const after = resources.get(resource.id);
      if (!after || !released(after)) {
        throw new Error(
          "Child sandbox cleanup not verified by P-018 release; keep child stopped/failed until reconciled.",
        );
      }
    }
    this.lifecycle.transition(
      childId, "cleaned_up",
      `sandbox ${sandboxId} physically released by canonical P-018 retention`,
    );
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
