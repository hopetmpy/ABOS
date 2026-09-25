import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ulid } from "ulid";
import type BetterSqlite3 from "better-sqlite3";
import { Orchestrator } from "../../orchestration/orchestrator.js";
import { createInMemoryDb } from "../orchestration/test-db.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const IDENTITY = {
  name: "test",
  address: "0xparent" as any,
  account: {} as any,
  creatorAddress: "0x0000" as any,
  sandboxId: "sb-1",
  apiKey: "key",
  createdAt: "2026-01-01T00:00:00Z",
};

const plannerOutput = {
  analysis: "Analysis",
  strategy: "Strategy",
  path: {
    hypothesis: "The reviewed route can satisfy the objective.",
    assumptions: ["Current runtime conditions remain materially stable."],
    requiredCapabilities: [],
    preferredEnvironment: null,
    expectedOutcome: "The objective reaches its acceptance condition.",
  },
  alternatives: [
    {
      label: "alternate-sequence",
      strategy: "Use a different sequence before committing.",
      hypothesis: "A probe-first route could satisfy the same objective.",
      assumptions: ["A probe can reduce uncertainty before execution."],
      requiredCapabilities: [],
      preferredEnvironment: null,
      sequence: ["Probe uncertainty", "Execute alternate route"],
      expectedOutcome: "The objective reaches its acceptance condition.",
      estimatedCostCents: 120,
      discriminants: ["Trades extra probe cost for lower uncertainty."],
    },
  ],
  decisionFactors: ["The selected route has sufficient current evidence and lower coordination cost."],
  preMortem: ["Runtime conditions could change after review and invalidate the route."],
  falsificationConditions: ["A material runtime condition changes before execution."],
  customRoles: [],
  tasks: [
    {
      title: "Task 1",
      description: "Do the thing and verify.",
      agentRole: "generalist",
      dependencies: [],
      estimatedCostCents: 100,
      priority: 1,
      timeoutMs: 60000,
    },
  ],
  risks: ["risk1"],
  estimatedTotalCostCents: 100,
  estimatedTimeMinutes: 10,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readState(db: BetterSqlite3.Database): Record<string, unknown> | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get("orchestrator.state") as
    | { value: string }
    | undefined;
  return row ? JSON.parse(row.value) : null;
}

