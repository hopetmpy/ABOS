/**
 * Rate Limit Policy Rules
 *
 * Enforces rate limits on sensitive operations where frequency itself is part
 * of the policy. Self-modification is intentionally absent: P-012 makes
 * isolation, verification, exact activation and causal recovery its safety
 * authority instead of an arbitrary call counter.
 * Counts causal execution evidence rather than pre-effect allow decisions.
 */

import type {
  PolicyRule,
  PolicyRequest,
  PolicyRuleResult,
} from "../../types.js";

function deny(
  rule: string,
  reasonCode: string,
  humanMessage: string,
): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

/**
 * Count recent operations with evidence that an effect ran or may have run.
 *
 * v16+ rows count running/succeeded/unknown execution states. A known failed
 * execution is not counted because the effect is known not to have succeeded.
 * Migrated legacy rows have no execution evidence, so their historical
 * decision='allow' semantics are preserved conservatively.
 */
function countRecentExecutions(
  db: import("better-sqlite3").Database,
  toolName: string,
  windowMs: number,
): number {
  const cutoff = new Date(Date.now() - windowMs);
  // SQLite datetime format: 'YYYY-MM-DD HH:MM:SS'
  const cutoffStr = cutoff.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM policy_decisions
       WHERE tool_name = ?
         AND created_at >= ?
         AND (
           (lifecycle_state = 'legacy' AND decision = 'allow')
           OR (
             lifecycle_state <> 'legacy'
             AND execution_state IN ('running', 'succeeded', 'unknown')
           )
         )`,
    )
    .get(toolName, cutoffStr) as { count: number };
  return row.count;
}

/**
 * Maximum 1 genesis prompt change per day.
 */
function createGenesisPromptDailyRule(): PolicyRule {
  return {
    id: "rate.genesis_prompt_daily",
    description: "Maximum 1 update_genesis_prompt per day",
    priority: 600,
    appliesTo: { by: "name", names: ["update_genesis_prompt"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const db = (request.context.db as any)?.raw ?? (request.context as any).rawDb;
      if (!db) return deny(this.id, "DB_UNAVAILABLE", "Rate limit check failed: database not accessible");

      const oneDayMs = 24 * 60 * 60 * 1000;
      const recentCount = countRecentExecutions(db, "update_genesis_prompt", oneDayMs);

      if (recentCount >= 1) {
        return deny(
          "rate.genesis_prompt_daily",
          "RATE_LIMIT_GENESIS",
          `Genesis prompt change rate exceeded: ${recentCount} changes in the last 24 hours (max 1/day)`,
        );
      }

      return null;
    },
  };
}

/**
 * Maximum 3 child spawns per day.
 */
function createSpawnDailyRule(): PolicyRule {
  return {
    id: "rate.spawn_daily",
    description: "Maximum 3 spawn_child calls per day",
    priority: 600,
    appliesTo: { by: "name", names: ["spawn_child"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const db = (request.context.db as any)?.raw ?? (request.context as any).rawDb;
      if (!db) return deny(this.id, "DB_UNAVAILABLE", "Rate limit check failed: database not accessible");

      const oneDayMs = 24 * 60 * 60 * 1000;
      const recentCount = countRecentExecutions(db, "spawn_child", oneDayMs);

      if (recentCount >= 3) {
        return deny(
          "rate.spawn_daily",
          "RATE_LIMIT_SPAWN",
          `Child spawn rate exceeded: ${recentCount} spawns in the last 24 hours (max 3/day)`,
        );
      }

      return null;
    },
  };
}

/**
 * Create all remaining frequency-based policy rules.
 *
 * edit_own_file is deliberately not present. Every source activation is gated
 * by the P-012 transaction authority regardless of whether it is the first or
 * fiftieth valid change in a time window.
 */
export function createRateLimitRules(): PolicyRule[] {
  return [
    createGenesisPromptDailyRule(),
    createSpawnDailyRule(),
  ];
}
