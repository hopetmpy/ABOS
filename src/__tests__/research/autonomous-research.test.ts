import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type BetterSqlite3 from "better-sqlite3";
import {
  AutonomousResearchEngine,
  shouldWakeForAutonomousResearch,
} from "../../research/autonomous-research.js";
import {
  DEFAULT_AUTONOMOUS_RESEARCH_CONFIG,
  DEFAULT_CONFIG,
  type AutomatonConfig,
  type AutomatonIdentity,
  type FinancialState,
} from "../../types.js";
import { createInMemoryDb } from "../orchestration/test-db.js";

const IDENTITY = {
  name: "researcher",
  address: "0x1234",
  account: {},
  creatorAddress: "0x0000",
  sandboxId: "sandbox",
  apiKey: "test",
  createdAt: "2026-01-01T00:00:00Z",
} as AutomatonIdentity;

const FINANCIAL: FinancialState = {
  creditsCents: 10_000,
  usdcBalance: 0,
  lastChecked: "2026-01-01T00:00:00Z",
};

function makeConfig(
  overrides: Partial<NonNullable<AutomatonConfig["autonomousResearch"]>> = {},
): AutomatonConfig {
  return {
    ...DEFAULT_CONFIG,
    name: "researcher",
    genesisPrompt: "Discover useful low-cost software research opportunities.",
    creatorAddress: "0x0000",
    registeredWithConway: true,
    sandboxId: "sandbox",
    conwayApiUrl: "https://example.test",
    conwayApiKey: "test",
    inferenceModel: "test",
    maxTokensPerTurn: 4096,
    heartbeatConfigPath: "/tmp/heartbeat.yml",
    dbPath: ":memory:",
    logLevel: "error",
    walletAddress: "0x1234",
    version: "test",
    skillsDir: "/tmp/skills",
    maxChildren: 3,
    autonomousResearch: {
      ...DEFAULT_AUTONOMOUS_RESEARCH_CONFIG,
      enabled: true,
      cooldownMinutes: 0,
      ...overrides,
    },
  } as AutomatonConfig;
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Measure semantic drift in compressed project memories",
    domain: "agent-memory",
    hypothesis:
      "A contradiction-first summary check preserves critical constraints better than direct compression.",
    rationale:
      "Persistent agents need inexpensive ways to retain safety and task constraints across restarts.",
    experiment:
      "Compare direct summaries with contradiction-first summaries on a fixed synthetic corpus.",
    successCriteria: [
      "Contradiction-first summaries retain at least 20 percent more planted constraints.",
    ],
    stopConditions: [
      "Stop after 50 corpus cases or when the configured cost ceiling is reached.",
    ],
    noveltyChecks: [
      "Search local knowledge and accessible papers for the same comparison protocol.",
    ],
    noveltyScore: 0.82,
    expectedValueScore: 0.75,
    feasibilityScore: 0.9,
    learningValueScore: 0.85,
    riskScore: 0.05,
    estimatedCostCents: 120,
    ...overrides,
  };
}

function makeInference(candidates: Record<string, unknown>[]) {
  return {
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({ candidates }),
    }),
  };
}

