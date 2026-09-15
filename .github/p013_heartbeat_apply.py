from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEDULER = ROOT / "src/heartbeat/scheduler.ts"
text = SCHEDULER.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected replacement once, got {count}: {old[:80]!r}")
    text = text.replace(old, new, 1)


def replace_between(start: str, end: str, replacement: str) -> None:
    global text
    i = text.find(start)
    if i < 0:
        raise RuntimeError(f"start marker not found: {start!r}")
    j = text.find(end, i)
    if j < 0:
        raise RuntimeError(f"end marker not found: {end!r}")
    text = text[:i] + replacement + text[j:]


replace_once(
    'import { createLogger } from "../observability/logger.js";\n',
    '''import { createLogger } from "../observability/logger.js";\nimport {\n  appendEvidenceEvent,\n  correlationIdFor,\n  getEvidenceByAuthority,\n  getEvidenceByCorrelation,\n  type EvidenceEventRecord,\n} from "../observability/evidence.js";\n''',
)

replace_once(
    '''function tierMeetsMinimum(currentTier: string, minimumTier: string): boolean {\n  return (TIER_ORDER[currentTier] ?? 0) >= (TIER_ORDER[minimumTier] ?? 0);\n}\n''',
    '''function tierMeetsMinimum(currentTier: string, minimumTier: string): boolean {\n  return (TIER_ORDER[currentTier] ?? 0) >= (TIER_ORDER[minimumTier] ?? 0);\n}\n\nconst HEARTBEAT_SETTLEMENT_EVENTS = new Set([\n  "heartbeat.succeeded",\n  "heartbeat.failed",\n  "heartbeat.timed_out",\n  "heartbeat.late_succeeded",\n  "heartbeat.late_failed",\n]);\n\nfunction latestUnsettledHeartbeatAttempt(\n  db: DatabaseType,\n  taskName: string,\n): EvidenceEventRecord | undefined {\n  const attempts = getEvidenceByAuthority(db, "heartbeat_schedule", taskName)\n    .filter((event) => event.eventType === "heartbeat.attempt_started");\n\n  for (let index = attempts.length - 1; index >= 0; index--) {\n    const attempt = attempts[index]!;\n    const chain = getEvidenceByCorrelation(db, attempt.correlationId);\n    if (!chain.some((event) => HEARTBEAT_SETTLEMENT_EVENTS.has(event.eventType))) {\n      return attempt;\n    }\n  }\n  return undefined;\n}\n''',
)

replace_once(
    '''      // Skip disabled tasks\n      if (!row.enabled) return false;\n\n      // Skip tasks that require a higher survival tier\n''',
    '''      // Skip disabled tasks\n      if (!row.enabled) return false;\n\n      // A durable start intent without any settlement means the process may\n      // have died after beginning an external effect but before writing its\n      // heartbeat_history outcome. Never redispatch that work automatically.\n      const unsettledAttempt = latestUnsettledHeartbeatAttempt(this.db, row.taskName);\n      if (unsettledAttempt) {\n        if (!row.leaseOwner) {\n          const dedupKey = `heartbeat-attempt-in-doubt:${row.taskName}:${unsettledAttempt.id}`;\n          if (insertDedupKey(this.db, dedupKey, row.taskName, 24 * 60 * 60 * 1000)) {\n            insertWakeEvent(\n              this.db,\n              "heartbeat_recovery",\n              `Heartbeat task '${row.taskName}' has an unsettled durable attempt; automatic redispatch is blocked pending reconciliation.`,\n              {\n                taskName: row.taskName,\n                correlationId: unsettledAttempt.correlationId,\n                attemptEventId: unsettledAttempt.id,\n                state: "attempt_in_doubt",\n              },\n            );\n          }\n        }\n        return false;\n      }\n\n      // Skip tasks that require a higher survival tier\n''',
)

