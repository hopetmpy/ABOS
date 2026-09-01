import { describe, expect, it, vi } from "vitest";
import type { AbosDatabase } from "../../types.js";
import type {
  AgentMessage,
  ColonyMessaging,
} from "../../orchestration/messaging.js";
import {
  createColonyTaskAssignmentConsumer,
} from "../../orchestration/colony-task-assignment.js";
import {
  createTaskExecutionEnvelope,
} from "../../orchestration/task-execution-envelope.js";
import type { TaskNode, TaskResult } from "../../orchestration/task-graph.js";

function task(): TaskNode {
  return {
    id: "task-1",
    parentId: null,
    goalId: "goal-1",
    title: "Continue work",
    description: "Continue the delegated objective.",
    status: "assigned",
    assignedTo: "0xchild",
    agentRole: "generalist",
    priority: 50,
    dependencies: [],
    result: null,
    requiredCapabilities: ["compute"],
    preferredEnvironment: "conway",
    strategicPathId: "path-1",
    metadata: {
      estimatedCostCents: 0,
      actualCostCents: 0,
      maxRetries: 0,
      retryCount: 0,
      timeoutMs: 60_000,
      createdAt: new Date(0).toISOString(),
      startedAt: null,
      completedAt: null,
    },
  };
}

function assignment(overrides: Partial<AgentMessage> = {}): AgentMessage {
  const transported = task();
  return {
    id: "assignment-1",
    type: "task_assignment",
    from: "0xparent",
    to: "0xchild",
    goalId: transported.goalId,
    taskId: transported.id,
    content: JSON.stringify(
      createTaskExecutionEnvelope(transported),
    ),
    priority: "high",
    requiresResponse: true,
    expiresAt: null,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function harness() {
  const kv = new Map<string, string>();
  let messageCounter = 0;
  const send = vi.fn().mockResolvedValue(undefined);
  const messaging = {
    createMessage: vi.fn((params: {
      type: AgentMessage["type"];
      to: string;
      content: string;
      goalId?: string;
      taskId?: string;
      priority?: AgentMessage["priority"];
      requiresResponse?: boolean;
      expiresAt?: string;
    }): AgentMessage => ({
      id: `result-${++messageCounter}`,
      type: params.type,
      from: "0xchild",
      to: params.to,
      goalId: params.goalId ?? null,
      taskId: params.taskId ?? null,
      content: params.content,
      priority: params.priority ?? "normal",
      requiresResponse: params.requiresResponse ?? false,
      expiresAt: params.expiresAt ?? null,
      createdAt: new Date().toISOString(),
    })),
    send,
  } as unknown as Pick<ColonyMessaging, "createMessage" | "send">;

  const db = {
    getKV: (key: string) => kv.get(key),
    setKV: (key: string, value: string) => {
      kv.set(key, value);
    },
  } as Pick<AbosDatabase, "getKV" | "setKV">;

  const executeTask = vi.fn(async (): Promise<TaskResult> => ({
    success: true,
    output: "completed by child",
    artifacts: ["/tmp/result.txt"],
    costCents: 4,
    duration: 125,
  }));

  const handler = createColonyTaskAssignmentConsumer({
    identityAddress: "0xchild",
    parentAddress: "0xparent",
    db,
    messaging,
    executeTask,
  });

  return { kv, messaging, send, executeTask, handler };
}

describe("Conway child structured Task assignment consumer", () => {
  it("executes an authorized canonical envelope and returns task_result to the parent", async () => {
    const ctx = harness();

    await ctx.handler(assignment());

    expect(ctx.executeTask).toHaveBeenCalledTimes(1);
    expect(ctx.send).toHaveBeenCalledTimes(1);

    const resultMessage = ctx.send.mock.calls[0]?.[0] as AgentMessage;
    expect(resultMessage.type).toBe("task_result");
    expect(resultMessage.to).toBe("0xparent");
    expect(resultMessage.goalId).toBe("goal-1");
    expect(resultMessage.taskId).toBe("task-1");

    const payload = JSON.parse(resultMessage.content);
    expect(payload.taskId).toBe("task-1");
    expect(payload.assignmentMessageId).toBe("assignment-1");
    expect(payload.result).toMatchObject({
      success: true,
      output: "completed by child",
      artifacts: ["/tmp/result.txt"],
    });
  });

  it("reuses the durable result receipt after delivery failure instead of executing the same Task twice", async () => {
    const ctx = harness();
    ctx.send
      .mockRejectedValueOnce(new Error("relay unavailable"))
      .mockResolvedValue(undefined);

    await expect(ctx.handler(assignment())).rejects.toThrow(
      /relay unavailable/i,
    );

    expect(ctx.executeTask).toHaveBeenCalledTimes(1);
    const firstResultMessage =
      ctx.send.mock.calls[0]?.[0] as AgentMessage;

    await ctx.handler(assignment());

    expect(ctx.executeTask).toHaveBeenCalledTimes(1);
    expect(ctx.send).toHaveBeenCalledTimes(2);
    const retriedResultMessage =
      ctx.send.mock.calls[1]?.[0] as AgentMessage;
    expect(retriedResultMessage.id).toBe(firstResultMessage.id);
    expect(retriedResultMessage.content).toBe(
      firstResultMessage.content,
    );
  });

  it("refuses blind replay when a prior attempt started but never recorded a durable result", async () => {
    const ctx = harness();
    ctx.kv.set(
      "colony.task_assignment.receipt.assignment-1",
      JSON.stringify({
        version: 1,
        state: "started",
        assignmentMessageId: "assignment-1",
        goalId: "goal-1",
        taskId: "task-1",
        pathId: "path-1",
        startedAt: "2026-09-01T10:00:00.000Z",
      }),
    );

    await ctx.handler(assignment());

    expect(ctx.executeTask).not.toHaveBeenCalled();
    const resultMessage = ctx.send.mock.calls[0]?.[0] as AgentMessage;
    const payload = JSON.parse(resultMessage.content);
    expect(payload.result.success).toBe(false);
    expect(payload.result.output).toMatch(/refused a blind replay/i);
    expect(payload.result.output).toMatch(/completion state is unknown/i);
  });

  it("rejects task_assignment from an address other than the configured parent", async () => {
    const ctx = harness();

    await expect(
      ctx.handler(assignment({ from: "0xattacker" })),
    ).rejects.toThrow(/not the configured parent/i);

    expect(ctx.executeTask).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });

  it("rejects task_assignment addressed to a different child", async () => {
    const ctx = harness();

    await expect(
      ctx.handler(assignment({ to: "0xother-child" })),
    ).rejects.toThrow(/recipient mismatch/i);

    expect(ctx.executeTask).not.toHaveBeenCalled();
    expect(ctx.send).not.toHaveBeenCalled();
  });
});