describe("AutonomousResearchEngine", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it("creates one bounded goal and persists its decision context", async () => {
    const inference = makeInference([candidate()]);
    const engine = new AutonomousResearchEngine(
      db,
      inference,
      IDENTITY,
      makeConfig(),
    );

    const result = await engine.tick(FINANCIAL);

    expect(result.status).toBe("created");
    const goal = db.prepare("SELECT * FROM goals").get() as {
      id: string;
      description: string;
      strategy: string;
    };
    expect(goal.description).toContain("Attempt to falsify novelty");
    expect(goal.description).toContain("Do not transfer funds");
    expect(goal.strategy).toContain("autonomous-research/v1");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM knowledge_store").get(),
    ).toEqual({ count: 1 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM event_stream WHERE type = 'autonomous_research_goal_created'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("does not generate a second goal while another goal is active", async () => {
    const inference = makeInference([candidate()]);
    const engine = new AutonomousResearchEngine(
      db,
      inference,
      IDENTITY,
      makeConfig(),
    );

    expect((await engine.tick(FINANCIAL)).status).toBe("created");
    expect((await engine.tick(FINANCIAL)).status).toBe("busy");
    expect(inference.chat).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe, infeasible, malformed, and over-budget candidates", async () => {
    const inference = makeInference([
      candidate({
        title: "Credential theft experiment",
        riskScore: 0.1,
      }),
      candidate({
        title: "Infeasible experiment",
        feasibilityScore: 0.1,
      }),
      candidate({
        title: "Malformed scoring experiment",
        noveltyScore: 2,
      }),
      candidate({
        title: "Expensive but safe experiment",
        estimatedCostCents: 501,
      }),
    ]);
    const engine = new AutonomousResearchEngine(
      db,
      inference,
      IDENTITY,
      makeConfig({ blockedTopics: [] }),
    );

    expect((await engine.tick(FINANCIAL)).status).toBe("no_candidate");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM goals").get(),
    ).toEqual({ count: 0 });
  });

  it("rejects near-duplicate ideas using deterministic local similarity", async () => {
    const duplicate = candidate();
    db.prepare(
      `INSERT INTO goals (id, title, description, status, created_at)
       VALUES (?, ?, ?, 'completed', ?)`,
    ).run(
      "prior-goal",
      duplicate.title,
      `${duplicate.hypothesis} ${duplicate.experiment}`,
      "2026-01-01T00:00:00Z",
    );
    const engine = new AutonomousResearchEngine(
      db,
      makeInference([duplicate]),
      IDENTITY,
      makeConfig(),
    );

    expect((await engine.tick(FINANCIAL)).status).toBe("no_candidate");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM goals").get(),
    ).toEqual({ count: 1 });
  });

  it("blocks generation when credits cannot preserve the configured reserve", async () => {
    const inference = makeInference([candidate()]);
    const engine = new AutonomousResearchEngine(
      db,
      inference,
      IDENTITY,
      makeConfig(),
    );

    const result = await engine.tick({
      ...FINANCIAL,
      creditsCents: 1_499,
    });

    expect(result.status).toBe("budget_blocked");
    expect(inference.chat).not.toHaveBeenCalled();
  });

  it("persists cooldown state across engine instances", async () => {
    const config = makeConfig({ cooldownMinutes: 60 });
    const firstInference = makeInference([]);
    const firstEngine = new AutonomousResearchEngine(
      db,
      firstInference,
      IDENTITY,
      config,
    );
    expect((await firstEngine.tick(FINANCIAL)).status).toBe("no_candidate");

    const secondInference = makeInference([candidate()]);
    const secondEngine = new AutonomousResearchEngine(
      db,
      secondInference,
      IDENTITY,
      config,
    );
    expect((await secondEngine.tick(FINANCIAL)).status).toBe("cooldown");
    expect(secondInference.chat).not.toHaveBeenCalled();
  });

  it("records failed outcomes and pauses after repeated failure", async () => {
    const config = makeConfig({
      maxConsecutiveFailures: 1,
      pauseAfterFailuresMinutes: 120,
    });
    const engine = new AutonomousResearchEngine(
      db,
      makeInference([candidate()]),
      IDENTITY,
      config,
    );
    const first = await engine.tick(FINANCIAL);
    expect(first.status).toBe("created");
    db.prepare("UPDATE goals SET status = 'failed' WHERE id = ?").run(
      first.goalId,
    );

    expect((await engine.tick(FINANCIAL)).status).toBe("failure_pause");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM knowledge_store WHERE key LIKE 'research-outcome:%'",
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it("fails closed when inference is unavailable", async () => {
    const inference = {
      chat: vi.fn().mockRejectedValue(new Error("provider unavailable")),
    };
    const engine = new AutonomousResearchEngine(
      db,
      inference,
      IDENTITY,
      makeConfig(),
    );

    expect((await engine.tick(FINANCIAL)).status).toBe("error");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM goals").get(),
    ).toEqual({ count: 0 });
  });
});

describe("shouldWakeForAutonomousResearch", () => {
  it("only requests a wake when autonomy, capacity, cooldown, and budget allow it", () => {
    const db = createInMemoryDb();
    const now = new Date("2026-08-23T12:00:00Z");
    const config = makeConfig({ cooldownMinutes: 60 });

    expect(
      shouldWakeForAutonomousResearch(db, config, 10_000, now),
    ).toBe(true);

    db.prepare(
      `INSERT OR REPLACE INTO kv (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    ).run(
      "autonomous_research.state",
      JSON.stringify({
        version: 1,
        lastAttemptAt: "2026-08-23T11:30:00Z",
        currentGoalId: null,
        consecutiveFailures: 0,
        pauseUntil: null,
        dailyStarts: { date: "2026-08-23", count: 0 },
        domainStats: {},
      }),
    );
    expect(
      shouldWakeForAutonomousResearch(db, config, 10_000, now),
    ).toBe(false);
    expect(
      shouldWakeForAutonomousResearch(db, config, 1_000, now),
    ).toBe(false);

    db.close();
  });
});
