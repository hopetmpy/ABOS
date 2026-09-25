import type BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";
import { SimulationWorkspace } from "../../intelligence/simulation-workspace.js";
import { Orchestrator } from "../../orchestration/orchestrator.js";
import { loadPlanningSimulationEvidence } from "../../orchestration/simulation-planning-context.js";
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
    "Choose a route using experiment evidence",
    "Select a reviewed route only after considering the available E-xxx evidence.",
    new Date().toISOString(),
  );
  return id;
}

function setPlanningState(db: BetterSqlite3.Database, goalId: string): void {
  db.prepare(
    "INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  ).run(
    "orchestrator.state",
    JSON.stringify({
      phase: "planning",
      goalId,
      replanCount: 0,
      failedTaskId: null,
      failedError: null,
    }),
  );
}

function reviewedPlan(evidenceRef: string) {
  return {
    analysis: "The experiment changes the relative attractiveness of the routes without becoming ground truth.",
    strategy: "Use the lower-uncertainty route and preserve a falsification boundary.",
    path: {
      hypothesis: "The selected route should satisfy the objective under the tested assumptions.",
      assumptions: ["The experiment assumptions remain relevant to this execution window."],
      requiredCapabilities: [],
      preferredEnvironment: null,
      expectedOutcome: "The objective reaches its acceptance condition.",
    },
    alternatives: [
      {
        label: "probe-first",
        strategy: "Run an additional discriminating probe before commitment.",
        hypothesis: "More evidence may justify a different execution route.",
        assumptions: ["Current experiment evidence is insufficient for irreversible commitment."],
        requiredCapabilities: [],
        preferredEnvironment: null,
        sequence: ["Run one additional probe", "Re-evaluate route"],
        expectedOutcome: "The objective reaches its acceptance condition with additional evidence.",
        estimatedCostCents: 70,
        discriminants: ["Trades additional cost for lower epistemic uncertainty."],
      },
    ],
    decisionFactors: [
      `Evidence Fabric ref ${evidenceRef} is inferential support for the selected route, not an external observation.`,
    ],
    preMortem: ["The experiment assumptions may not hold in the execution environment."],
    falsificationConditions: ["Observed execution conditions contradict the experiment assumptions."],
    customRoles: [],
    tasks: [
      {
        title: "Execute reviewed route",
        description: "Execute the selected route and verify its observable acceptance condition.",
        agentRole: "generalist",
        dependencies: [],
        estimatedCostCents: 50,
        priority: 50,
        timeoutMs: 60_000,
      },
    ],
    risks: ["Simulation evidence may not transfer to the live environment."],
    estimatedTotalCostCents: 50,
    estimatedTimeMinutes: 10,
  };
}

describe("P-025 simulation evidence causality", () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach(() => {
    db.close();
  });

  it("injects E-xxx as inference before choice and persists only the explicitly cited Evidence Fabric ref", async () => {
    const goalId = insertGoal(db);
    const workspace = new SimulationWorkspace(db);
    const experiment = workspace.createExperiment({
      experimentId: "E-P025-CAUSAL-001",
      goalId,
      pathId: null,
      question: "Which route has lower uncertainty under the modeled condition?",
      hypothesis: "The selected route remains viable under the modeled condition.",
      variables: {
        modeled_condition: {
          value: "nominal",
          provenance: "ASSUMED",
        },
      },
      simulatorId: "p025-test-simulator",
      simulatorVersion: "1.0.0",
      mode: "deterministic",
      maxRuns: 1,
      costBudgetCents: 10,
      expectedInformationGain: 0.8,
      assumptions: ["The modeled condition approximates the relevant execution state."],
    });
    workspace.setInterpretation(experiment.id, {
      lesson: "The selected route was stable in the modeled condition.",
      decisionImpact: "Prefer the selected route only while the modeled assumption remains plausible.",
    });

    const records = loadPlanningSimulationEvidence(db, goalId);
    const evidenceRef = records[0]?.evidenceRef;
    expect(evidenceRef).toBeTruthy();
    expect(records[0]?.epistemicStatus).toBe("inference");

    setPlanningState(db, goalId);
    const inference = {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify(reviewedPlan(evidenceRef!)),
        usage: {},
      }),
    };
    const orchestrator = makeOrchestrator(db, inference);

    const planned = await orchestrator.tick();
    expect(planned.phase).toBe("plan_review");
    expect(inference.chat).toHaveBeenCalledTimes(1);

    const request = inference.chat.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemPrompt = request.messages.find((message) => message.role === "system")?.content ?? "";
    expect(systemPrompt).toContain("# Simulation evidence (INFERENCE ONLY)");
    expect(systemPrompt).toContain(experiment.id);
    expect(systemPrompt).toContain(evidenceRef!);
    expect(systemPrompt).toContain("never external observation or ground truth");

    const reviewed = await orchestrator.tick();
    expect(reviewed.phase).toBe("executing");

    const path = db.prepare(
      "SELECT evidence, status FROM adaptive_paths WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(goalId) as { evidence: string; status: string };
    expect(path.status).toBe("selected");
    expect(JSON.parse(path.evidence)).toEqual([evidenceRef]);

    const fabricated = ulid();
    const planRow = db.prepare(
      "SELECT value FROM kv WHERE key = ?",
    ).get(`orchestrator.plan.${goalId}`) as { value: string };
    const storedPlan = JSON.parse(planRow.value);
    storedPlan.decisionFactors.push(`Fabricated ref ${fabricated} must never become path evidence.`);
    db.prepare(
      "UPDATE kv SET value = ?, updated_at = datetime('now') WHERE key = ?",
    ).run(JSON.stringify(storedPlan), `orchestrator.plan.${goalId}`);

    const pathEvidence = JSON.parse(path.evidence) as string[];
    expect(pathEvidence).not.toContain(fabricated);
  });
});