execute_start = '''  /**\n   * Execute a single task with timeout and lease.\n   */\n  async executeTask(taskName: string, ctx: TickContext): Promise<void> {'''
execute_end = '''  /**\n   * Acquire a lease for a task.\n   */'''
execute_replacement = '''  /**\n   * Execute a single task with timeout and lease.\n   */\n  async executeTask(taskName: string, ctx: TickContext): Promise<void> {\n    const taskFn = this.tasks.get(taskName);\n    if (!taskFn) return;\n\n    const schedule = getHeartbeatSchedule(this.db).find(\n      (r) => r.taskName === taskName,\n    );\n    const timeoutMs = schedule?.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;\n\n    // Acquire lease before publishing an attempt. A failed evidence write must\n    // release this lease and must never reach the effecting task function.\n    if (!this.acquireLease(taskName)) return;\n\n    const startedAt = new Date().toISOString();\n    const startMs = Date.now();\n    const historyId = generateId();\n    const correlationId = correlationIdFor("heartbeat_history", historyId);\n    let attemptEvidence: EvidenceEventRecord;\n\n    try {\n      attemptEvidence = this.db.transaction(() => {\n        // A persisted nextRunAt represents one pending retry slot. Consume it\n        // atomically with the next durable attempt intent.\n        if (schedule?.nextRunAt) {\n          updateHeartbeatSchedule(this.db, taskName, { nextRunAt: null });\n        }\n        return appendEvidenceEvent(this.db, {\n          correlationId,\n          eventType: "heartbeat.attempt_started",\n          domain: "heartbeat",\n          authorityType: "heartbeat_schedule",\n          authorityId: taskName,\n          epistemicStatus: "observation",\n          payload: { startedAt, timeoutMs },\n        });\n      })();\n    } catch (error) {\n      this.releaseLease(taskName);\n      throw error;\n    }\n\n    const abortController = new AbortController();\n    const taskContext: TickContext = {\n      ...ctx,\n      abortSignal: abortController.signal,\n    };\n    // No external/task effect is started until the intent above is durable.\n    const executionPromise = Promise.resolve().then(() =>\n      taskFn(taskContext, this.legacyContext),\n    );\n    const timeout = timeoutPromise(timeoutMs, () => abortController.abort());\n    let timedOut = false;\n    let timeoutHistoryPersisted = false;\n\n    try {\n      let rejected = false;\n      let executionError: unknown;\n      let result: Awaited<ReturnType<HeartbeatTaskFn>> | undefined;\n      try {\n        result = await Promise.race([executionPromise, timeout.promise]);\n      } catch (error) {\n        rejected = true;\n        executionError = error;\n      }\n\n      const durationMs = Date.now() - startMs;\n      if (rejected) {\n        const error = executionError instanceof Error\n          ? executionError\n          : new Error(String(executionError));\n        timedOut = error instanceof HeartbeatTaskTimeoutError;\n        this.recordFailure(\n          taskName,\n          error,\n          durationMs,\n          startedAt,\n          timedOut ? "timeout" : "failure",\n          historyId,\n          attemptEvidence.id,\n        );\n        timeoutHistoryPersisted = timedOut;\n\n        // maxRetries means retries AFTER the initial attempt. Since history\n        // includes the current failure, <= preserves exactly that semantic.\n        if (schedule && schedule.maxRetries > 0) {\n          const history = this.getRecentFailures(taskName);\n          if (history <= schedule.maxRetries) {\n            this.scheduleRetry(taskName);\n          }\n        }\n        return;\n      }\n\n      // Outcome persistence is deliberately outside the execution catch path.\n      // If durable evidence fails after an external success, preserve the\n      // unresolved start intent instead of fabricating a task failure.\n      this.recordSuccess(\n        taskName,\n        durationMs,\n        startedAt,\n        historyId,\n        attemptEvidence.id,\n      );\n\n      if (result?.shouldWake) {\n        const reason = result.message || `Heartbeat task '${taskName}' requested wake`;\n        this.onWakeRequest?.(reason);\n        insertWakeEvent(this.db, "heartbeat", reason, { taskName });\n      }\n    } finally {\n      timeout.clear();\n      if (timedOut && timeoutHistoryPersisted) {\n        this.holdLeaseUntilTaskSettles(\n          taskName,\n          executionPromise,\n          historyId,\n          startMs,\n        );\n      } else {\n        this.releaseLease(taskName);\n      }\n    }\n  }\n\n'''
replace_between(execute_start, execute_end, execute_replacement)

