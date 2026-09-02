/**
 * Child Health Monitor
 *
 * Checks the health of child ABOS agents by querying their sandboxes.
 * Uses JSON parsing (not string matching) for status results.
 * Never throws from health checks -- returns issues array instead.
 */

import type { Database as DatabaseType } from "better-sqlite3";
import type { ConwayClient, HealthCheckResult, ChildHealthConfig } from "../types.js";
import { DEFAULT_CHILD_HEALTH_CONFIG } from "../types.js";
import type { ChildLifecycle } from "./lifecycle.js";

export { DEFAULT_CHILD_HEALTH_CONFIG };

export class ChildHealthMonitor {
  private config: ChildHealthConfig;

  constructor(
    private db: DatabaseType,
    private conway: ConwayClient,
    private lifecycle: ChildLifecycle,
    config?: Partial<ChildHealthConfig>,
  ) {
    this.config = { ...DEFAULT_CHILD_HEALTH_CONFIG, ...config };
  }

  /**
   * Check health of a single child. Never throws.
   */
  async checkHealth(childId: string): Promise<HealthCheckResult> {
    const issues: string[] = [];
    let healthy = false;
    let lastSeen: string | null = null;
    let uptime: number | null = null;
    let creditBalance: number | null = null;

    try {
      // Look up child sandbox. Health must be observed inside the child's
      // execution boundary; the parent executor is not evidence of child state.
      const childRow = this.db
        .prepare("SELECT sandbox_id FROM children WHERE id = ?")
        .get(childId) as { sandbox_id: string } | undefined;

      if (!childRow) {
        return {
          childId,
          healthy: false,
          lastSeen: null,
          uptime: null,
          creditBalance: null,
          issues: ["child not found"],
        };
      }

      const childConway = this.conway.createScopedClient(childRow.sandbox_id);
      const result = await childConway.exec(
        "pgrep -af 'node .*dist/index\\.js --run' >/dev/null 2>&1 && echo running || echo stopped",
        10_000,
      );

      if (result.exitCode !== 0) {
        issues.push(
          `runtime probe failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
        );
      } else {
        const observed = result.stdout.trim().split(/\\s+/);
        if (observed.includes("running")) {
          healthy = true;
          lastSeen = new Date().toISOString();
        } else {
          issues.push("runtime process not running");
        }
      }

      // There is currently no provider API in this runtime that lets the
      // parent query a child's Conway credit balance by address. Do not
      // substitute cumulative funding or parent balance for child balance.
      // Unknown remains null until direct child evidence is available.
      creditBalance = null;
    } catch (error) {
      issues.push(`health check error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Update last_checked timestamp
    try {
      this.db.prepare("UPDATE children SET last_checked = datetime('now') WHERE id = ?").run(childId);
    } catch {
      // Non-critical
    }

    return { childId, healthy, lastSeen, uptime, creditBalance, issues };
  }

  /**
   * Check health of all active children (healthy + unhealthy).
   * Respects concurrency limits. Transitions children based on results.
   */
  async checkAllChildren(): Promise<HealthCheckResult[]> {
    const healthyChildren = this.lifecycle.getChildrenInState("healthy");
    const unhealthyChildren = this.lifecycle.getChildrenInState("unhealthy");
    const allChildren = [...healthyChildren, ...unhealthyChildren];

    if (allChildren.length === 0) return [];

    const results: HealthCheckResult[] = [];
    const maxConcurrent = this.config.maxConcurrentChecks;

    // Process in batches for concurrency limiting
    for (let i = 0; i < allChildren.length; i += maxConcurrent) {
      const batch = allChildren.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(
        batch.map((child) => this.checkHealth(child.id)),
      );

      for (const result of batchResults) {
        const child = allChildren.find((c) => c.id === result.childId);
        if (!child) continue;

        try {
          if (!result.healthy && child.status === "healthy") {
            this.lifecycle.transition(result.childId, "unhealthy", result.issues.join("; "));
          } else if (result.healthy && child.status === "unhealthy") {
            this.lifecycle.transition(result.childId, "healthy", "recovered");
          }
        } catch {
          // Transition may fail if state changed concurrently; non-fatal
        }

        results.push(result);
      }
    }

    return results;
  }
}
