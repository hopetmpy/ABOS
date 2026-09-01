import { afterEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import {
  createDatabase,
  getTaskById,
} from "../../state/database.js";
import type {
  AbosDatabase,
  AbosIdentity,
} from "../../types.js";
import {
  ColonyMessaging,
  type MessageTransport,
} from "../../orchestration/messaging.js";
import {
  createColonyTaskAssignmentConsumer,
} from "../../orchestration/colony-task-assignment.js";
import {
  createTaskExecutionEnvelope,
} from "../../orchestration/task-execution-envelope.js";
import { Orchestrator } from "../../orchestration/orchestrator.js";
import type { TaskNode, TaskResult } from "../../orchestration/task-graph.js";
import {
  EXECUTION_CONTINUATION_PROTOCOL_VERSION,
  type ExecutionContinuationContext,
} from "../../environments/continuity.js";

class InMemoryColonyRelay implements MessageTransport {
  constructor(
    private readonly from: string,
    private readonly recipients: Map<string, AbosDatabase>,
  ) {}

  async deliver(to: string, envelope: string): Promise<void> {
    const target = this.recipients.get(to);
    if (!target) {
      throw new Error(`unknown relay recipient: ${to}`);
    }
    const now = new Date().toISOString();
    target.insertInboxMessage({
      id: ulid(),
      from: this.from,
      to,
      content: envelope,
      rawContent: envelope,
      signedAt: now,
      createdAt: now,
    });
  }

  getRecipients(): string[] {
    return [...this.recipients.keys()];
  }
}

function identity(address: string, name: string): AbosIdentity {
  return {
    name,
    address,
    account: {} as any,
    creatorAddress: "0xcreator",
    sandboxId: `sandbox-${name}`,
    apiKey: "test-key",
    createdAt: new Date(0).toISOString(),
  };
}

function task(): TaskNode {
  return {
    id: "task-e2e-1",
    parentId: null,
    goalId: "goal-e2e-1",
    title: "Continue delegated work",
    description: "Execute the canonical Task on the child and return the result.",
    status: "assigned",
    assignedTo: "0xchild",
    agentRole: "generalist",
    priority: 50,
    dependencies: [],
    result: null,
    requiredCapabilities: ["compute"],
    preferredEnvironment: "conway",
    strategicPathId: null,
    metadata: {
      estimatedCostCents: 5,
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
  const t = task();
  return {
    protocolVersion: EXECUTION_CONTINUATION_PROTOCOL_VERSION,
    assembledAt: new Date(0).toISOString(),
    identity: {
      goalId: t.goalId,
      taskId: t.id,
      pathId: null,
    },
    goal: {
      title: "E2E goal",
      description: "Prove logical continuity across a Colony transport.",
      status: "active",
      strategy: "Continue verified work.",
    },
    task: {
      title: t.title,
      description: t.description,
      status: t.status,
      result: null,
    },
    path: null,
    history: {
      failures: [{
        pathId: null,
        environmentId: "aws",
        reason: "Previous executor became unavailable.",
        evidence: [],
      }],
      decisions: [],
      evidence: [],
    },
    memory: [],
    artifacts: [{
      reference: "aws://ec2/i-old/artifact/%2Ftmp%2Fpartial.bin",
      state: "pending",
    }],
    pending: [{
      kind: "artifact_materialization",
      description: "partial.bin still requires target materialization.",
      state: "pending",
    }],
    checkpoint: null,
    sources: [{
      authority: "task_graph",
      recordId: t.id,
    }],
    extensions: {},
  };
}

function seedParent(db: AbosDatabase): void {
  const now = new Date(0).toISOString();
  db.raw.prepare(
    `INSERT INTO goals (
      id, title, description, status, strategy,
      expected_revenue_cents, actual_revenue_cents, created_at
    ) VALUES (?, ?, ?, 'active', ?, 0, 0, ?)`,
  ).run(
    "goal-e2e-1",
    "E2E goal",
    "Prove logical parent-child Task continuity.",
    "Continue verified work.",
    now,
  );

  db.raw.prepare(
    `INSERT INTO task_graph (
      id, parent_id, goal_id, title, description, status,
      assigned_to, agent_role, priority, dependencies, result,
      estimated_cost_cents, actual_cost_cents, max_retries,
      retry_count, timeout_ms, created_at, started_at
    ) VALUES (?, NULL, ?, ?, ?, 'assigned', ?, 'generalist', 50, '[]', NULL, 5, 0, 1, 0, 60000, ?, ?)`,
  ).run(
    "task-e2e-1",
    "goal-e2e-1",
    "Continue delegated work",
    "Execute the canonical Task on the child and return the result.",
    "0xchild",
    now,
    now,
  );

  db.setKV(
    "orchestrator.state",
    JSON.stringify({
      phase: "executing",
      goalId: "goal-e2e-1",
      replanCount: 0,
      failedTaskId: null,
      failedError: null,
    }),
  );
}

describe("cross-environment logical continuity E2E", () => {
  const databases: AbosDatabase[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) {
      db.close();
    }
  });

  it("carries continuation parent -> child, executes once, returns TaskResult, and completes the canonical parent Task", async () => {
    const parentDb = createDatabase(":memory:");
    const childDb = createDatabase(":memory:");
    databases.push(parentDb, childDb);

    parentDb.setIdentity("address", "0xparent");
    childDb.setIdentity("address", "0xchild");
    seedParent(parentDb);

    const recipients = new Map<string, AbosDatabase>([
      ["0xparent", parentDb],
      ["0xchild", childDb],
    ]);

    const parentMessaging = new ColonyMessaging(
      new InMemoryColonyRelay("0xparent", recipients),
      parentDb,
    );
    const childMessaging = new ColonyMessaging(
      new InMemoryColonyRelay("0xchild", recipients),
      childDb,
    );

    const executeTask = vi.fn(
      async (
        incomingTask: TaskNode,
        incomingContinuation?: ExecutionContinuationContext,
      ): Promise<TaskResult> => {
        expect(incomingTask.id).toBe("task-e2e-1");
        expect(incomingContinuation?.history.failures[0]?.environmentId).toBe("aws");
        expect(incomingContinuation?.artifacts[0]?.state).toBe("pending");
        return {
          success: true,
          output: "child completed continuation",
          artifacts: [],
          costCents: 2,
          duration: 25,
        };
      },
    );

    childMessaging.setHandler(
      "task_assignment",
      createColonyTaskAssignmentConsumer({
        identityAddress: "0xchild",
        parentAddress: "0xparent",
        db: childDb,
        messaging: childMessaging,
        executeTask,
      }),
    );

    const assignment = parentMessaging.createMessage({
      type: "task_assignment",
      to: "0xchild",
      goalId: "goal-e2e-1",
      taskId: "task-e2e-1",
      priority: "high",
      requiresResponse: true,
      content: JSON.stringify(
        createTaskExecutionEnvelope(
          task(),
          continuation(),
        ),
      ),
    });
    await parentMessaging.send(assignment);

    const childProcessed = await childMessaging.processInbox({
      types: ["task_assignment"],
    });
    expect(childProcessed).toEqual([
      expect.objectContaining({
        success: true,
        handledBy: "handleTaskAssignment",
      }),
    ]);
    expect(executeTask).toHaveBeenCalledTimes(1);

    const parentIdentity = identity("0xparent", "parent");
    const tracker = {
      getIdle: vi.fn().mockReturnValue([]),
      getBestForTask: vi.fn().mockReturnValue(null),
      updateStatus: vi.fn(),
      register: vi.fn(),
    };
    const funding = {
      fundChild: vi.fn().mockResolvedValue({ success: true }),
      recallCredits: vi.fn().mockResolvedValue({
        success: true,
        amountCents: 0,
      }),
      getBalance: vi.fn().mockResolvedValue(0),
    };

    const orchestrator = new Orchestrator({
      db: parentDb.raw,
      agentTracker: tracker,
      funding,
      messaging: parentMessaging,
      inference: {
        chat: vi.fn().mockRejectedValue(
          new Error("inference should not be needed for result collection"),
        ),
      } as any,
      identity: parentIdentity,
      config: {},
      isWorkerAlive: () => true,
    });

    await orchestrator.tick();

    const completed = getTaskById(parentDb.raw, "task-e2e-1");
    expect(completed?.status).toBe("completed");
    expect(completed?.result).toMatchObject({
      success: true,
      output: "child completed continuation",
      costCents: 2,
      duration: 25,
    });
    expect(tracker.updateStatus).toHaveBeenCalledWith(
      "0xchild",
      "healthy",
    );
  });
});