record_start = '''  /**\n   * Record a successful task execution.\n   */\n  recordSuccess(taskName: string, durationMs: number, startedAt: string): void {'''
record_end = '''  /**\n   * Prune old history entries.\n   */'''
record_replacement = '''  /**\n   * Record a successful task execution.\n   */\n  recordSuccess(\n    taskName: string,\n    durationMs: number,\n    startedAt: string,\n    historyId = generateId(),\n    causationId: string | null = null,\n  ): void {\n    const now = new Date().toISOString();\n    const correlationId = correlationIdFor("heartbeat_history", historyId);\n\n    this.db.transaction(() => {\n      insertHeartbeatHistory(this.db, {\n        id: historyId,\n        taskName,\n        startedAt,\n        completedAt: now,\n        result: "success",\n        durationMs,\n        error: null,\n        idempotencyKey: null,\n      });\n\n      updateHeartbeatSchedule(this.db, taskName, {\n        lastRunAt: now,\n        nextRunAt: null,\n        lastResult: "success",\n        lastError: null,\n        runCount: (this.getRunCount(taskName) ?? 0) + 1,\n      });\n\n      appendEvidenceEvent(this.db, {\n        correlationId,\n        causationId,\n        eventType: "heartbeat.succeeded",\n        domain: "heartbeat",\n        authorityType: "heartbeat_history",\n        authorityId: historyId,\n        epistemicStatus: "observation",\n        payload: { result: "success", durationMs, externalSettlement: "settled" },\n      });\n    })();\n  }\n\n  /**\n   * Record a failed task execution.\n   */\n  recordFailure(\n    taskName: string,\n    error: Error,\n    durationMs: number,\n    startedAt: string,\n    result: "failure" | "timeout" = "failure",\n    historyId = generateId(),\n    causationId: string | null = null,\n  ): string {\n    const now = new Date().toISOString();\n    const errorMessage = error.message || String(error);\n    const correlationId = correlationIdFor("heartbeat_history", historyId);\n\n    this.db.transaction(() => {\n      insertHeartbeatHistory(this.db, {\n        id: historyId,\n        taskName,\n        startedAt,\n        completedAt: now,\n        result,\n        durationMs,\n        error: errorMessage,\n        idempotencyKey: null,\n      });\n\n      updateHeartbeatSchedule(this.db, taskName, {\n        lastRunAt: now,\n        lastResult: result,\n        lastError: errorMessage,\n        failCount: (this.getFailCount(taskName) ?? 0) + 1,\n        runCount: (this.getRunCount(taskName) ?? 0) + 1,\n      });\n\n      appendEvidenceEvent(this.db, {\n        correlationId,\n        causationId,\n        eventType: result === "timeout" ? "heartbeat.timed_out" : "heartbeat.failed",\n        domain: "heartbeat",\n        authorityType: "heartbeat_history",\n        authorityId: historyId,\n        epistemicStatus: "observation",\n        payload: {\n          result,\n          durationMs,\n          externalSettlement: result === "timeout" ? "unknown" : "settled",\n        },\n      });\n    })();\n\n    logger.error(`Task '${taskName}' ${result}: ${errorMessage}`);\n    return historyId;\n  }\n\n'''
replace_between(record_start, record_end, record_replacement)

