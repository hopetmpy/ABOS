import type BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { Orchestrator } from "../../orchestration/orchestrator.js";
import type { AgentTracker, FundingProtocol } from "../../orchestration/types.js";
import { ColonyMessaging, type MessageTransport } from "../../orchestration/messaging.js";
import type { AbosDatabase } from "../../types.js";
import { createInMemoryDb } from "./test-db.js";

const IDENTITY = {
  name: "test",
  address: "0x1234" as any,
  account: {} as any,
  creatorAddress: "0x0000" as any,
  sandboxId: "sb-1",
  apiKey: "key",
  createdAt: "2026-01-01T00:00:00Z",
};

function makeAgentTracker(): AgentTracker {
  return {
    getIdle: vi.fn().mockReturnValue([]),
    getBestForTask: vi.fn().mockReturnValue(null),
    updateStatus: vi.fn(),
    register: vi.fn(),
  };
}

function makeFunding(): FundingProtocol {
  return {
    fundChild: vi.fn().mockResolvedValue({ success: true }),
    recallCredits: vi.fn().mockResolvedValue({ success: true, amountCents: 0 }),
    getBalance: vi.fn().mockResolvedValue(1000),
  };
}

function makeMessaging(raw: BetterSqlite3.Database): ColonyMessaging {
  const transport: MessageTransport = {
    deliver: vi.fn().mockResolvedValue(undefined),
    getRecipients: vi.fn().mockReturnValue([]),
  };
  const automataDb = {
    raw,
    getIdentity: (key: string) => (key === "address" ? "0x1234" : undefined),
    getChildren: () => [],
    getUnprocessedInboxMessages: (_limit: number) => [],
    markInboxMessageProcessed: (_id: string) => {},
  } as unknown as AbosDatabase;
  return new ColonyMessaging(transport, automataDb);
}

function makeOrchestrator(
  db: BetterSqlite3.Database,
  inference: { chat: ReturnType<typeof vi.fn> },
): Orchestrator {
  return new Orchestrator({
    db,
    agentTracker: makeAgentTracker(),
    funding: makeFunding(),
    messaging: makeMessaging(db),
    inference: inference as any,
    identity: IDENTITY,
    config: { disableSpawn: true },
  });
}

function insertGoal(db: BetterSqlite3.Database): string {
  const id = ulid();
  db.prepare(
    "INSERT INTO goals (id, title, description, status, created_at) VALUES (?, ?, ?, 'active', ?)",
  ).run(id, "Strategic Goal", "A complex goal that requires deliberate planning", new Date().toISOString());
  return id;
}

function insertTask(
  db: BetterSqlite3.Database,
  goalId: string,
  status: string,
): string {
  const id = ulid();
  db.prepare(
    `INSERT INTO task_graph
     (id, goal_id, title, description, status, assigned_to, agent_role, priority, dependencies, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'generalist', 50, '[]', ?)`,
  ).run(id, goalId, "Legacy task", "Pre-review work", status, new Date().toISOString());
  return id;
}

function setState(
  db: BetterSqlite3.Database,
  state: {
    phase: string;
    goalId: string;
    replanCount?: number;
    failedTaskId?: string | null;
    failedError?: string | null;
  },
): void {
  db.prepare(
    "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(
    "orchestrator.state",
    JSON.stringify({
      replanCount: 0,
      failedTaskId: null,
      failedError: null,
      ...state,
    }),
  );
}

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    analysis: "Compare the route against current evidence.",
    strategy: "Use the reviewed route only after it crosses the execution boundary.",
    path: {
      hypothesis: "The reviewed route can satisfy the objective.",
      assumptions: ["Current runtime conditions remain materially stable."],
      requiredCapabilities: [],
      preferredEnvironment: null,
      expectedOutcome: "The objective reaches its acceptance condition.",
    },
    customRoles: [],
    tasks: [
      {
        title: "Reviewed task",
        description: "Execute only after strategic review.",
        agentRole: "generalist",
        dependencies: [],
        estimatedCostCents: 50,
        priority: 50,
        timeoutMs: 60_000,
      },
    ],
    risks: ["A material assumption may become stale before execution."],
    estimatedTotalCostCents: 50,
    estimatedTimeMinutes: 10,
    ...overrides,
  };
}

