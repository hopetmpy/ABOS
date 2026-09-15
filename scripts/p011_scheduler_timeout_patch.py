from pathlib import Path

p = Path('src/heartbeat/scheduler.ts')
s = p.read_text()

def r(before: str, after: str) -> None:
    global s
    count = s.count(before)
    if count != 1:
        raise RuntimeError(f'expected one anchor, found {count}: {before[:120]!r}')
    s = s.replace(before, after, 1)

r(
'''  pruneExpiredDedupKeys,\n  insertWakeEvent,\n''',
'''  pruneExpiredDedupKeys,\n  insertDedupKey,\n  insertWakeEvent,\n''')

r(
'''      // Skip tasks that require a higher survival tier\n      if (!tierMeetsMinimum(context.survivalTier, row.tierMinimum)) return false;\n\n      // Skip if lease is held by someone else\n''',
'''      // Skip tasks that require a higher survival tier\n      if (!tierMeetsMinimum(context.survivalTier, row.tierMinimum)) return false;\n\n      // A timeout is an in-doubt effect, not proof that the task stopped.\n      // While the original process is alive the lease remains held. If that\n      // supervisor crashes, the durable timeout survives lease expiry and\n      // still blocks redispatch until some new evidence reconciles the outcome.\n      if (row.lastResult === "timeout") {\n        if (!row.leaseOwner) {\n          const dedupKey = `heartbeat-timeout-in-doubt:${row.taskName}:${row.lastRunAt ?? "unknown"}`;\n          if (insertDedupKey(this.db, dedupKey, row.taskName, 24 * 60 * 60 * 1000)) {\n            insertWakeEvent(\n              this.db,\n              "heartbeat_recovery",\n              `Heartbeat task '${row.taskName}' remains in-doubt after timeout; automatic redispatch is blocked pending reconciliation.`,\n              { taskName: row.taskName, lastRunAt: row.lastRunAt, state: "timeout_in_doubt" },\n            );\n          }\n        }\n        return false;\n      }\n\n      // Skip if lease is held by someone else\n''')

r(
'''    let timedOut = false;\n\n    try {\n''',
'''    let timedOut = false;\n    let timeoutHistoryId: string | null = null;\n\n    try {\n''')

r(
'''      this.recordFailure(\n        taskName,\n        err,\n        durationMs,\n        startedAt,\n        timedOut ? "timeout" : "failure",\n      );\n''',
'''      const failureHistoryId = this.recordFailure(\n        taskName,\n        err,\n        durationMs,\n        startedAt,\n        timedOut ? "timeout" : "failure",\n      );\n      if (timedOut) timeoutHistoryId = failureHistoryId;\n''')

r(
'''        this.holdLeaseUntilTaskSettles(\n          taskName,\n          executionPromise,\n        );\n''',
'''        this.holdLeaseUntilTaskSettles(\n          taskName,\n          executionPromise,\n          timeoutHistoryId!,\n          startMs,\n        );\n''')

r(
'''  recordFailure(\n    taskName: string,\n    error: Error,\n    durationMs: number,\n    startedAt: string,\n    result: "failure" | "timeout" = "failure",\n  ): void {\n    const now = new Date().toISOString();\n    const errorMessage = error.message || String(error);\n\n    insertHeartbeatHistory(this.db, {\n      id: generateId(),\n''',
'''  recordFailure(\n    taskName: string,\n    error: Error,\n    durationMs: number,\n    startedAt: string,\n    result: "failure" | "timeout" = "failure",\n  ): string {\n    const now = new Date().toISOString();\n    const errorMessage = error.message || String(error);\n    const historyId = generateId();\n\n    insertHeartbeatHistory(this.db, {\n      id: historyId,\n''')

r(
'''    logger.error(`Task '${taskName}' ${result}: ${errorMessage}`);\n  }\n''',
'''    logger.error(`Task '${taskName}' ${result}: ${errorMessage}`);\n    return historyId;\n  }\n''')

r(
'''  private holdLeaseUntilTaskSettles(\n    taskName: string,\n    executionPromise: Promise<{ shouldWake: boolean; message?: string }>,\n  ): void {\n''',
'''  private holdLeaseUntilTaskSettles(\n    taskName: string,\n    executionPromise: Promise<{ shouldWake: boolean; message?: string }>,\n    timeoutHistoryId: string,\n    startMs: number,\n  ): void {\n''')

r(
'''    const settle = (completedLate: boolean, error?: unknown) => {\n      clearInterval(renewalTimer);\n\n      if (completedLate) {\n        // The operation did finish, so a timeout retry would duplicate work.\n        updateHeartbeatSchedule(this.db, taskName, { nextRunAt: null });\n        logger.warn(\n          `Task '${taskName}' completed after its timeout; pending retry suppressed to avoid duplicate effects`,\n        );\n      } else {\n        logger.warn(\n          `Task '${taskName}' settled with an error after its timeout`,\n          {\n            error: error instanceof Error ? error.message : String(error),\n          },\n        );\n      }\n\n      this.releaseLease(taskName);\n    };\n''',
'''    const settle = (completedLate: boolean, error?: unknown) => {\n      clearInterval(renewalTimer);\n      const now = new Date().toISOString();\n      const durationMs = Date.now() - startMs;\n\n      if (completedLate) {\n        // Reconcile the durable in-doubt row to the final observed settlement.\n        // This is not a second attempt: it is the original promise resolving.\n        this.db.prepare(\n          `UPDATE heartbeat_history\n           SET result = 'success', completed_at = ?, duration_ms = ?, error = NULL\n           WHERE id = ? AND result = 'timeout'`,\n        ).run(now, durationMs, timeoutHistoryId);\n        updateHeartbeatSchedule(this.db, taskName, {\n          lastRunAt: now,\n          nextRunAt: null,\n          lastResult: "success",\n          lastError: null,\n        });\n        logger.warn(\n          `Task '${taskName}' completed after its timeout; durable timeout reconciled to success and pending retry suppressed`,\n        );\n      } else {\n        const errorMessage = error instanceof Error ? error.message : String(error);\n        this.db.prepare(\n          `UPDATE heartbeat_history\n           SET result = 'failure', completed_at = ?, duration_ms = ?, error = ?\n           WHERE id = ? AND result = 'timeout'`,\n        ).run(now, durationMs, errorMessage, timeoutHistoryId);\n        updateHeartbeatSchedule(this.db, taskName, {\n          lastRunAt: now,\n          lastResult: "failure",\n          lastError: errorMessage,\n        });\n        logger.warn(\n          `Task '${taskName}' settled with an error after its timeout; durable timeout reconciled to failure`,\n          { error: errorMessage },\n        );\n      }\n\n      this.releaseLease(taskName);\n    };\n''')

p.write_text(s)
print('patched scheduler timeout crash semantics')