settle_start = '''  private holdLeaseUntilTaskSettles(\n    taskName: string,'''
settle_end = '''  private getRunCount(taskName: string): number {'''
settle_replacement = '''  private holdLeaseUntilTaskSettles(\n    taskName: string,\n    executionPromise: Promise<{ shouldWake: boolean; message?: string }>,\n    timeoutHistoryId: string,\n    startMs: number,\n  ): void {\n    const renew = () => {\n      try {\n        return renewTaskLease(\n          this.db,\n          taskName,\n          this.ownerId,\n          LEASE_TTL_MS,\n        );\n      } catch (error) {\n        logger.error(\n          `Failed to renew timed-out task lease for '${taskName}'`,\n          error instanceof Error ? error : undefined,\n        );\n        return false;\n      }\n    };\n\n    renew();\n    const renewalTimer = setInterval(() => {\n      if (!renew()) clearInterval(renewalTimer);\n    }, LEASE_RENEW_INTERVAL_MS);\n    (renewalTimer as unknown as { unref?: () => void }).unref?.();\n\n    const settle = (completedLate: boolean, error?: unknown) => {\n      clearInterval(renewalTimer);\n      const now = new Date().toISOString();\n      const durationMs = Date.now() - startMs;\n      const correlationId = correlationIdFor("heartbeat_history", timeoutHistoryId);\n      const chain = getEvidenceByCorrelation(this.db, correlationId);\n      const causationId = chain.at(-1)?.id ?? null;\n\n      try {\n        this.db.transaction(() => {\n          if (completedLate) {\n            this.db.prepare(\n              `UPDATE heartbeat_history\n               SET result = 'success', completed_at = ?, duration_ms = ?, error = NULL\n               WHERE id = ? AND result = 'timeout'`,\n            ).run(now, durationMs, timeoutHistoryId);\n            updateHeartbeatSchedule(this.db, taskName, {\n              lastRunAt: now,\n              nextRunAt: null,\n              lastResult: "success",\n              lastError: null,\n            });\n            appendEvidenceEvent(this.db, {\n              correlationId,\n              causationId,\n              eventType: "heartbeat.late_succeeded",\n              domain: "heartbeat",\n              authorityType: "heartbeat_history",\n              authorityId: timeoutHistoryId,\n              epistemicStatus: "observation",\n              payload: { result: "success", durationMs, externalSettlement: "settled_late" },\n            });\n          } else {\n            const errorMessage = error instanceof Error ? error.message : String(error);\n            this.db.prepare(\n              `UPDATE heartbeat_history\n               SET result = 'failure', completed_at = ?, duration_ms = ?, error = ?\n               WHERE id = ? AND result = 'timeout'`,\n            ).run(now, durationMs, errorMessage, timeoutHistoryId);\n            updateHeartbeatSchedule(this.db, taskName, {\n              lastRunAt: now,\n              lastResult: "failure",\n              lastError: errorMessage,\n            });\n            appendEvidenceEvent(this.db, {\n              correlationId,\n              causationId,\n              eventType: "heartbeat.late_failed",\n              domain: "heartbeat",\n              authorityType: "heartbeat_history",\n              authorityId: timeoutHistoryId,\n              epistemicStatus: "observation",\n              payload: { result: "failure", durationMs, externalSettlement: "settled_late" },\n            });\n          }\n        })();\n\n        if (completedLate) {\n          logger.warn(\n            `Task '${taskName}' completed after its timeout; durable timeout reconciled to success and pending retry suppressed`,\n          );\n        } else {\n          logger.warn(\n            `Task '${taskName}' settled with an error after its timeout; durable timeout reconciled to failure`,\n            { error: error instanceof Error ? error.message : String(error) },\n          );\n        }\n      } catch (persistError) {\n        // Keep the timeout/in-doubt authority unchanged if reconciliation cannot\n        // be persisted atomically. A later scheduler will surface recovery.\n        logger.error(\n          `Failed to persist late settlement for '${taskName}'`,\n          persistError instanceof Error ? persistError : undefined,\n        );\n      } finally {\n        this.releaseLease(taskName);\n      }\n    };\n\n    executionPromise.then(\n      () => settle(true),\n      (error) => settle(false, error),\n    );\n  }\n\n'''
replace_between(settle_start, settle_end, settle_replacement)

