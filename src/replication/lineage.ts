/**
 * Lineage Tracking
 *
 * Track parent-child relationships between ABOS agents.
 * The parent records children in SQLite.
 * Children record their parent in config.
 * ERC-8004 registration includes parentAgent field.
 *
 * Phase 3.1: Actual pruning + concurrency-limited refresh.
 */

import type {
  AbosDatabase,
  ChildAbosAgent,
  AbosConfig,
  ConwayClient,
} from "../types.js";
import { ChildLifecycle } from "./lifecycle.js";
import { ChildHealthMonitor } from "./health.js";
import type { SandboxCleanup } from "./cleanup.js";
import { deleteChild } from "../state/database.js";
import { createLogger } from "../observability/logger.js";
const logger = createLogger("replication.lineage");

/**
 * Get the full lineage tree (parent -> children).
 */
export function getLineage(db: AbosDatabase): {
  children: ChildAbosAgent[];
  alive: number;
  dead: number;
  total: number;
} {
  const children = db.getChildren();
  const alive = children.filter(
    (c) => c.status === "running" || c.status === "sleeping" || c.status === "healthy",
  ).length;
  const dead = children.filter((c) => c.status === "dead" || c.status === "failed" || c.status === "cleaned_up").length;

  return {
    children,
    alive,
    dead,
    total: children.length,
  };
}

/**
 * Check if this abos has a parent (is itself a child).
 */
export function hasParent(config: AbosConfig): boolean {
  return !!config.parentAddress;
}

/**
 * Get a summary of the lineage for the system prompt.
 */
export function getLineageSummary(
  db: AbosDatabase,
  config: AbosConfig,
): string {
  const lineage = getLineage(db);
  const parts: string[] = [];

  if (hasParent(config)) {
    parts.push(`Parent: ${config.parentAddress}`);
  }

  if (lineage.total > 0) {
    parts.push(
      `Children: ${lineage.total} total (${lineage.alive} alive, ${lineage.dead} dead)`,
    );
    for (const child of lineage.children) {
      parts.push(
        `  - ${child.name} [${child.status}] sandbox:${child.sandboxId}`,
      );
    }
  }

  return parts.length > 0 ? parts.join("\n") : "No lineage (first generation)";
}

/**
 * Prune dead children: actually delete from DB and clean up sandboxes.
 * Phase 3.1 fix: was previously a no-op.
 */
export async function pruneDeadChildren(
  db: AbosDatabase,
  cleanup?: SandboxCleanup,
  keepLast: number = 5,
): Promise<number> {
  const children = db.getChildren();
  const dead = children.filter(
    (c) => c.status === "dead" || c.status === "failed" || c.status === "stopped",
  );

  if (dead.length <= keepLast) return 0;

  // Sort by creation date, oldest first
  dead.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  // Keep the most recent `keepLast` dead children
  const toRemove = dead.slice(0, dead.length - keepLast);
  let removed = 0;

  for (const child of toRemove) {
    try {
      // Clean up sandbox if cleanup is available and child is in cleanable state
      if (cleanup && (child.status === "stopped" || child.status === "failed" || child.status === "dead")) {
        try {
          await cleanup.cleanup(child.id);
        } catch {
          // Cleanup may fail; still delete the record
        }
      }

      // Actually delete from DB
      deleteChild(db.raw, child.id);
      removed++;
    } catch (error) {
      logger.error(`Failed to prune child ${child.id}`, error instanceof Error ? error : undefined);
    }
  }

  return removed;
}

/**
 * Refresh lifecycle-managed child status using the canonical child-scoped
 * health monitor.
 *
 * The old fallback executed `echo alive` through the parent Conway boundary
 * and wrote `unknown` directly into children.status. That could neither prove
 * child liveness nor preserve ChildLifecycle event authority. If a monitor is
 * not injected, construct the canonical monitor from the existing authorities
 * instead of inventing a second health path.
 */
export async function refreshChildrenStatus(
  conway: ConwayClient,
  db: AbosDatabase,
  healthMonitor?: ChildHealthMonitor,
): Promise<void> {
  const monitor = healthMonitor ?? new ChildHealthMonitor(
    db.raw,
    conway,
    new ChildLifecycle(db.raw),
  );

  await monitor.checkAllChildren();
}
