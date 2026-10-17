import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase, getTaskById, insertTask } from "../state/database.js";
import { createGoal, completeTask, type TaskNode, type TaskResult } from "../orchestration/task-graph.js";
import {
  claimStandaloneTaskAttempt, persistStandaloneTaskResult,
} from "../orchestration/standalone-task-receipt.js";

function parentTask(retryCount = 0): TaskNode {
  return {
    id: "parent-task", parentId: null, goalId: "parent-goal",
    title: "Remote work", description: "May have external side effects",
    status: "assigned", assignedTo: "local://remote-worker", agentRole: "generalist",
    priority: 50, dependencies: [], result: null,
    strategicPathId: "path-a", requiredCapabilities: ["compute"],
    preferredEnvironment: "aws",
    metadata: {
      estimatedCostCents: 0, actualCostCents: 0,
      maxRetries: 2, retryCount, timeoutMs: 60000,
      createdAt: "2026-10-16T00:00:00.000Z", startedAt: null, completedAt: null,
    },
  };
}

const result: TaskResult = {
  success: true, output: "completed once", artifacts: [], costCents: 0, duration: 5,
};

describe("P-031 standalone worker durable same-generation idempotency", () => {
  it("atomically claims, settles and replays one Task attempt across SQLite reopen without repeating its mirror work", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p031-standalone-replay-"));
    const file = path.join(root, "state.db");
    let db = createDatabase(file);
    try {
      const incoming = parentTask();
      const claim = claimStandaloneTaskAttempt(db.raw, incoming);
      expect(claim.kind).toBe("claimed");
      if (claim.kind !== "claimed") throw new Error("wrong claim type");
      const goal = createGoal(db.raw, "remote goal", "mirror");
      const mirrorTaskId = insertTask(db.raw, {
        goalId: goal.id, title: "remote Task mirror", description: "one execution",
        status: "assigned",
      });
      db.raw.transaction(() => {
        completeTask(db.raw, mirrorTaskId, result);
        persistStandaloneTaskResult(
          db.raw, incoming, claim.key, claim.fingerprint, result,
        );
      })();
      db.close();
      db = createDatabase(file);
      const replay = claimStandaloneTaskAttempt(db.raw, parentTask());
      expect(replay).toEqual({ kind: "replay", result });
      expect(getTaskById(db.raw, mirrorTaskId)?.status).toBe("completed");
      const count = db.raw.prepare("SELECT COUNT(*) AS n FROM task_graph").get() as { n: number };
      expect(count.n).toBe(1);
      expect((db.raw.prepare("SELECT COUNT(*) AS n FROM financial_effects").get() as {n:number}).n).toBe(0);
    } finally {
      db.close(); fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a possibly interrupted execution instead of blindly replaying it after restart", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p031-standalone-interrupted-"));
    const file = path.join(root, "state.db");
    let db = createDatabase(file);
    try {
      const claim = claimStandaloneTaskAttempt(db.raw, parentTask());
      expect(claim.kind).toBe("claimed");
      db.close();
      db = createDatabase(file);
      expect(() => claimStandaloneTaskAttempt(db.raw, parentTask()))
        .toThrow(/outcome UNKNOWN.*blind replay/);
      // A new authorized retry generation is independent, not a duplicate
      // of the unknown-completion attempt.
      expect(claimStandaloneTaskAttempt(db.raw, parentTask(1)).kind).toBe("claimed");
      expect(() => claimStandaloneTaskAttempt(db.raw, parentTask()))
        .toThrow(/outcome UNKNOWN.*blind replay/);
    } finally {
      db.close(); fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed for changed same-generation envelope and malformed prior result", () => {
    const db = createDatabase(":memory:");
    try {
      const task = parentTask();
      const claim = claimStandaloneTaskAttempt(db.raw, task);
      if (claim.kind !== "claimed") throw new Error("wrong claim type");
      expect(() => claimStandaloneTaskAttempt(db.raw, {
        ...task, description: "Changed executable content",
      })).toThrow(/conflicts with incoming Task identity/);
      expect(() => persistStandaloneTaskResult(
        db.raw, task, "foreign-key", claim.fingerprint, result,
      )).toThrow(/invalid Task identity/);
      db.raw.prepare("UPDATE kv SET value = ? WHERE key = ?").run(
        JSON.stringify({
          version: 1, state: "result", fingerprint: claim.fingerprint,
          goalId: task.goalId, taskId: task.id, retryCount: 0,
          result: { success: "not-a-boolean" },
        }), claim.key,
      );
      expect(() => claimStandaloneTaskAttempt(db.raw, task))
        .toThrow(/no valid durable TaskResult/);
    } finally {
      db.close();
    }
  });
});
