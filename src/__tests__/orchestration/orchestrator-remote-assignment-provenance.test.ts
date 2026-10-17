import { describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../../orchestration/orchestrator-core.js";
import type { AgentMessage, ProcessedMessage } from "../../orchestration/messaging.js";
import { createInMemoryDb } from "./test-db.js";
import { createGoal } from "../../orchestration/task-graph.js";
import { getTaskById, insertTask } from "../../state/database.js";

function fixture() {
  const db = createInMemoryDb();
  const goal = createGoal(db, "Provider-neutral task", "Verify remote identity");
  const taskId = insertTask(db, {
    goalId: goal.id, title: "remote task", description: "remote result",
    status: "assigned", assignedTo: "0xchild", retryCount: 1,
  });
  const inbox: ProcessedMessage[] = [];
  const sent: AgentMessage[] = [];
  const messaging = {
    processInbox: vi.fn(async () => inbox.splice(0)),
    send: vi.fn(async (message: AgentMessage) => { sent.push(message); }),
    createMessage: vi.fn((params: Record<string, unknown>) => ({
      id: "assignment-new",
      type: params.type, from: "0xparent", to: params.to,
      goalId: params.goalId ?? null, taskId: params.taskId ?? null,
      content: params.content, priority: "high",
      requiresResponse: true, expiresAt: null, createdAt: new Date().toISOString(),
    } as AgentMessage)),
  };
  const tracker = {
    getIdle: vi.fn(() => [{ address: "0xchild", name: "child", role: "generalist", status: "healthy" }]),
    getBestForTask: vi.fn(() => null),
    updateStatus: vi.fn(), register: vi.fn(),
  };
  const orchestrator = new Orchestrator({
    db,
    agentTracker: tracker as any,
    funding: { fundChild: async () => ({ success: true }), recallCredits: async () => ({ success: true, amountCents: 0 }), getBalance: async () => 0 } as any,
    messaging: messaging as any,
    inference: { chat: vi.fn(), bindEvidenceDatabase: vi.fn() } as any,
    identity: { address: "0xparent", name: "parent" } as any,
    config: { defaultTaskFundingCents: 0 },
  });
  function resultMessage(assignmentMessageId: string | null, options: {
    from?: string; taskId?: string; body?: unknown;
  } = {}): AgentMessage {
    const { from = "0xchild", taskId: incomingTaskId = taskId } = options;
    return {
      id: "result-" + (assignmentMessageId ?? "missing"),
      type: "task_result", from, to: "0xparent", goalId: goal.id, taskId: incomingTaskId,
      content: options.body === undefined
        ? JSON.stringify({
          taskId: incomingTaskId, ...(assignmentMessageId ? { assignmentMessageId } : {}),
          result: { success: true, output: "work complete", artifacts: [], costCents: 0, duration: 1 },
        }) : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
      priority: "high", requiresResponse: false, expiresAt: null, createdAt: new Date().toISOString(),
    };
  }
  function receipt(messageId = "assignment-new", retryCount = 1) {
    db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)").run(
      "orchestrator.colony_assignment." + taskId,
      JSON.stringify({ messageId, retryCount, taskId, goalId: goal.id, workerAddress: "0xchild" }),
    );
  }
  return { db, goal, taskId, inbox, sent, orchestrator, receipt, resultMessage, tracker, messaging };
}

