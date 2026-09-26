/**
 * Child Health Monitor
 *
 * Checks the health of child ABOS agents by querying their sandboxes.
 * Process liveness is necessary but not sufficient: a lifecycle child can only
 * be reported healthy when the birth/bootstrap authorities still verify.
 */

import type { Database as DatabaseType } from "better-sqlite3";
import type {
  ChildAbosAgent,
  ConwayClient,
  HealthCheckResult,
  ChildHealthConfig,
} from "../types.js";
import { DEFAULT_CHILD_HEALTH_CONFIG } from "../types.js";
import type { ChildLifecycle } from "./lifecycle.js";
import { verifyChildBootstrap } from "./bootstrap-gate.js";

export { DEFAULT_CHILD_HEALTH_CONFIG };

interface HealthCandidate {
  id: string;
  name: string;
  sandboxId: string;
  status: string;
  createdAt: string;
  lastChecked: string | null;
}

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
      // Look up the full durable child observation used by the bootstrap gate.
      // Health must be observed inside the child's execution boundary; the
      // parent executor is not evidence of child state.
      const child = this.db
        .prepare(
          `SELECT
             id,
             name,
             address,
             sandbox_id AS sandboxId,
             genesis_prompt AS genesisPrompt,
             creator_message AS creatorMessage,
             funded_amount_cents AS fundedAmountCents,
             status,
             created_at AS createdAt,
             last_checked AS lastChecked,
             chain_type AS chainType
           FROM children
           WHERE id = ?`,
        )
        .get(childId) as ChildAbosAgent | undefined;

      if (!child) {
        return {
          childId,
          healthy: false,
          lastSeen: null,
          uptime: null,
          creditBalance: null,
          issues: ["child not found"],
        };
      }

      const childConway = this.conway.createScopedClient(child.sandboxId);
      const result = await childConway.exec(
        "pgrep -af 'node .*dist/index\\.js --run' >/dev/null 2>&1 && echo running || echo stopped",
        10_000,
      );

      if (result.exitCode !== 0) {
        issues.push(
          `runtime probe failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
        );
      } else {
        const observed = result.stdout.trim().split(/\s+/);
        if (observed.includes("running")) {
          // A running process is an observation of liveness, not proof that the
          // child was born with valid constitution/lineage/knowledge context.
          lastSeen = new Date().toISOString();
          const bootstrap = await verifyChildBootstrap(
            childConway,
            this.db,
            child,
          );
          if (bootstrap.valid) {
            healthy = true;
          } else {
            issues.push(
              `bootstrap gate failed: ${bootstrap.evidence.join("; ")}`,
            );
          }
        } else if (observed.includes("stopped")) {
          issues.push("runtime process not running");
        } else {
          issues.push("runtime probe returned unknown state");
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

    // Update last_checked timestamp. This remains parent observation metadata;
    // it is never promoted into child-emitted heartbeat evidence.
    try {
      this.db.prepare("UPDATE children SET last_checked = datetime('now') WHERE id = ?").run(childId);
    } catch {
      // Non-critical
    }

    return { childId, healthy, lastSeen, uptime, creditBalance, issues };
  }

  /**
   * Check health of all active lifecycle children plus safely adoptable legacy
   * running/sleeping rows that predate child_lifecycle_events.
   *
   * Legacy labels are candidates only. Adoption requires fresh child-scoped
   * runtime AND bootstrap evidence; UNKNOWN/errors leave the row untouched.
   */
  async checkAllChildren(): Promise<HealthCheckResult[]> {
    const healthyChildren = this.lifecycle.getChildrenInState("healthy");
    const unhealthyChildren = this.lifecycle.getChildrenInState("unhealthy");
    const legacyChildren = this.db
      .prepare(
        `SELECT
           c.id,
           c.name,
           c.sandbox_id AS sandboxId,
           c.status,
           c.created_at AS createdAt,
           c.last_checked AS lastChecked
         FROM children c
         WHERE c.status IN ('running', 'sleeping')
           AND NOT EXISTS (
             SELECT 1 FROM child_lifecycle_events e WHERE e.child_id = c.id
           )`,
      )
      .all() as HealthCandidate[];
    const allChildren: HealthCandidate[] = [
      ...healthyChildren,
      ...unhealthyChildren,
      ...legacyChildren,
    ];

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
          if (child.status === "running" || child.status === "sleeping") {
            if (result.healthy) {
              this.lifecycle.adoptObservedLegacyState(
                result.childId,
                "healthy",
                "legacy child adopted from verified bootstrap plus runtime observation",
                { evidence: result.issues, lastSeen: result.lastSeen },
              );
            } else if (result.issues.includes("runtime process not running")) {
              this.lifecycle.adoptObservedLegacyState(
                result.childId,
                "unhealthy",
                "legacy child adopted from health probe observing runtime absence",
                { evidence: result.issues },
              );
            }
          } else if (!result.healthy && child.status === "healthy") {
            this.lifecycle.transition(result.childId, "unhealthy", result.issues.join("; "));
          } else if (result.healthy && child.status === "unhealthy") {
            this.lifecycle.transition(
              result.childId,
              "healthy",
              "bootstrap gate and runtime liveness recovered",
            );
          }
        } catch {
          // Transition/adoption may fail if state changed concurrently; non-fatal.
        }

        results.push(result);
      }
    }

    return results;
  }
}