function setState(db: BetterSqlite3.Database, state: Record<string, unknown>): void {
  db.prepare(
    "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run("orchestrator.state", JSON.stringify(state));
}

function insertGoal(
  db: BetterSqlite3.Database,
  overrides: { id?: string; title?: string; description?: string; status?: string } = {},
): string {
  const id = overrides.id ?? ulid();
  db.prepare(
    "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(
    id,
    overrides.title ?? "Test Goal",
    overrides.description ?? "A test goal description",
    overrides.status ?? "active",
    new Date().toISOString(),
  );
  return id;
}

function getGoalStatus(db: BetterSqlite3.Database, goalId: string): string | null {
  const row = db.prepare("SELECT status FROM goals WHERE id = ?").get(goalId) as
    | { status: string }
    | undefined;
  return row?.status ?? null;
}

function getTasksForGoal(db: BetterSqlite3.Database, goalId: string) {
  return db.prepare("SELECT * FROM task_graph WHERE goal_id = ?").all(goalId) as Array<{
    id: string;
    status: string;
    assigned_to: string | null;
  }>;
}

function makeMocks() {
  const agentTracker = {
    getIdle: vi.fn().mockReturnValue([]),
    getBestForTask: vi.fn().mockReturnValue(null),
    updateStatus: vi.fn(),
    register: vi.fn(),
  };

  const funding = {
    fundChild: vi.fn().mockResolvedValue({ success: true }),
    recallCredits: vi.fn().mockResolvedValue({ success: true, amountCents: 0 }),
    getBalance: vi.fn().mockResolvedValue(1000),
  };

  const messaging = {
    processInbox: vi.fn().mockResolvedValue([]),
    send: vi.fn().mockResolvedValue(undefined),
    createMessage: vi.fn().mockReturnValue({
      id: "msg-1",
      type: "task_assignment",
      from: "0xparent",
      to: "0xchild",
      goalId: null,
      taskId: null,
      content: "{}",
      priority: "high",
      requiresResponse: true,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    }),
  };

  const inference = {
    chat: vi.fn(),
  };

  return { agentTracker, funding, messaging, inference };
}

function makeOrchestrator(
  db: BetterSqlite3.Database,
  mocks: ReturnType<typeof makeMocks>,
  config: Record<string, unknown> = {},
): Orchestrator {
  return new Orchestrator({
    db,
    agentTracker: mocks.agentTracker,
    funding: mocks.funding,
    messaging: mocks.messaging as any,
    inference: mocks.inference as any,
    identity: IDENTITY,
    config: { disableSpawn: true, maxReplans: 3, ...config },
  });
}

function makeTaskResultInboxEntry(goalId: string, taskId: string) {
  return {
    success: true,
    message: {
      id: "m1",
      type: "task_result",
      from: "0xchild",
      to: "0xparent",
      goalId,
      taskId,
      content: JSON.stringify({
        taskId,
        result: {
          success: true,
          output: "done",
          artifacts: [],
          costCents: 50,
          duration: 100,
        },
      }),
      priority: "normal",
      requiresResponse: false,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    },
    handledBy: "test",
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("integration/plan-execute-flow", () => {
  let db: BetterSqlite3.Database;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    db = createInMemoryDb();
    mocks = makeMocks();
  });

  afterEach(() => {
    db.close();
    vi.resetAllMocks();
  });

  describe("full lifecycle: idle → classifying → planning → plan_review → executing → complete", () => {
    it("tick 1: idle with active goal transitions to classifying", async () => {
      insertGoal(db, { status: "active" });
      setState(db, { phase: "idle", goalId: null, replanCount: 0, failedTaskId: null, failedError: null });
      mocks.inference.chat.mockResolvedValue({
        content: JSON.stringify({ estimatedSteps: 5, reason: "complex", stepOutline: ["step1"] }),
        usage: {},
      });
      const result = await makeOrchestrator(db, mocks).tick();
      expect(["classifying", "planning"]).toContain(result.phase);
    });

    it("tick 2: classifying with complex goal transitions to planning", async () => {
      const goalId = insertGoal(db, { status: "active" });
      setState(db, { phase: "classifying", goalId, replanCount: 0, failedTaskId: null, failedError: null });
      mocks.inference.chat.mockResolvedValue({
        content: JSON.stringify({ estimatedSteps: 5, reason: "complex", stepOutline: ["step1"] }),
        usage: {},
      });
      expect((await makeOrchestrator(db, mocks).tick()).phase).toBe("planning");
    });

    it("tick 3: planning persists a candidate without materializing tasks before review", async () => {
      const goalId = insertGoal(db, { status: "active" });
      setState(db, { phase: "planning", goalId, replanCount: 0, failedTaskId: null, failedError: null });
      mocks.inference.chat.mockResolvedValue({ content: JSON.stringify(plannerOutput), usage: {} });
      const result = await makeOrchestrator(db, mocks).tick();
      expect(result.phase).toBe("plan_review");
      expect(getTasksForGoal(db, goalId)).toHaveLength(0);
      const storedPlan = db.prepare("SELECT value FROM kv WHERE key = ?").get(`orchestrator.plan.${goalId}`) as { value: string } | undefined;
      expect(storedPlan).toBeDefined();
      expect(JSON.parse(storedPlan?.value ?? "{}").path.hypothesis).toBe(plannerOutput.path.hypothesis);
      expect(JSON.parse(storedPlan?.value ?? "{}").alternatives).toHaveLength(1);
    });

    it("tick 4: plan_review substantively approves before materializing and executing", async () => {
      const goalId = insertGoal(db, { status: "active" });
      db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))")
        .run(`orchestrator.plan.${goalId}`, JSON.stringify(plannerOutput));
      setState(db, { phase: "plan_review", goalId, replanCount: 0, failedTaskId: null, failedError: null });
      const result = await makeOrchestrator(db, mocks).tick();
      expect(result.phase).toBe("executing");
      expect(getTasksForGoal(db, goalId).length).toBeGreaterThan(0);
    });

    it("tick 5-6: executing assigns tasks, receives results, and completes goal", async () => {
      const goalId = insertGoal(db, { status: "active" });
      const taskId = ulid();
      db.prepare(`INSERT INTO task_graph (id, goal_id, title, description, status, agent_role, priority, dependencies, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(taskId, goalId, "Task 1", "Do the thing", "pending", "generalist", 1, "[]", new Date().toISOString());
      setState(db, { phase: "executing", goalId, replanCount: 0, failedTaskId: null, failedError: null });
      mocks.agentTracker.getIdle.mockReturnValue([{ address: "0xchild", name: "Worker", role: "generalist", status: "healthy" }]);
      mocks.messaging.processInbox.mockResolvedValue([]);
      const orc = makeOrchestrator(db, mocks);
      await orc.tick();
      expect(getTasksForGoal(db, goalId)[0].assigned_to).toBe("0xchild");
      mocks.messaging.processInbox.mockResolvedValue([makeTaskResultInboxEntry(goalId, taskId)]);
      const result2 = await orc.tick();
      expect(result2.phase).toBe("complete");
      expect(getGoalStatus(db, goalId)).toBe("completed");
    });
  });

  describe("replan on task failure", () => {
    it("task failure transitions executing phase to replanning", async () => {
      const goalId = insertGoal(db, { status: "active" });
      const taskId = ulid();
      db.prepare(`INSERT INTO task_graph (id, goal_id, title, description, status, agent_role, priority, dependencies, max_retries, retry_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(taskId, goalId, "Task 1", "Do the thing", "pending", "generalist", 1, "[]", 0, 0, new Date().toISOString());
      setState(db, { phase: "executing", goalId, replanCount: 0, failedTaskId: null, failedError: null });
      mocks.agentTracker.getIdle.mockReturnValue([{ address: "0xchild", name: "Worker", role: "generalist", status: "healthy" }]);
      mocks.messaging.processInbox.mockResolvedValue([{ success: true, message: { id: "m2", type: "task_result", from: "0xchild", to: "0xparent", goalId, taskId, content: JSON.stringify({ taskId, result: { success: false, output: "error: something broke", artifacts: [], costCents: 10, duration: 50 } }), priority: "normal", requiresResponse: false, expiresAt: null, createdAt: new Date().toISOString() }, handledBy: "test" }]);
      expect((await makeOrchestrator(db, mocks).tick()).phase).toBe("replanning");
    });

    it("replanning preserves the failed route until review, then supersedes it", async () => {
      const goalId = insertGoal(db, { status: "active" });
      const taskId = ulid();
      db.prepare(`INSERT INTO task_graph (id, goal_id, title, description, status, agent_role, priority, dependencies, max_retries, retry_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(taskId, goalId, "Task 1", "Do the thing", "failed", "generalist", 1, "[]", 0, 0, new Date().toISOString());
      setState(db, { phase: "replanning", goalId, replanCount: 0, failedTaskId: taskId, failedError: "it broke" });
      mocks.inference.chat.mockResolvedValue({ content: JSON.stringify(plannerOutput), usage: {} });
      const orc = makeOrchestrator(db, mocks);
      const draftResult = await orc.tick();
      expect(draftResult.phase).toBe("plan_review");
      expect(readState(db)?.replanCount).toBe(1);
      expect((db.prepare("SELECT status FROM task_graph WHERE id = ?").get(taskId) as { status: string }).status).toBe("failed");
      const reviewedResult = await orc.tick();
      expect(reviewedResult.phase).toBe("executing");
      expect((db.prepare("SELECT status FROM task_graph WHERE id = ?").get(taskId) as { status: string }).status).toBe("cancelled");
      const activeNewTasks = db.prepare(`SELECT COUNT(*) AS count FROM task_graph WHERE goal_id = ? AND status != 'cancelled'`).get(goalId) as { count: number };
      expect(activeNewTasks.count).toBeGreaterThan(0);
    });

    it("replan count does not terminate a still-valid objective", async () => {
      const goalId = insertGoal(db, { status: "active" });
      const taskId = ulid();
      db.prepare(`INSERT INTO task_graph (id, goal_id, title, description, status, agent_role, priority, dependencies, max_retries, retry_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(taskId, goalId, "Task 1", "Do the thing", "pending", "generalist", 1, "[]", 0, 0, new Date().toISOString());
      setState(db, { phase: "executing", goalId, replanCount: 3, failedTaskId: null, failedError: null });
      mocks.agentTracker.getIdle.mockReturnValue([{ address: "0xchild", name: "Worker", role: "generalist", status: "healthy" }]);
      mocks.messaging.processInbox.mockResolvedValue([{ success: true, message: { id: "m3", type: "task_result", from: "0xchild", to: "0xparent", goalId, taskId, content: JSON.stringify({ taskId, result: { success: false, output: "fatal failure", artifacts: [], costCents: 0, duration: 0 } }), priority: "normal", requiresResponse: false, expiresAt: null, createdAt: new Date().toISOString() }, handledBy: "test" }]);
      const result = await makeOrchestrator(db, mocks, { maxReplans: 3 }).tick();
      expect(result.phase).toBe("replanning");
      expect((db.prepare("SELECT status FROM goals WHERE id = ?").get(goalId) as { status: string }).status).toBe("active");
    });

    it("explicit failed phase still marks a goal failed for genuine terminal/runtime failure", async () => {
      const goalId = insertGoal(db, { status: "active" });
      setState(db, { phase: "failed", goalId, replanCount: 3, failedTaskId: null, failedError: "No more replans" });
      await makeOrchestrator(db, mocks).tick();
      expect(getGoalStatus(db, goalId)).toBe("failed");
    });
  });

  describe("plan review", () => {
    it("plan_review with no canonical plan fails closed instead of executing stale tasks", async () => {
      const goalId = insertGoal(db, { status: "active" });
      setState(db, { phase: "plan_review", goalId, replanCount: 0, failedTaskId: null, failedError: null });
      const result = await makeOrchestrator(db, mocks).tick();
      expect(result.phase).toBe("planning");
      expect(getTasksForGoal(db, goalId)).toHaveLength(0);
    });

    it("plan_review with strategically valid plan materializes and transitions to executing", async () => {
      const goalId = insertGoal(db, { status: "active" });
      db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))")
        .run(`orchestrator.plan.${goalId}`, JSON.stringify(plannerOutput));
      setState(db, { phase: "plan_review", goalId, replanCount: 0, failedTaskId: null, failedError: null });
      const result = await makeOrchestrator(db, mocks).tick();
      expect(result.phase).toBe("executing");
      expect(getTasksForGoal(db, goalId).length).toBeGreaterThan(0);
    });

    it("fixed budget scrutiny marker does not decide approval by itself", async () => {
      const goalId = insertGoal(db, { status: "active" });
      const highCostPlan = { ...plannerOutput, estimatedTotalCostCents: 6000 };
      db.prepare("INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))")
        .run(`orchestrator.plan.${goalId}`, JSON.stringify(highCostPlan));
      setState(db, { phase: "plan_review", goalId, replanCount: 0, failedTaskId: null, failedError: null });
      const result = await makeOrchestrator(db, mocks).tick();
      expect(result.phase).toBe("executing");
      expect(getTasksForGoal(db, goalId).length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("no active goals keeps orchestrator idle", async () => {
      setState(db, { phase: "idle", goalId: null, replanCount: 0, failedTaskId: null, failedError: null });
      const result = await makeOrchestrator(db, mocks).tick();
      expect(result.phase).toBe("idle");
      expect(result.goalsActive).toBe(0);
    });

    it("goal deleted mid-execution causes orchestrator to return to idle", async () => {
      const goalId = ulid();
      setState(db, { phase: "executing", goalId, replanCount: 0, failedTaskId: null, failedError: null });
      const result = await makeOrchestrator(db, mocks).tick();
      expect(result.phase).toBe("idle");
      expect(readState(db)?.goalId).toBeNull();
    });
  });
});