describe("P-031 Colony assignment/result provenance", () => {
  it("ignores an earlier reply from the same agent after retry but accepts the current assignment", async () => {
    const t = fixture();
    try {
      t.receipt("assignment-new", 1);
      t.inbox.push({ message: t.resultMessage("assignment-old"), handledBy: "task_result", success: true });
      expect(await t.orchestrator.collectResults()).toEqual([]);
      expect(getTaskById(t.db, t.taskId)?.status).toBe("assigned");

      t.inbox.push({ message: t.resultMessage("assignment-new"), handledBy: "task_result", success: true });
      const accepted = await t.orchestrator.collectResults();
      expect(accepted).toHaveLength(1);
      expect(accepted[0]?.success).toBe(true);
      expect(accepted[0]?.output).toBe("work complete");

      t.receipt("assignment-new", 2);
      t.inbox.push({ message: t.resultMessage("assignment-new"), handledBy: "task_result", success: true });
      expect(await t.orchestrator.collectResults()).toEqual([]);
      // A forged outer Task ID cannot authorize the inner Task ID.
      t.receipt("assignment-new", 1);
      t.inbox.push({
        message: t.resultMessage("assignment-new", {
          body: { taskId: "other-task", assignmentMessageId: "assignment-new",
            result: { success: true, output: "fake" } },
        }), handledBy: "task_result", success: true,
      });
      expect(await t.orchestrator.collectResults()).toEqual([]);
    } finally { t.db.close(); }
  });

  it("accepts only the most recent canonical sent assignment event when there is no KV receipt", async () => {
    const t = fixture();
    try {
      t.db.prepare("INSERT INTO event_stream (id, type, agent_address, goal_id, task_id, content, token_count, created_at) VALUES (?, 'action', ?, ?, ?, ?, 1, datetime('now'))")
        .run("evt-old", "0xparent", t.goal.id, t.taskId,
          JSON.stringify({ action: "message_sent", messageType: "task_assignment", messageId: "assignment-old", to: "0xchild" }));
      t.db.prepare("INSERT INTO event_stream (id, type, agent_address, goal_id, task_id, content, token_count, created_at) VALUES (?, 'action', ?, ?, ?, ?, 1, datetime('now'))")
        .run("evt-new", "0xparent", t.goal.id, t.taskId,
          JSON.stringify({ action: "message_sent", messageType: "task_assignment", messageId: "assignment-new", to: "0xchild" }));
      // No current transport receipt: the journal does not prove a retry
      // generation. With retries recorded, both remain unverified.
      t.inbox.push({ message: t.resultMessage("assignment-new"), handledBy: "task_result", success: true });
      expect(await t.orchestrator.collectResults()).toEqual([]);
      t.db.prepare("UPDATE task_graph SET retry_count = 0 WHERE id = ?").run(t.taskId);
      t.inbox.push({ message: t.resultMessage("assignment-old"), handledBy: "task_result", success: true });
      expect(await t.orchestrator.collectResults()).toEqual([]);
      t.inbox.push({ message: t.resultMessage("assignment-new"), handledBy: "task_result", success: true });
      expect(await t.orchestrator.collectResults()).toHaveLength(1);
    } finally { t.db.close(); }
  });

  it("never treats unstructured text or missing success as an authenticated successful result", async () => {
    const t = fixture();
    try {
      t.receipt();
      t.inbox.push({ message: t.resultMessage("assignment-new", { body: "done" }), handledBy: "task_result", success: true });
      t.inbox.push({ message: t.resultMessage("assignment-new", { body: {
        taskId: t.taskId, assignmentMessageId: "assignment-new", result: { output: "done" },
      } }), handledBy: "task_result", success: true });
      t.inbox.push({ message: t.resultMessage(null), handledBy: "task_result", success: true });
      expect(await t.orchestrator.collectResults()).toEqual([]);
      expect(getTaskById(t.db, t.taskId)?.status).toBe("assigned");
    } finally { t.db.close(); }
  });

  it("uses the canonical Task envelope and persists the latest assignment message before dispatch", async () => {
    const t = fixture();
    try {
      t.db.prepare("UPDATE task_graph SET status = 'pending', assigned_to = NULL WHERE id = ?").run(t.taskId);
      t.db.prepare(
        "INSERT OR REPLACE INTO kv (key,value,updated_at) VALUES ('orchestrator.state', ?, datetime('now'))",
      ).run(JSON.stringify({ phase: "executing", goalId: t.goal.id, replanCount: 0, failedTaskId: null, failedError: null }));
      const result = await t.orchestrator.tick();
      expect(result.tasksAssigned).toBe(1);
      expect(t.sent).toHaveLength(1);
      const payload = JSON.parse(t.sent[0]!.content);
      expect(payload.protocol).toBe("abos_task_execution_v1");
      expect(payload.task.id).toBe(t.taskId);
      expect(payload.task.metadata.retryCount).toBe(1);
      const row = t.db.prepare("SELECT value FROM kv WHERE key = ?")
        .get("orchestrator.colony_assignment." + t.taskId) as { value: string } | undefined;
      expect(JSON.parse(row!.value)).toMatchObject({
        messageId: "assignment-new", taskId: t.taskId, goalId: t.goal.id,
        retryCount: 1, workerAddress: "0xchild",
      });
    } finally { t.db.close(); }
  });
});