function storePlan(db: BetterSqlite3.Database, goalId: string, plan: unknown): void {
  db.prepare(
    "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(`orchestrator.plan.${goalId}`, JSON.stringify(plan));
}

function taskCounts(db: BetterSqlite3.Database, goalId: string) {
  return db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
     FROM task_graph WHERE goal_id = ?`,
  ).get(goalId) as { total: number; pending: number | null; cancelled: number | null };
}

describe("P-025 canonical strategic orchestration boundary", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it("persists a planning draft without selecting a path or materializing Tasks", async () => {
    const goalId = insertGoal(db);
    setState(db, { phase: "planning", goalId });
    const inference = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify(validPlan()),
        usage: {},
      }),
    };

    const result = await makeOrchestrator(db, inference).tick();
    expect(result.phase).toBe("plan_review");

    const counts = taskCounts(db, goalId);
    expect(counts.total).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM adaptive_paths WHERE goal_id = ?").get(goalId),
    ).toEqual({ count: 0 });
    expect(
      db.prepare("SELECT value FROM kv WHERE key = ?").get(`orchestrator.plan.${goalId}`),
    ).toBeDefined();
  });

  it("materializes a reviewed path and Tasks only after substantive approval", async () => {
    const goalId = insertGoal(db);
    const legacyTaskId = insertTask(db, goalId, "pending");
    storePlan(db, goalId, validPlan());
    setState(db, { phase: "plan_review", goalId });

    const result = await makeOrchestrator(db, { chat: vi.fn() }).tick();
    expect(result.phase).toBe("executing");

    const legacy = db.prepare("SELECT status FROM task_graph WHERE id = ?").get(legacyTaskId) as { status: string };
    expect(legacy.status).toBe("cancelled");
    const counts = taskCounts(db, goalId);
    expect(counts.total).toBe(2);
    expect(counts.pending).toBe(1);
    expect(counts.cancelled).toBe(1);

    const binding = db.prepare(
      "SELECT path_id FROM adaptive_task_bindings WHERE goal_id = ?",
    ).get(goalId) as { path_id: string } | undefined;
    expect(binding?.path_id).toBeTruthy();
    const feedback = db.prepare(
      "SELECT value FROM kv WHERE key = ?",
    ).get(`orchestrator.review_feedback.${goalId}`) as { value: string };
    expect(feedback.value).toContain("disposition=approve");
    expect(feedback.value).toContain("materialized_path=");
  });

  it("fails closed when the canonical plan artifact is missing", async () => {
    const goalId = insertGoal(db);
    const legacyTaskId = insertTask(db, goalId, "pending");
    setState(db, { phase: "plan_review", goalId });

    const result = await makeOrchestrator(db, { chat: vi.fn() }).tick();
    expect(result.phase).toBe("planning");
    expect(
      (db.prepare("SELECT status FROM task_graph WHERE id = ?").get(legacyTaskId) as { status: string }).status,
    ).toBe("pending");
    const feedback = db.prepare(
      "SELECT value FROM kv WHERE key = ?",
    ).get(`orchestrator.review_feedback.${goalId}`) as { value: string };
    expect(feedback.value).toContain("canonical plan artifact is missing");
  });

  it("fails closed when the canonical plan artifact is malformed", async () => {
    const goalId = insertGoal(db);
    db.prepare(
      "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
    ).run(`orchestrator.plan.${goalId}`, "{not-json}");
    setState(db, { phase: "plan_review", goalId });

    const result = await makeOrchestrator(db, { chat: vi.fn() }).tick();
    expect(result.phase).toBe("planning");
    expect(taskCounts(db, goalId).total).toBe(0);
  });

  it("preserves unresolved capability readiness as UNKNOWN instead of executing", async () => {
    const goalId = insertGoal(db);
    const plan = validPlan({
      path: {
        hypothesis: "Use an unverified CLI route.",
        assumptions: ["The required CLI may exist."],
        requiredCapabilities: ["cli:unverified"],
        preferredEnvironment: null,
        expectedOutcome: "The CLI work completes.",
      },
    });
    storePlan(db, goalId, plan);
    setState(db, { phase: "plan_review", goalId });

    const result = await makeOrchestrator(db, { chat: vi.fn() }).tick();
    expect(result.phase).toBe("planning");
    expect(taskCounts(db, goalId).total).toBe(0);
    const feedback = db.prepare(
      "SELECT value FROM kv WHERE key = ?",
    ).get(`orchestrator.review_feedback.${goalId}`) as { value: string };
    expect(feedback.value).toContain("disposition=unknown");
    expect(feedback.value).toContain("Capability registry is unavailable");
  });

  it("keeps a failed path intact while a replan is only a draft, then supersedes it after review", async () => {
    const goalId = insertGoal(db);
    const failedTaskId = insertTask(db, goalId, "failed");
    setState(db, {
      phase: "replanning",
      goalId,
      replanCount: 0,
      failedTaskId,
      failedError: "old route failed",
    });
    const inference = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify(validPlan({ strategy: "Materially different reviewed route" })),
        usage: {},
      }),
    };
    const orc = makeOrchestrator(db, inference);

    const draft = await orc.tick();
    expect(draft.phase).toBe("plan_review");
    expect(
      (db.prepare("SELECT status FROM task_graph WHERE id = ?").get(failedTaskId) as { status: string }).status,
    ).toBe("failed");
    expect(taskCounts(db, goalId).total).toBe(1);

    const reviewed = await orc.tick();
    expect(reviewed.phase).toBe("executing");
    expect(
      (db.prepare("SELECT status FROM task_graph WHERE id = ?").get(failedTaskId) as { status: string }).status,
    ).toBe("cancelled");
    const counts = taskCounts(db, goalId);
    expect(counts.total).toBe(2);
    expect(counts.pending).toBe(1);
  });
});
