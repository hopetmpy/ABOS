import { describe, expect, it } from "vitest";
import {
  parseStandaloneTaskExecutionPayload,
} from "../orchestration/standalone-worker.js";
import {
  EXECUTION_CONTINUATION_PROTOCOL_VERSION,
  type ExecutionContinuationContext,
} from "../environments/continuity.js";
import type { TaskNode } from "../orchestration/task-graph.js";

function task(): TaskNode {
  return {
    id: "parent-task-1",
    parentId: null,
    goalId: "parent-goal-1",
    title: "Continue remote work",
    description: "Resume verified progress remotely.",
    status: "pending",
    assignedTo: null,
    agentRole: "generalist",
    priority: 50,
    dependencies: [],
    result: null,
    requiredCapabilities: ["compute"],
    preferredEnvironment: "aws",
    strategicPathId: "path-1",
    metadata: {
      estimatedCostCents: 0,
      actualCostCents: 0,
      maxRetries: 1,
      retryCount: 0,
      timeoutMs: 60_000,
      createdAt: new Date(0).toISOString(),
      startedAt: null,
      completedAt: null,
    },
  };
}

function continuation(): ExecutionContinuationContext {
  return {
    protocolVersion: EXECUTION_CONTINUATION_PROTOCOL_VERSION,
    assembledAt: new Date(0).toISOString(),
    identity: {
      goalId: "parent-goal-1",
      taskId: "parent-task-1",
      pathId: "path-1",
    },
    goal: {
      title: "Parent goal",
      description: "Continue the parent objective.",
      status: "active",
      strategy: "Resume verified progress.",
    },
    task: {
      title: "Continue remote work",
      description: "Resume verified progress remotely.",
      status: "pending",
      result: null,
    },
    path: {
      id: "path-1",
      status: "executing",
      hypothesis: "Remote execution can continue.",
      strategy: "Reuse verified work.",
      assumptions: [],
      requiredCapabilities: ["compute"],
      environment: "aws",
      executor: null,
      sequence: ["resume"],
      expectedOutcome: "Task completes.",
      evidence: ["Previous work is verified."],
    },
    history: {
      failures: [],
      decisions: [],
      evidence: [],
    },
    memory: [],
    artifacts: [],
    pending: [],
    checkpoint: null,
    sources: [
      {
        authority: "task_graph",
        recordId: "parent-task-1",
      },
    ],
    extensions: {},
  };
}

describe("standalone Task execution payload", () => {
  it("keeps backward compatibility with the historical bare Task payload", () => {
    const parsed = parseStandaloneTaskExecutionPayload(task());

    expect(parsed.task.id).toBe("parent-task-1");
    expect(parsed.executionContinuation).toBeUndefined();
  });

  it("accepts the provider-neutral execution envelope with matching continuation identity", () => {
    const parsed = parseStandaloneTaskExecutionPayload({
      protocol: "abos_task_execution_v1",
      task: task(),
      continuationContext: continuation(),
    });

    expect(parsed.task.id).toBe("parent-task-1");
    expect(parsed.executionContinuation?.identity).toEqual({
      goalId: "parent-goal-1",
      taskId: "parent-task-1",
      pathId: "path-1",
    });
  });

  it("rejects continuation for a different canonical Task instead of applying stale executable knowledge", () => {
    const wrong = continuation();
    wrong.identity.taskId = "different-task";

    expect(() =>
      parseStandaloneTaskExecutionPayload({
        protocol: "abos_task_execution_v1",
        task: task(),
        continuationContext: wrong,
      })
    ).toThrow(/continuation identity mismatch/i);
  });

  it("rejects continuation from a different Path instead of silently crossing strategy boundaries", () => {
    const wrong = continuation();
    wrong.identity.pathId = "path-other";

    expect(() =>
      parseStandaloneTaskExecutionPayload({
        protocol: "abos_task_execution_v1",
        task: task(),
        continuationContext: wrong,
      })
    ).toThrow(/continuation Path mismatch/i);
  });
});
