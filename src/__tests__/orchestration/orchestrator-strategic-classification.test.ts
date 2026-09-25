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
  const agentTracker: AgentTracker = {
    getIdle: vi.fn().mockReturnValue([]),
    getBestForTask: vi.fn().mockReturnValue(null),
    updateStatus: vi.fn(),
    register: vi.fn(),
  };
  const funding: FundingProtocol = {
    fundChild: vi.fn().mockResolvedValue({ success: true }),
    recallCredits: vi.fn().mockResolvedValue({ success: true, amountCents: 0 }),
    getBalance: vi.fn().mockResolvedValue(1000),
  };

  return new Orchestrator({
    db,
    agentTracker,
    funding,
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
  ).run(
    id,
    "One-action strategic commitment",
    "Perform one externally consequential action whose assumptions must be reviewed.",
    new Date().toISOString(),
  );
  return id;
}

function setClassifyingState(db: BetterSqlite3.Database, goalId: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(
    "orchestrator.state",
    JSON.stringify({
      phase: "classifying",
      goalId,
      replanCount: 0,
      failedTaskId: null,
      failedError: null,
    }),
  );
}

function readPhase(db: BetterSqlite3.Database): string {
  const row = db.prepare(
    "SELECT value FROM kv WHERE key = 'orchestrator.state'",
  ).get() as { value: string };
  return JSON.parse(row.value).phase as string;
}

function cognitiveEvents(
  db: BetterSqlite3.Database,
  goalId: string,
): Array<{ event_type: string; payload_json: string }> {
  return db.prepare(
    `SELECT event_type, payload_json
     FROM evidence_events
     WHERE goal_id = ? AND domain = 'cognitive'
     ORDER BY sequence ASC`,
  ).all(goalId) as Array<{ event_type: string; payload_json: string }>;
}

describe("P-025/P-026 strategic classification boundary", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it("routes a new top-level Goal to planning without consulting the legacy step-count classifier and records why planning is needed", async () => {
    const goalId = insertGoal(db);
    setClassifyingState(db, goalId);
    const inference = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          estimatedSteps: 1,
          reason: "One action",
          stepOutline: ["Execute once"],
        }),
        usage: {},
      }),
    };

    const result = await makeOrchestrator(db, inference).tick();

    expect(result.phase).toBe("planning");
    expect(readPhase(db)).toBe("planning");
    expect(inference.chat).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM task_graph WHERE goal_id = ?").get(goalId),
    ).toEqual({ count: 0 });

    const events = cognitiveEvents(db, goalId);
    expect(events.map((event) => event.event_type)).toEqual([
      "cognitive.route_selected",
    ]);
    expect(JSON.parse(events[0]!.payload_json)).toMatchObject({
      taskClass: "strategic:classification",
      baselineRouteId: "inference:strategic-planning",
      selectedRouteId: "inference:strategic-planning",
      selectedKind: "inference",
      action: "execute",
    });
  });

  it("preserves execution when a Goal already has a materialized Task graph and records a quality-validated no-model receipt", async () => {
    const goalId = insertGoal(db);
    db.prepare(
      `INSERT INTO task_graph
       (id, goal_id, title, description, status, assigned_to, agent_role, priority, dependencies, created_at)
       VALUES (?, ?, ?, ?, 'pending', NULL, 'generalist', 50, '[]', ?)`,
    ).run(
      ulid(),
      goalId,
      "Already reviewed task",
      "Existing materialized work",
      new Date().toISOString(),
    );
    setClassifyingState(db, goalId);
    const inference = { chat: vi.fn() };

    const result = await makeOrchestrator(db, inference).tick();

    expect(result.phase).toBe("executing");
    expect(readPhase(db)).toBe("executing");
    expect(inference.chat).not.toHaveBeenCalled();
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM task_graph WHERE goal_id = ?").get(goalId),
    ).toEqual({ count: 1 });

    const events = cognitiveEvents(db, goalId);
    expect(events.map((event) => event.event_type)).toEqual([
      "cognitive.route_selected",
      "cognitive.route_executed",
      "cognitive.outcome_recorded",
    ]);
    expect(JSON.parse(events[0]!.payload_json)).toMatchObject({
      taskClass: "strategic:classification",
      selectedRouteId: "deterministic:materialized-task-graph",
      selectedKind: "deterministic",
      action: "execute",
    });
    expect(JSON.parse(events[2]!.payload_json)).toMatchObject({
      routeId: "deterministic:materialized-task-graph",
      success: true,
      qualityValidated: true,
      qualityScore: 1,
      actualCostCents: 0,
      reworkCount: 0,
    });
  });
});
