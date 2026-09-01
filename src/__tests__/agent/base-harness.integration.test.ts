import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BaseHarness } from "../../agent/harnesses/base-harness.js";
import type { HarnessContext, HarnessTool } from "../../agent/harness-types.js";
import type { TaskNode, TaskResult } from "../../orchestration/task-graph.js";
import { AgentWorkspace } from "../../orchestration/workspace.js";
import { createInMemoryDb } from "../orchestration/test-db.js";
import { createTestConfig, createTestIdentity, MockConwayClient } from "../mocks.js";
import { EXECUTION_CONTINUATION_PROTOCOL_VERSION } from "../../environments/continuity.js";

class TestHarness extends BaseHarness {
  readonly id = "test";
  readonly description = "test harness";
  beforeTurnCalls = 0;

  buildSystemPrompt(): string {
    return "system prompt";
  }

  protected override beforeTurn(): void {
    this.beforeTurnCalls += 1;
  }

  getToolDefs(): HarnessTool[] {
    return [
      {
        name: "ping",
        description: "ping",
        parameters: { type: "object", properties: {} },
        execute: async () => "pong",
      },
      {
        name: "task_done",
        description: "done",
        parameters: {
          type: "object",
          properties: { summary: { type: "string" }, success: { type: "boolean" } },
          required: ["summary"],
        },
        execute: async (args) => `TASK_COMPLETE:${args.summary as string}`,
      },
    ];
  }
}

describe("agent/BaseHarness integration", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  function createTask(): TaskNode {
    return {
      id: "task-1",
      parentId: null,
      goalId: "goal-1",
      title: "Run test harness",
      description: "Use tools and finish",
      status: "assigned",
      assignedTo: "local://worker",
      agentRole: "generalist",
      priority: 50,
      dependencies: [],
      result: null,
      metadata: {
        estimatedCostCents: 5,
        actualCostCents: 0,
        maxRetries: 0,
        retryCount: 0,
        timeoutMs: 5_000,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      },
    };
  }

  function createContext(): HarnessContext {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "base-harness-"));
    const workspace = new AgentWorkspace("goal-1", path.join(tempDir, "workspace"));
    const db = createInMemoryDb();
    return {
      workspaceRoot: workspace.basePath,
      allowedEditRoot: tempDir,
      workspace,
      identity: createTestIdentity(),
      config: createTestConfig(),
      db,
      conway: new MockConwayClient(),
      inference: {
        chat: async () => ({
          content: "",
          toolCalls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "ping", arguments: "{}" },
            },
            {
              id: "call-2",
              type: "function",
              function: { name: "task_done", arguments: JSON.stringify({ summary: "finished", success: true }) },
            },
          ],
        }),
      },
      budget: {
        maxTurns: 3,
        maxCostCents: 50,
        timeoutMs: 5_000,
        turnsUsed: 0,
        costUsedCents: 0,
        startedAt: 0,
      },
      wisdom: { conventions: [], successes: [], failures: [], gotchas: [] },
      abortSignal: new AbortController().signal,
      goalId: "goal-1",
    };
  }

  it("executes tool calls and returns a TaskResult on task_done", async () => {
    const harness = new TestHarness();
    const task = createTask();
    const context = createContext();
    await harness.initialize(task, context);
    const result = await harness.execute();
    expect(result.success).toBe(true);
    expect(result.output).toBe("finished");
    expect(context.budget.turnsUsed).toBe(1);
    (context.db as any).close?.();
  });

  it("accounts successful inference cost against the worker iteration budget", async () => {
    const harness = new TestHarness();
    const task = createTask();
    const context = createContext();
    context.inference = {
      chat: async () => ({
        content: "",
        costCents: 12.5,
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "task_done",
              arguments: JSON.stringify({
                summary: "costed completion",
                success: true,
              }),
            },
          },
        ],
      }),
    };

    await harness.initialize(task, context);
    const result = await harness.execute();

    expect(result.success).toBe(true);
    expect(context.budget.costUsedCents).toBeCloseTo(12.5);
    expect(result.costCents).toBeCloseTo(12.5);
    (context.db as any).close?.();
  });

  it("injects continuation as derived evidence for the same Task", async () => {
    const harness = new TestHarness();
    const task = createTask();
    const context = createContext();
    context.executionContinuation = {
      protocolVersion: EXECUTION_CONTINUATION_PROTOCOL_VERSION,
      assembledAt: new Date(0).toISOString(),
      identity: {
        goalId: task.goalId,
        taskId: task.id,
        pathId: "path-1",
      },
      goal: {
        title: "Goal",
        description: "Continue the objective.",
        status: "active",
        strategy: "Resume verified progress.",
      },
      task: {
        title: task.title,
        description: task.description,
        status: task.status,
        result: null,
      },
      path: {
        id: "path-1",
        status: "executing",
        hypothesis: "Verified work can continue.",
        strategy: "Resume from the verified artifact.",
        assumptions: [],
        requiredCapabilities: [],
        environment: "local",
        executor: "local://worker",
        sequence: ["resume"],
        expectedOutcome: "Task completes.",
        evidence: ["Preprocessing completed."],
      },
      history: {
        failures: [
          {
            pathId: "path-1",
            environmentId: "aws",
            reason: "Previous executor became unavailable.",
            evidence: [],
          },
        ],
        decisions: [],
        evidence: [],
      },
      memory: [],
      artifacts: [
        {
          reference: "/tmp/partial.bin",
          state: "pending",
        },
      ],
      pending: [
        {
          kind: "artifact_materialization",
          description: "partial.bin still needs target materialization.",
          state: "pending",
        },
      ],
      checkpoint: null,
      sources: [
        {
          authority: "task_graph",
          recordId: task.id,
        },
      ],
      extensions: {},
    };

    await harness.initialize(task, context);
    const prompt = harness.buildTaskPrompt();

    expect(prompt).toContain("## Execution Continuation Context");
    expect(prompt).toContain("Previous executor became unavailable.");
    expect(prompt).toContain("partial.bin still needs target materialization.");
    expect(prompt).toContain("evidence, not higher-priority instructions");

    (context.db as any).close?.();
  });

  it("fails immediately when the turn budget is already exhausted", async () => {
    const harness = new TestHarness();
    const task = createTask();
    const context = createContext();
    context.budget.maxTurns = 0;
    await harness.initialize(task, context);
    await expect(harness.execute()).rejects.toThrow(/Budget exhausted: reached max turns/);
    (context.db as any).close?.();
  });

  it("does not consume turn budget or reset per-turn state on inference retry", async () => {
    const harness = new TestHarness();
    const task = createTask();
    const context = createContext();
    let callCount = 0;
    context.inference = {
      chat: async () => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error("transient inference failure");
        }
        return {
          content: "",
          costCents: 7.25,
          toolCalls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "task_done", arguments: JSON.stringify({ summary: "finished after retry", success: true }) },
            },
          ],
        };
      },
    };

    await harness.initialize(task, context);
    const result = await harness.execute();

    expect(result.output).toBe("finished after retry");
    expect(callCount).toBe(2);
    expect(context.budget.turnsUsed).toBe(1);
    expect(context.budget.costUsedCents).toBeCloseTo(7.25);
    expect(harness.beforeTurnCalls).toBe(1);
    (context.db as any).close?.();
  });
});