SCHEDULER.write_text(text, encoding="utf-8")

TEST = ROOT / "src/__tests__/p013-heartbeat-correlation.test.ts"
TEST.write_text(r'''import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DurableScheduler } from "../heartbeat/scheduler.js";
import {
  getHeartbeatHistory,
  getHeartbeatSchedule,
  getUnconsumedWakeEvents,
  upsertHeartbeatSchedule,
} from "../state/database.js";
import {
  appendEvidenceEvent,
  getEvidenceByCorrelation,
} from "../observability/evidence.js";
import type {
  AbosDatabase,
  HeartbeatConfig,
  HeartbeatLegacyContext,
  HeartbeatTaskFn,
  TickContext,
} from "../types.js";
import {
  createTestConfig,
  createTestDb,
  createTestIdentity,
  MockConwayClient,
} from "./mocks.js";

const config: HeartbeatConfig = {
  entries: [],
  defaultIntervalMs: 60_000,
  lowComputeMultiplier: 4,
};

function context(db: AbosDatabase): TickContext {
  return {
    tickId: "p013-heartbeat-tick",
    startedAt: new Date(),
    creditBalance: 10_000,
    usdcBalance: 100,
    survivalTier: "normal",
    lowComputeMultiplier: 4,
    config,
    db: db.raw,
  };
}

function seed(db: AbosDatabase, taskName: string, timeoutMs = 1_000): void {
  upsertHeartbeatSchedule(db.raw, {
    taskName,
    cronExpression: "* * * * *",
    intervalMs: null,
    enabled: 1,
    priority: 0,
    timeoutMs,
    maxRetries: 1,
    tierMinimum: "dead",
    lastRunAt: null,
    nextRunAt: null,
    lastResult: null,
    lastError: null,
    runCount: 0,
    failCount: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
  });
}

describe("P-013 heartbeat correlation", () => {
  let db: AbosDatabase;
  let legacy: HeartbeatLegacyContext;

  beforeEach(() => {
    db = createTestDb();
    legacy = {
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway: new MockConwayClient(),
    };
  });

  afterEach(() => db.close());

  it("persists a durable attempt intent before executing the task and links the canonical success", async () => {
    seed(db, "evidence_success");
    let observedIntent = false;
    const task: HeartbeatTaskFn = async () => {
      const count = db.raw.prepare(
        "SELECT COUNT(*) AS count FROM evidence_events WHERE event_type = 'heartbeat.attempt_started'",
      ).get() as { count: number };
      observedIntent = count.count === 1;
      return { shouldWake: false };
    };
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["evidence_success", task]]),
      legacy,
    );

    await scheduler.executeTask("evidence_success", context(db));

    expect(observedIntent).toBe(true);
    const history = getHeartbeatHistory(db.raw, "evidence_success");
    expect(history).toHaveLength(1);
    expect(history[0]?.result).toBe("success");
    const correlationId = `heartbeat_history:${history[0]!.id}`;
    const events = getEvidenceByCorrelation(db.raw, correlationId);
    expect(events.map((event) => event.eventType)).toEqual([
      "heartbeat.attempt_started",
      "heartbeat.succeeded",
    ]);
    expect(events[0]?.authorityType).toBe("heartbeat_schedule");
    expect(events[0]?.authorityId).toBe("evidence_success");
    expect(events[1]?.authorityType).toBe("heartbeat_history");
    expect(events[1]?.authorityId).toBe(history[0]!.id);
    expect(events[1]?.causationId).toBe(events[0]!.id);
  });

  it("blocks redispatch after restart when a durable start has no settlement", () => {
    seed(db, "crash_after_start");
    appendEvidenceEvent(db.raw, {
      correlationId: "heartbeat_history:future-history-id",
      eventType: "heartbeat.attempt_started",
      domain: "heartbeat",
      authorityType: "heartbeat_schedule",
      authorityId: "crash_after_start",
      payload: { startedAt: new Date().toISOString(), timeoutMs: 1000 },
    });
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["crash_after_start", async () => ({ shouldWake: false })]]),
      legacy,
    );

    expect(scheduler.getDueTasks(context(db))).toHaveLength(0);
    expect(scheduler.getDueTasks(context(db))).toHaveLength(0);
    const wakes = getUnconsumedWakeEvents(db.raw);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]?.source).toBe("heartbeat_recovery");
    expect(wakes[0]?.reason).toContain("unsettled durable attempt");
  });

  it("keeps timeout and late success on one history authority and one causal chain", async () => {
    seed(db, "late_success_p013", 15);
    let release!: () => void;
    const task: HeartbeatTaskFn = async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return { shouldWake: false };
    };
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["late_success_p013", task]]),
      legacy,
    );

    await scheduler.executeTask("late_success_p013", context(db));
    let history = getHeartbeatHistory(db.raw, "late_success_p013");
    expect(history).toHaveLength(1);
    expect(history[0]?.result).toBe("timeout");
    const correlationId = `heartbeat_history:${history[0]!.id}`;
    expect(getEvidenceByCorrelation(db.raw, correlationId).map((event) => event.eventType)).toEqual([
      "heartbeat.attempt_started",
      "heartbeat.timed_out",
    ]);

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    history = getHeartbeatHistory(db.raw, "late_success_p013");
    expect(history).toHaveLength(1);
    expect(history[0]?.result).toBe("success");
    const events = getEvidenceByCorrelation(db.raw, correlationId);
    expect(events.map((event) => event.eventType)).toEqual([
      "heartbeat.attempt_started",
      "heartbeat.timed_out",
      "heartbeat.late_succeeded",
    ]);
    expect(events[2]?.authorityId).toBe(history[0]!.id);
    expect(events[2]?.causationId).toBe(events[1]!.id);
  });

  it("does not turn an externally successful task into false failure when success evidence cannot commit", async () => {
    seed(db, "success_persist_failure");
    let executions = 0;
    db.raw.exec(`
      CREATE TRIGGER reject_heartbeat_success_evidence
      BEFORE INSERT ON evidence_events
      WHEN NEW.event_type = 'heartbeat.succeeded'
      BEGIN
        SELECT RAISE(ABORT, 'intentional heartbeat success evidence failure');
      END;
    `);
    const task: HeartbeatTaskFn = async () => {
      executions += 1;
      return { shouldWake: false };
    };
    const scheduler = new DurableScheduler(
      db.raw,
      config,
      new Map([["success_persist_failure", task]]),
      legacy,
    );

    await expect(
      scheduler.executeTask("success_persist_failure", context(db)),
    ).rejects.toThrow("intentional heartbeat success evidence failure");

    expect(executions).toBe(1);
    expect(getHeartbeatHistory(db.raw, "success_persist_failure")).toHaveLength(0);
    const schedule = getHeartbeatSchedule(db.raw).find(
      (row) => row.taskName === "success_persist_failure",
    );
    expect(schedule?.lastResult).toBeNull();
    expect(schedule?.leaseOwner).toBeNull();
    expect(scheduler.getDueTasks(context(db))).toHaveLength(0);

    const attempts = db.raw.prepare(
      "SELECT correlation_id FROM evidence_events WHERE event_type = 'heartbeat.attempt_started' AND authority_id = ?",
    ).all("success_persist_failure") as Array<{ correlation_id: string }>;
    expect(attempts).toHaveLength(1);
    expect(getEvidenceByCorrelation(db.raw, attempts[0]!.correlation_id).map((event) => event.eventType)).toEqual([
      "heartbeat.attempt_started",
    ]);
  });
});
''', encoding="utf-8")

print("P013_HEARTBEAT_APPLY: PASS")
