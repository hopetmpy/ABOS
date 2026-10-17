import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase, getTaskById, insertTask } from "../state/database.js";
import { getEvidenceByAuthority } from "../observability/evidence.js";
import {
  assignTask, completeTask, createGoal, failTask, startLocalTaskExecution,
} from "../orchestration/task-graph.js";

describe("P-031 persisted local worker attempt evidence", () => {
  it("retains an observed first attempt across retry, process restart and subsequent completion", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p031-worker-attempts-"));
    const location = path.join(root, "state.sqlite");
    let db = createDatabase(location);
    try {
      const goal = createGoal(db.raw, "durable objective", "retry after worker failure");
      const taskId = insertTask(db.raw, {
        goalId: goal.id, title: "task", description: "work",
        status: "assigned", assignedTo: "local://worker-1", maxRetries: 1,
      });
      startLocalTaskExecution(db.raw, taskId, "local://worker-1");
      const start = getTaskById(db.raw, taskId)?.startedAt;
      expect(start).toBeTruthy();
      failTask(db.raw, taskId, "recoverable failure", true);
      expect(getTaskById(db.raw, taskId)?.startedAt).toBeNull();
      db.close();

      // New SQLite connection: the cleared TaskGraph projection cannot
      // reconstruct the first start, but existing P-013 event authority can.
      db = createDatabase(location);
      const previous = getEvidenceByAuthority(db.raw, "task_graph", taskId);
      expect(previous.map(e => e.eventType)).toEqual([
        "task.local_harness_execution_started", "task.attempt_outcome_recorded",
      ]);
      expect((previous[1]!.payload as Record<string, unknown>).recordedStartedAt).toBe(start);
      expect((previous[1]!.payload as Record<string, unknown>).retryScheduled).toBe(true);
      expect(getTaskById(db.raw, taskId)?.retryCount).toBe(1);

      assignTask(db.raw, taskId, "local://worker-2");
      startLocalTaskExecution(db.raw, taskId, "local://worker-2");
      completeTask(db.raw, taskId, {
        success: true, output: "done", artifacts: [], costCents: 0, duration: 1,
      });
      const events = getEvidenceByAuthority(db.raw, "task_graph", taskId);
      expect(events).toHaveLength(4);
      expect(events[2]?.eventType).toBe("task.local_harness_execution_started");
      expect((events[3]!.payload as Record<string, unknown>).retryCountBeforeOutcome).toBe(1);
      expect((events[3]!.payload as Record<string, unknown>).providerBilledCost).toBe("UNKNOWN");
      expect(getTaskById(db.raw, taskId)?.status).toBe("completed");
      // E3 only: Task start is observed locally; no provider CPU/price proof.
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number }).n).toBe(0);
    } finally {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
