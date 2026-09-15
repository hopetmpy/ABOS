/**
 * Durable Scheduler
 *
 * DB-backed heartbeat scheduler with tick overlap guard,
 * task leases, timeouts, and retry logic.
 *
 * Replaces the fragile setInterval-based heartbeat.
 */

import type BetterSqlite3 from "better-sqlite3";
import cronParser from "cron-parser";
import type {
  HeartbeatConfig,
  HeartbeatTaskFn,
  HeartbeatLegacyContext,
  HeartbeatScheduleRow,
  TickContext,
} from "../types.js";
import { buildTickContext } from "./tick-context.js";
import {
  getHeartbeatSchedule,
  updateHeartbeatSchedule,
  insertHeartbeatHistory,
  acquireTaskLease,
  renewTaskLease,
  releaseTaskLease,
  clearExpiredLeases,
  pruneExpiredDedupKeys,
  insertDedupKey,
  insertWakeEvent,
} from "../state/database.js";
import { createLogger } from "../observability/logger.js";
import {
  appendEvidenceEvent,
  correlationIdFor,
  getEvidenceByAuthority,
  getEvidenceByCorrelation,
  type EvidenceEventRecord,
} from "../observability/evidence.js";

type DatabaseType = BetterSqlite3.Database;
const logger = createLogger("heartbeat.scheduler");

const DEFAULT_TASK_TIMEOUT_MS = 30_000;
const LEASE_TTL_MS = 60_000;
const LEASE_RENEW_INTERVAL_MS = Math.floor(LEASE_TTL_MS / 3);
const HISTORY_ID_COUNTER = { value: 0 };

class HeartbeatTaskTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Task timed out after ${timeoutMs}ms`);
    this.name = "HeartbeatTaskTimeoutError";
  }
}

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  HISTORY_ID_COUNTER.value++;
  return `${timestamp}-${random}-${HISTORY_ID_COUNTER.value.toString(36)}`;
}

function timeoutPromise(
  ms: number,
  onTimeout: () => void,
): { promise: Promise<never>; clear: () => void } {
  let timerId: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      // Settle the timeout branch first so Promise.race deterministically
      // records a timeout even when abort listeners reject immediately.
      reject(new HeartbeatTaskTimeoutError(ms));
      onTimeout();
    }, ms);
  });
  return { promise, clear: () => clearTimeout(timerId!) };
}

// Survival tier ordering for tier minimum checks
const TIER_ORDER: Record<string, number> = {
  dead: 0,
  critical: 1,
  low_compute: 2,
  normal: 3,
  high: 4,
};

function tierMeetsMinimum(currentTier: string, minimumTier: string): boolean {
  return (TIER_ORDER[currentTier] ?? 0) >= (TIER_ORDER[minimumTier] ?? 0);
}

const HEARTBEAT_SETTLEMENT_EVENTS = new Set([
  "heartbeat.succeeded",
  "heartbeat.failed",
  "heartbeat.timed_out",
  "heartbeat.late_succeeded",
  "heartbeat.late_failed",
]);

function latestUnsettledHeartbeatAttempt(
  db: DatabaseType,
  taskName: string,
): EvidenceEventRecord | undefined {
  const attempts = getEvidenceByAuthority(db, "heartbeat_schedule", taskName)
    .filter((event) => event.eventType === "heartbeat.attempt_started");

  for (let index = attempts.length - 1; index >= 0; index--) {
    const attempt = attempts[index]!;
    const chain = getEvidenceByCorrelation(db, attempt.correlationId);
    if (!chain.some((event) => HEARTBEAT_SETTLEMENT_EVENTS.has(event.eventType))) {
      return attempt;
    }
  }
  return undefined;
}

export class DurableScheduler {
  private tickInProgress = false;
  private readonly ownerId: string;

  constructor(
    private readonly db: DatabaseType,
    private readonly config: HeartbeatConfig,
    private readonly tasks: Map<string, HeartbeatTaskFn>,
    private readonly legacyContext: HeartbeatLegacyContext,
    private readonly onWakeRequest?: (reason: string) => void,
  ) {
    this.ownerId = `scheduler-${Date.now().toString(36)}`;
  }

  /**
   * Called on interval -- guards against overlap.
   */
  async tick(): Promise<void> {
    if (this.tickInProgress) return;
    this.tickInProgress = true;

    try {
      // Clear any expired leases first
      clearExpiredLeases(this.db);

      // Build shared context (single API call for balance)
      const context = await buildTickContext(
        this.db,
        this.legacyContext.conway,
        this.config,
        this.legacyContext.identity.address,
        this.legacyContext.identity.chainType,
      );

      // Get tasks that are due
      const dueTasks = this.getDueTasks(context);

      for (const task of dueTasks) {
        await this.executeTask(task.taskName, context);
      }

      // Periodic cleanup
      pruneExpiredDedupKeys(this.db);
    } catch (err: any) {
      logger.error("Tick failed", err instanceof Error ? err : undefined);
    } finally {
      this.tickInProgress = false;
    }
  }

  /**
   * Check which tasks are due based on DB schedule.
   */
  getDueTasks(context: TickContext): HeartbeatScheduleRow[] {
    const schedule = getHeartbeatSchedule(this.db);
    const now = new Date();

    return schedule.filter((row) => {
      // Skip disabled tasks
      if (!row.enabled) return false;

      // A durable start intent without any settlement means the process may
      // have died after beginning an external effect but before writing its
      // heartbeat_history outcome. Never redispatch that work automatically.
      const unsettledAttempt = latestUnsettledHeartbeatAttempt(this.db, row.taskName);
      if (unsettledAttempt) {
        if (!row.leaseOwner) {
          const dedupKey = `heartbeat-attempt-in-doubt:${row.taskName}:${unsettledAttempt.id}`;
          if (insertDedupKey(this.db, dedupKey, row.taskName, 24 * 60 * 60 * 1000)) {
            insertWakeEvent(
              this.db,
              "heartbeat_recovery",
              `Heartbeat task '${row.taskName}' has an unsettled durable attempt; automatic redispatch is blocked pending reconciliation.`,
              {
                taskName: row.taskName,
                correlationId: unsettledAttempt.correlationId,
                attemptEventId: unsettledAttempt.id,
                state: "attempt_in_doubt",
              },
            );
          }
        }
        return false;
      }

      // Skip tasks that require a higher survival tier
      if (!tierMeetsMinimum(context.survivalTier, row.tierMinimum)) return false;

      // A timeout is an in-doubt effect, not proof that the task stopped.
      // While the original process is alive the lease remains held. If that
      // supervisor crashes, the durable timeout survives lease expiry and
      // still blocks redispatch until some new evidence reconciles the outcome.
      if (row.lastResult === "timeout") {
        if (!row.leaseOwner) {
          const dedupKey = `heartbeat-timeout-in-doubt:${row.taskName}:${row.lastRunAt ?? "unknown"}`;
          if (insertDedupKey(this.db, dedupKey, row.taskName, 24 * 60 * 60 * 1000)) {
            insertWakeEvent(
              this.db,
              "heartbeat_recovery",
              `Heartbeat task '${row.taskName}' remains in-doubt after timeout; automatic redispatch is blocked pending reconciliation.`,
              { taskName: row.taskName, lastRunAt: row.lastRunAt, state: "timeout_in_doubt" },
            );
          }
        }
        return false;
      }

      // Skip if lease is held by someone else
      if (row.leaseOwner && row.leaseOwner !== this.ownerId) {
        if (row.leaseExpiresAt && new Date(row.leaseExpiresAt) > now) {
          return false;
        }
      }

      // Check if a retry was explicitly scheduled via nextRunAt
      if (row.nextRunAt && new Date(row.nextRunAt) <= now) {
        return true;
      }

      // Check if task is due based on cron expression
      if (row.cronExpression) {
        try {
          const currentDate = row.lastRunAt
            ? new Date(row.lastRunAt)
            : new Date(Date.now() - 86400000); // If never run, assume due

          const interval = cronParser.parseExpression(row.cronExpression, {
            currentDate,
          });
          const nextRun = interval.next().toDate();
          return nextRun <= now;
        } catch {
          return false;
        }
      }

      // Check if task is due based on intervalMs
      if (row.intervalMs) {
        if (!row.lastRunAt) return true;
        const elapsed = now.getTime() - new Date(row.lastRunAt).getTime();
        return elapsed >= row.intervalMs;
      }

      return false;
    });
  }

  /**
   * Execute a single task with timeout and lease.
   */
  async executeTask(taskName: string, ctx: TickContext): Promise<void> {
    const taskFn = this.tasks.get(taskName);
    if (!taskFn) return;

    const schedule = getHeartbeatSchedule(this.db).find(
      (r) => r.taskName === taskName,
    );
    const timeoutMs = schedule?.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;

    // Acquire lease before publishing an attempt. A failed evidence write must
    // release this lease and must never reach the effecting task function.
    if (!this.acquireLease(taskName)) return;

    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const historyId = generateId();
    const correlationId = correlationIdFor("heartbeat_history", historyId);
    let attemptEvidence: EvidenceEventRecord;

    try {
      attemptEvidence = this.db.transaction(() => {
        // A persisted nextRunAt represents one pending retry slot. Consume it
        // atomically with the next durable attempt intent.
        if (schedule?.nextRunAt) {
          updateHeartbeatSchedule(this.db, taskName, { nextRunAt: null });
        }
        return appendEvidenceEvent(this.db, {
          correlationId,
          eventType: "heartbeat.attempt_started",
          domain: "heartbeat",
          authorityType: "heartbeat_schedule",
          authorityId: taskName,
          epistemicStatus: "observation",
          payload: { startedAt, timeoutMs },
        });
      })();
    } catch (error) {
      this.releaseLease(taskName);
      throw error;
    }

    const abortController = new AbortController();
    const taskContext: TickContext = {
      ...ctx,
      abortSignal: abortController.signal,
    };
    // No external/task effect is started until the intent above is durable.
    const executionPromise = Promise.resolve().then(() =>
      taskFn(taskContext, this.legacyContext),
    );
    const timeout = timeoutPromise(timeoutMs, () => abortController.abort());
    let timedOut = false;
    let timeoutHistoryPersisted = false;

    try {
      let rejected = false;
      let executionError: unknown;
      let result: Awaited<ReturnType<HeartbeatTaskFn>> | undefined;
      try {
        result = await Promise.race([executionPromise, timeout.promise]);
      } catch (error) {
        rejected = true;
        executionError = error;
      }

      const durationMs = Date.now() - startMs;
      if (rejected) {
        const error = executionError instanceof Error
          ? executionError
          : new Error(String(executionError));
        timedOut = error instanceof HeartbeatTaskTimeoutError;
        this.recordFailure(
          taskName,
          error,
          durationMs,
          startedAt,
          timedOut ? "timeout" : "failure",
          historyId,
          attemptEvidence.id,
        );
        timeoutHistoryPersisted = timedOut;

        // maxRetries means retries AFTER the initial attempt. Since history
        // includes the current failure, <= preserves exactly that semantic.
        if (schedule && schedule.maxRetries > 0) {
          const history = this.getRecentFailures(taskName);
          if (history <= schedule.maxRetries) {
            this.scheduleRetry(taskName);
          }
        }
        return;
      }

      // Outcome persistence is deliberately outside the execution catch path.
      // If durable evidence fails after an external success, preserve the
      // unresolved start intent instead of fabricating a task failure.
      this.recordSuccess(
        taskName,
        durationMs,
        startedAt,
        historyId,
        attemptEvidence.id,
      );

      if (result?.shouldWake) {
        const reason = result.message || `Heartbeat task '${taskName}' requested wake`;
        this.onWakeRequest?.(reason);
        insertWakeEvent(this.db, "heartbeat", reason, { taskName });
      }
    } finally {
      timeout.clear();
      if (timedOut && timeoutHistoryPersisted) {
        this.holdLeaseUntilTaskSettles(
          taskName,
          executionPromise,
          historyId,
          startMs,
        );
      } else {
        this.releaseLease(taskName);
      }
    }
  }

  /**
   * Acquire a lease for a task.
   */
  acquireLease(taskName: string): boolean {
    return acquireTaskLease(this.db, taskName, this.ownerId, LEASE_TTL_MS);
  }

  /**
   * Release a lease for a task.
   */
  releaseLease(taskName: string): void {
    releaseTaskLease(this.db, taskName, this.ownerId);
  }

  /**
   * Record a successful task execution.
   */
  recordSuccess(
    taskName: string,
    durationMs: number,
    startedAt: string,
    historyId = generateId(),
    causationId: string | null = null,
  ): void {
    const now = new Date().toISOString();
    const correlationId = correlationIdFor("heartbeat_history", historyId);

    this.db.transaction(() => {
      insertHeartbeatHistory(this.db, {
        id: historyId,
        taskName,
        startedAt,
        completedAt: now,
        result: "success",
        durationMs,
        error: null,
        idempotencyKey: null,
      });

      updateHeartbeatSchedule(this.db, taskName, {
        lastRunAt: now,
        nextRunAt: null,
        lastResult: "success",
        lastError: null,
        runCount: (this.getRunCount(taskName) ?? 0) + 1,
      });

      appendEvidenceEvent(this.db, {
        correlationId,
        causationId,
        eventType: "heartbeat.succeeded",
        domain: "heartbeat",
        authorityType: "heartbeat_history",
        authorityId: historyId,
        epistemicStatus: "observation",
        payload: { result: "success", durationMs, externalSettlement: "settled" },
      });
    })();
  }

  /**
   * Record a failed task execution.
   */
  recordFailure(
    taskName: string,
    error: Error,
    durationMs: number,
    startedAt: string,
    result: "failure" | "timeout" = "failure",
    historyId = generateId(),
    causationId: string | null = null,
  ): string {
    const now = new Date().toISOString();
    const errorMessage = error.message || String(error);
    const correlationId = correlationIdFor("heartbeat_history", historyId);

    this.db.transaction(() => {
      insertHeartbeatHistory(this.db, {
        id: historyId,
        taskName,
        startedAt,
        completedAt: now,
        result,
        durationMs,
        error: errorMessage,
        idempotencyKey: null,
      });

      updateHeartbeatSchedule(this.db, taskName, {
        lastRunAt: now,
        lastResult: result,
        lastError: errorMessage,
        failCount: (this.getFailCount(taskName) ?? 0) + 1,
        runCount: (this.getRunCount(taskName) ?? 0) + 1,
      });

      appendEvidenceEvent(this.db, {
        correlationId,
        causationId,
        eventType: result === "timeout" ? "heartbeat.timed_out" : "heartbeat.failed",
        domain: "heartbeat",
        authorityType: "heartbeat_history",
        authorityId: historyId,
        epistemicStatus: "observation",
        payload: {
          result,
          durationMs,
          externalSettlement: result === "timeout" ? "unknown" : "settled",
        },
      });
    })();

    logger.error(`Task '${taskName}' ${result}: ${errorMessage}`);
    return historyId;
  }

  /**
   * Prune old history entries.
   */
  pruneHistory(retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    const result = this.db.prepare(
      "DELETE FROM heartbeat_history WHERE started_at < ?",
    ).run(cutoff);
    return result.changes;
  }

  /**
   * Prune expired dedup keys.
   */
  pruneExpiredDedupKeys(): number {
    return pruneExpiredDedupKeys(this.db);
  }

  // ─── Private helpers ──────────────────────────────────────────

  private holdLeaseUntilTaskSettles(
    taskName: string,
    executionPromise: Promise<{ shouldWake: boolean; message?: string }>,
    timeoutHistoryId: string,
    startMs: number,
  ): void {
    const renew = () => {
      try {
        return renewTaskLease(
          this.db,
          taskName,
          this.ownerId,
          LEASE_TTL_MS,
        );
      } catch (error) {
        logger.error(
          `Failed to renew timed-out task lease for '${taskName}'`,
          error instanceof Error ? error : undefined,
        );
        return false;
      }
    };

    renew();
    const renewalTimer = setInterval(() => {
      if (!renew()) clearInterval(renewalTimer);
    }, LEASE_RENEW_INTERVAL_MS);
    (renewalTimer as unknown as { unref?: () => void }).unref?.();

    const settle = (completedLate: boolean, error?: unknown) => {
      clearInterval(renewalTimer);
      const now = new Date().toISOString();
      const durationMs = Date.now() - startMs;
      const correlationId = correlationIdFor("heartbeat_history", timeoutHistoryId);
      const chain = getEvidenceByCorrelation(this.db, correlationId);
      const causationId = chain.at(-1)?.id ?? null;

      try {
        this.db.transaction(() => {
          if (completedLate) {
            this.db.prepare(
              `UPDATE heartbeat_history
               SET result = 'success', completed_at = ?, duration_ms = ?, error = NULL
               WHERE id = ? AND result = 'timeout'`,
            ).run(now, durationMs, timeoutHistoryId);
            updateHeartbeatSchedule(this.db, taskName, {
              lastRunAt: now,
              nextRunAt: null,
              lastResult: "success",
              lastError: null,
            });
            appendEvidenceEvent(this.db, {
              correlationId,
              causationId,
              eventType: "heartbeat.late_succeeded",
              domain: "heartbeat",
              authorityType: "heartbeat_history",
              authorityId: timeoutHistoryId,
              epistemicStatus: "observation",
              payload: { result: "success", durationMs, externalSettlement: "settled_late" },
            });
          } else {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.db.prepare(
              `UPDATE heartbeat_history
               SET result = 'failure', completed_at = ?, duration_ms = ?, error = ?
               WHERE id = ? AND result = 'timeout'`,
            ).run(now, durationMs, errorMessage, timeoutHistoryId);
            updateHeartbeatSchedule(this.db, taskName, {
              lastRunAt: now,
              lastResult: "failure",
              lastError: errorMessage,
            });
            appendEvidenceEvent(this.db, {
              correlationId,
              causationId,
              eventType: "heartbeat.late_failed",
              domain: "heartbeat",
              authorityType: "heartbeat_history",
              authorityId: timeoutHistoryId,
              epistemicStatus: "observation",
              payload: { result: "failure", durationMs, externalSettlement: "settled_late" },
            });
          }
        })();

        if (completedLate) {
          logger.warn(
            `Task '${taskName}' completed after its timeout; durable timeout reconciled to success and pending retry suppressed`,
          );
        } else {
          logger.warn(
            `Task '${taskName}' settled with an error after its timeout; durable timeout reconciled to failure`,
            { error: error instanceof Error ? error.message : String(error) },
          );
        }
      } catch (persistError) {
        // Keep the timeout/in-doubt authority unchanged if reconciliation cannot
        // be persisted atomically. A later scheduler will surface recovery.
        logger.error(
          `Failed to persist late settlement for '${taskName}'`,
          persistError instanceof Error ? persistError : undefined,
        );
      } finally {
        this.releaseLease(taskName);
      }
    };

    executionPromise.then(
      () => settle(true),
      (error) => settle(false, error),
    );
  }

  private getRunCount(taskName: string): number {
    const row = this.db.prepare(
      "SELECT run_count FROM heartbeat_schedule WHERE task_name = ?",
    ).get(taskName) as { run_count: number } | undefined;
    return row?.run_count ?? 0;
  }

  private getFailCount(taskName: string): number {
    const row = this.db.prepare(
      "SELECT fail_count FROM heartbeat_schedule WHERE task_name = ?",
    ).get(taskName) as { fail_count: number } | undefined;
    return row?.fail_count ?? 0;
  }

  private getRecentFailures(taskName: string): number {
    // Count consecutive recent failures (since last success)
    const rows = this.db.prepare(
      `SELECT result FROM heartbeat_history
       WHERE task_name = ? ORDER BY started_at DESC LIMIT 10`,
    ).all(taskName) as { result: string }[];

    let count = 0;
    for (const row of rows) {
      if (row.result === "success") break;
      count++;
    }
    return count;
  }

  private scheduleRetry(taskName: string): void {
    // Reset next_run_at to now + 30s for a quick retry
    const retryAt = new Date(Date.now() + 30_000).toISOString();
    updateHeartbeatSchedule(this.db, taskName, {
      nextRunAt: retryAt,
    });
  }
}
