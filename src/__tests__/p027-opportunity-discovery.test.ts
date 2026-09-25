import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { appendEvidenceEvent, getEvidenceByAuthority } from "../observability/evidence.js";
import { OpportunityDiscovery, type OpportunityExperimentCandidate } from "../intelligence/opportunity-discovery.js";
import { PossibilitySpace } from "../intelligence/possibility-space.js";
import { SimulationWorkspace, type SimulatorDefinition } from "../intelligence/simulation-workspace.js";

function prepareDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      strategy TEXT,
      expected_revenue_cents INTEGER DEFAULT 0,
      actual_revenue_cents INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      deadline TEXT,
      completed_at TEXT
    );
  `);
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO goals (id, title, description, created_at) VALUES (?, ?, ?, ?)",
  ).run("goal-1", "Discover value", "P-027", now);
  db.prepare(
    "INSERT INTO goals (id, title, description, created_at) VALUES (?, ?, ?, ?)",
  ).run("goal-2", "Isolation", "P-027 isolation", now);
  return db;
}

function open(discovery: OpportunityDiscovery, overrides: Record<string, unknown> = {}) {
  return discovery.openHypothesis({
    goalId: "goal-1",
    observedNeed: "Teams spend time reconciling repeated operational failures.",
    beneficiaryClass: "operations teams",
    valueHypothesis: "A causal failure-reconciliation workflow could reduce rework.",
    candidateOffer: "assisted reconciliation workflow",
    evidenceRefs: ["evidence:need-1"],
    requiredCapabilities: ["analysis"],
    requiredResources: ["runtime time"],
    expectedCostCents: null,
    expectedUpsideCents: null,
    uncertainty: "Demand and willingness to adopt are unverified.",
    falsificationConditions: ["external observation shows no recurring reconciliation burden"],
    confidence: null,
    idempotencyKey: "p027-open-1",
    ...overrides,
  } as any);
}

const simulator: SimulatorDefinition = {
  id: "p027-sim",
  version: "1.0.0",
  mode: "deterministic",
  costCentsPerRun: 1,
  run: ({ variables }) => ({
    output: { estimatedMinutesSaved: Number(variables.baselineMinutes ?? 0) / 2 },
    surprise: { source: "simulation-only" },
  }),
};

function simulationCandidate(id = "sim-1"): OpportunityExperimentCandidate {
  return {
    id,
    kind: "simulation",
    question: "Would the proposed workflow reduce modeled reconciliation time?",
    hypothesis: "The workflow reduces modeled reconciliation time.",
    discriminates: true,
    expectedCostCents: 1,
    expectedInformationGain: 1,
    authorityState: "authorized",
    downsideBounded: true,
    simulationSpec: {
      experimentId: `E-${id}`,
      question: "Would the proposed workflow reduce modeled reconciliation time?",
      hypothesis: "The workflow reduces modeled reconciliation time.",
      variables: {
        baselineMinutes: { value: 20, provenance: "OBSERVED", confidence: 1 },
      },
      simulatorId: "p027-sim",
      simulatorVersion: "1.0.0",
      mode: "deterministic",
      maxRuns: 1,
      costBudgetCents: 1,
      expectedInformationGain: 1,
    },
  };
}

describe("P-027 opportunity identity and hypothesis lifecycle", () => {
  it("reuses adaptive_opportunities, reconstructs after restart, and feeds canonical possibility space", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const first = open(discovery);
      const restarted = new OpportunityDiscovery(db);
      const second = open(restarted);

      expect(second.opportunity.id).toBe(first.opportunity.id);
      expect(second.belief.id).toBe(first.belief.id);
      expect(first.expectedCostCents).toBeNull();
      expect(first.expectedUpsideCents).toBeNull();
      expect(first.belief.confidence).toBeNull();
      expect(first.belief.epistemicStatus).toBe("inference");

      const count = db.prepare("SELECT COUNT(*) AS count FROM adaptive_opportunities").get() as { count: number };
      expect(count.count).toBe(1);
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'economic_opportunities'").get(),
      ).toBeUndefined();

      const profileEvents = getEvidenceByAuthority(db, "adaptive_opportunity", first.opportunity.id)
        .filter((event) => event.eventType === "opportunity.hypothesis_recorded");
      expect(profileEvents).toHaveLength(1);

      const possibilitySpace = new PossibilitySpace(restarted.store).snapshot("goal-1");
      expect(possibilitySpace.openOpportunities.map((item) => item.id)).toContain(first.opportunity.id);
      expect(possibilitySpace.beliefs.map((item) => item.id)).toContain(first.belief.id);
    } finally {
      db.close();
    }
  });

  it("does not allow a value hypothesis to self-promote into observation truth", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      expect(() => open(discovery, {
        idempotencyKey: "fake-observation",
        epistemicStatus: "observation",
      })).toThrow(/cannot be opened as observation/i);
      const count = db.prepare("SELECT COUNT(*) AS count FROM adaptive_opportunities").get() as { count: number };
      expect(count.count).toBe(0);
    } finally {
      db.close();
    }
  });

  it("rejects reuse of an idempotency key for a different hypothesis payload", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const first = open(discovery);
      expect(() => open(discovery, {
        observedNeed: "A materially different need must not inherit the original receipt.",
      })).toThrow(/idempotency key collision/i);
      expect(discovery.listOpportunities("goal-1")).toHaveLength(1);
      expect(discovery.listOpportunities("goal-1")[0]?.id).toBe(first.opportunity.id);
    } finally {
      db.close();
    }
  });

  it("supports the declared opportunity status lifecycle without reopening terminal state", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const selected = discovery.transitionOpportunity(hypothesis.opportunity.id, "selected", ["evidence:selected"]);
      expect(selected.status).toBe("selected");
      expect(discovery.transitionOpportunity(hypothesis.opportunity.id, "selected").status).toBe("selected");
      expect(discovery.transitionOpportunity(hypothesis.opportunity.id, "resolved").status).toBe("resolved");
      expect(() => discovery.transitionOpportunity(hypothesis.opportunity.id, "selected"))
        .toThrow(/invalid opportunity transition/i);

      const transitions = getEvidenceByAuthority(db, "adaptive_opportunity", hypothesis.opportunity.id)
        .filter((event) => event.eventType === "adaptive.opportunity_status_changed");
      expect(transitions).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

describe("P-027 cheapest discriminating experiment selection", () => {
  it("does not treat UNKNOWN cost, missing authority, or unavailable capability as a cheap route", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const selected = discovery.selectExperiment(hypothesis.opportunity.id, [
        {
          ...simulationCandidate("unknown-cost"),
          expectedCostCents: null,
        },
        {
          ...simulationCandidate("unauthorized"),
          expectedCostCents: 0,
          authorityState: "unauthorized",
        },
        {
          ...simulationCandidate("not-ready"),
          expectedCostCents: 0,
          capabilityResolution: {
            kind: "probe",
            requirement: "market probe",
            candidates: [],
            missingRequirements: ["market probe"],
            rationale: "not verified",
            nextActions: ["probe"],
          },
        },
        simulationCandidate("valid"),
      ]);

      expect(selected.status).toBe("selected");
      expect(selected.selected?.id).toBe("valid");
      expect(selected.rejected.map((item) => item.candidateId).sort()).toEqual([
        "not-ready",
        "unauthorized",
        "unknown-cost",
      ]);
    } finally {
      db.close();
    }
  });

  it("leaves an equal-cost incomparable tie INCONCLUSIVE instead of inventing a winner", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const result = discovery.selectExperiment(hypothesis.opportunity.id, [
        { ...simulationCandidate("tie-a"), expectedInformationGain: null },
        { ...simulationCandidate("tie-b"), expectedInformationGain: 2 },
      ]);
      expect(result.status).toBe("inconclusive");
      expect(result.selected).toBeNull();
      expect(result.rationale).toMatch(/will not invent an arbitrary winner/i);
    } finally {
      db.close();
    }
  });

  it("uses information gain only to resolve an otherwise equal known-cost tie", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const result = discovery.selectExperiment(hypothesis.opportunity.id, [
        { ...simulationCandidate("lower-gain"), expectedInformationGain: 1 },
        { ...simulationCandidate("higher-gain"), expectedInformationGain: 3 },
      ]);
      expect(result.status).toBe("selected");
      expect(result.selected?.id).toBe("higher-gain");
    } finally {
      db.close();
    }
  });

  it("rejects candidate-id reuse when the experiment specification changes", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      discovery.selectExperiment(hypothesis.opportunity.id, [simulationCandidate("stable-id")]);
      expect(() => discovery.selectExperiment(hypothesis.opportunity.id, [{
        ...simulationCandidate("stable-id"),
        question: "A different discriminating question must not reuse the old candidate receipt.",
      }])).toThrow(/candidate id collision/i);
    } finally {
      db.close();
    }
  });
});

describe("P-027 simulation and external-observation boundaries", () => {
  it("executes through SimulationWorkspace idempotently and never claims external demand", () => {
    const db = prepareDb();
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(simulator);
      const discovery = new OpportunityDiscovery(db, { simulation: workspace });
      const hypothesis = open(discovery);
      const selection = discovery.selectExperiment(hypothesis.opportunity.id, [simulationCandidate()]);
      const first = discovery.executeSelectedExperiment(selection);
      const second = discovery.executeSelectedExperiment(selection);

      expect(first.status).toBe("completed");
      expect(first.kind).toBe("simulation");
      expect(second.status).toBe("completed");
      if (first.kind === "simulation" && second.kind === "simulation") {
        expect(first.experiment.id).toBe(second.experiment.id);
        expect(second.experiment.runCount).toBe(1);
      }
      expect(discovery.getHypothesis(hypothesis.opportunity.id)?.belief.epistemicStatus).toBe("inference");
      const executions = getEvidenceByAuthority(db, "adaptive_opportunity", hypothesis.opportunity.id)
        .filter((event) => event.eventType === "opportunity.experiment_executed");
      expect(executions).toHaveLength(1);
      expect(executions[0]?.payload).toMatchObject({ externalDemandObserved: false });
    } finally {
      db.close();
    }
  });

  it("reconstructs a generated simulation id from the persisted execution receipt", () => {
    const db = prepareDb();
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(simulator);
      const discovery = new OpportunityDiscovery(db, { simulation: workspace });
      const hypothesis = open(discovery);
      const candidate = simulationCandidate("generated-id");
      delete candidate.simulationSpec?.experimentId;
      const selection = discovery.selectExperiment(hypothesis.opportunity.id, [candidate]);
      const first = discovery.executeSelectedExperiment(selection);
      const restarted = new OpportunityDiscovery(db, { simulation: workspace });
      const second = restarted.executeSelectedExperiment(selection);
      expect(first.kind).toBe("simulation");
      expect(second.kind).toBe("simulation");
      if (first.kind === "simulation" && second.kind === "simulation") {
        expect(second.experiment.id).toBe(first.experiment.id);
        expect(second.experiment.runCount).toBe(1);
      }
      const count = db.prepare("SELECT COUNT(*) AS count FROM simulation_experiments").get() as { count: number };
      expect(count.count).toBe(1);
    } finally {
      db.close();
    }
  });

  it("rejects a stale or forged selection whose candidate no longer matches its receipt", () => {
    const db = prepareDb();
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(simulator);
      const discovery = new OpportunityDiscovery(db, { simulation: workspace });
      const hypothesis = open(discovery);
      const selection = discovery.selectExperiment(hypothesis.opportunity.id, [simulationCandidate("receipt-bound")]);
      const forged = {
        ...selection,
        selected: selection.selected
          ? { ...selection.selected, hypothesis: "A changed hypothesis cannot inherit the original receipt." }
          : null,
      };
      expect(() => discovery.executeSelectedExperiment(forged)).toThrow(/selection receipt does not match/i);
    } finally {
      db.close();
    }
  });

  it("rejects simulation-owned evidence as an observed opportunity outcome", () => {
    const db = prepareDb();
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(simulator);
      const discovery = new OpportunityDiscovery(db, { simulation: workspace });
      const hypothesis = open(discovery);
      const selection = discovery.selectExperiment(hypothesis.opportunity.id, [simulationCandidate()]);
      const execution = discovery.executeSelectedExperiment(selection);
      if (execution.kind !== "simulation") throw new Error("expected simulation execution");
      const simulationEvidence = getEvidenceByAuthority(db, "simulation_experiment", execution.experiment.id)[0];
      expect(simulationEvidence).toBeDefined();
      expect(() => discovery.recordObservedOutcome({
        opportunityId: hypothesis.opportunity.id,
        evidenceEventId: simulationEvidence!.id,
        assessment: "supports",
      })).toThrow(/simulation evidence cannot be promoted/i);
    } finally {
      db.close();
    }
  });

  it("records explicitly attributed external support once and upgrades the belief without fabricating revenue", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const external = appendEvidenceEvent(db, {
        correlationId: "goal:goal-1",
        eventType: "market.interview_observed",
        domain: "market",
        authorityType: "external_interview",
        authorityId: "interview-1",
        goalId: "goal-1",
        epistemicStatus: "observation",
        payload: {
          opportunityId: hypothesis.opportunity.id,
          responseClass: "accepted-pain-point",
        },
      });

      const first = discovery.recordObservedOutcome({
        opportunityId: hypothesis.opportunity.id,
        evidenceEventId: external.id,
        assessment: "supports",
        confidence: null,
      });
      const second = discovery.recordObservedOutcome({
        opportunityId: hypothesis.opportunity.id,
        evidenceEventId: external.id,
        assessment: "supports",
        confidence: null,
      });

      expect(first.currentBelief.epistemicStatus).toBe("observation");
      expect(first.currentBelief.confidence).toBeNull();
      expect(second.currentBelief.id).toBe(first.currentBelief.id);
      expect(discovery.store.getBelief(hypothesis.belief.id)?.lifecycleStatus).toBe("superseded");
      expect(discovery.getHypothesis(hypothesis.opportunity.id)?.belief.id).toBe(first.currentBelief.id);
      expect(discovery.getOpportunity(hypothesis.opportunity.id)?.status).toBe("open");

      const outcomeReceipts = getEvidenceByAuthority(db, "adaptive_opportunity", hypothesis.opportunity.id)
        .filter((event) => event.eventType === "opportunity.outcome_observed");
      expect(outcomeReceipts).toHaveLength(1);
      const goalRow = db.prepare(
        "SELECT actual_revenue_cents FROM goals WHERE id = 'goal-1'",
      ).get() as { actual_revenue_cents: number };
      expect(goalRow.actual_revenue_cents).toBe(0);
    } finally {
      db.close();
    }
  });

  it("invalidates a contradicted value belief but does not declare the opportunity impossible or closed", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const external = appendEvidenceEvent(db, {
        correlationId: "goal:goal-1",
        eventType: "market.experiment_observed",
        domain: "market",
        authorityType: "external_market_probe",
        authorityId: "probe-1",
        goalId: "goal-1",
        epistemicStatus: "observation",
        payload: {
          opportunityId: hypothesis.opportunity.id,
          responseClass: "no-response",
        },
      });
      const result = discovery.recordObservedOutcome({
        opportunityId: hypothesis.opportunity.id,
        evidenceEventId: external.id,
        assessment: "contradicts",
      });

      expect(result.currentBelief.lifecycleStatus).toBe("invalidated");
      expect(discovery.getOpportunity(hypothesis.opportunity.id)?.status).toBe("open");
      expect(discovery.listOpportunities("goal-1", "open")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rejects cross-goal outcome contamination before opportunity attribution", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const external = appendEvidenceEvent(db, {
        correlationId: "goal:goal-2",
        eventType: "market.experiment_observed",
        domain: "market",
        authorityType: "external_market_probe",
        authorityId: "probe-other-goal",
        goalId: "goal-2",
        epistemicStatus: "observation",
        payload: { opportunityId: hypothesis.opportunity.id },
      });
      expect(() => discovery.recordObservedOutcome({
        opportunityId: hypothesis.opportunity.id,
        evidenceEventId: external.id,
        assessment: "supports",
      })).toThrow(/same goal/i);
    } finally {
      db.close();
    }
  });

  it("rejects same-goal evidence attributed to another opportunity", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const first = open(discovery);
      const second = open(discovery, {
        idempotencyKey: "p027-open-2",
        observedNeed: "A second distinct need under the same goal.",
      });
      const external = appendEvidenceEvent(db, {
        correlationId: "goal:goal-1",
        eventType: "market.experiment_observed",
        domain: "market",
        authorityType: "external_market_probe",
        authorityId: "probe-second-opportunity",
        goalId: "goal-1",
        epistemicStatus: "observation",
        payload: { opportunityId: second.opportunity.id },
      });
      expect(() => discovery.recordObservedOutcome({
        opportunityId: first.opportunity.id,
        evidenceEventId: external.id,
        assessment: "supports",
      })).toThrow(/same opportunity/i);
    } finally {
      db.close();
    }
  });

  it("rejects same-goal market evidence that lacks explicit opportunity attribution", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const external = appendEvidenceEvent(db, {
        correlationId: "goal:goal-1",
        eventType: "market.experiment_observed",
        domain: "market",
        authorityType: "external_market_probe",
        authorityId: "probe-unattributed",
        goalId: "goal-1",
        epistemicStatus: "observation",
      });
      expect(() => discovery.recordObservedOutcome({
        opportunityId: hypothesis.opportunity.id,
        evidenceEventId: external.id,
        assessment: "supports",
      })).toThrow(/explicitly reference the same opportunity/i);
    } finally {
      db.close();
    }
  });

  it("does not reinterpret the same observation with a different assessment", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const external = appendEvidenceEvent(db, {
        correlationId: "goal:goal-1",
        eventType: "market.experiment_observed",
        domain: "market",
        authorityType: "external_market_probe",
        authorityId: "probe-stable",
        goalId: "goal-1",
        epistemicStatus: "observation",
        payload: { opportunityId: hypothesis.opportunity.id },
      });
      discovery.recordObservedOutcome({
        opportunityId: hypothesis.opportunity.id,
        evidenceEventId: external.id,
        assessment: "inconclusive",
      });
      expect(() => discovery.recordObservedOutcome({
        opportunityId: hypothesis.opportunity.id,
        evidenceEventId: external.id,
        assessment: "supports",
      })).toThrow(/cannot be reinterpreted/i);
    } finally {
      db.close();
    }
  });

  it("rejects replay of the same observed outcome with different confidence", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const external = appendEvidenceEvent(db, {
        correlationId: "goal:goal-1",
        eventType: "market.interview_observed",
        domain: "market",
        authorityType: "external_interview",
        authorityId: "interview-confidence",
        goalId: "goal-1",
        epistemicStatus: "observation",
        payload: { opportunityId: hypothesis.opportunity.id },
      });
      discovery.recordObservedOutcome({
        opportunityId: hypothesis.opportunity.id,
        evidenceEventId: external.id,
        assessment: "supports",
        confidence: 0.6,
      });
      expect(() => discovery.recordObservedOutcome({
        opportunityId: hypothesis.opportunity.id,
        evidenceEventId: external.id,
        assessment: "supports",
        confidence: 0.7,
      })).toThrow(/different confidence/i);
    } finally {
      db.close();
    }
  });
});

describe("P-027 LIVE boundary", () => {
  it("may select a bounded authorized LIVE probe but never auto-executes it", () => {
    const db = prepareDb();
    try {
      const discovery = new OpportunityDiscovery(db);
      const hypothesis = open(discovery);
      const live: OpportunityExperimentCandidate = {
        id: "live-probe",
        kind: "live",
        question: "Will an authorized micro-probe produce an external response?",
        hypothesis: "The beneficiary class responds to the micro-probe.",
        discriminates: true,
        expectedCostCents: 1,
        expectedInformationGain: 2,
        authorityState: "authorized",
        downsideBounded: true,
        capabilityResolution: {
          kind: "use_existing",
          requirement: "authorized market probe",
          candidates: [],
          missingRequirements: [],
          rationale: "test projection of already-authorized runtime readiness",
          nextActions: [],
        },
      };
      const selection = discovery.selectExperiment(hypothesis.opportunity.id, [live]);
      expect(selection.status).toBe("selected");
      const execution = discovery.executeSelectedExperiment(selection);
      expect(execution.status).toBe("live_blocked_external");
      expect(execution.kind).toBe("live");
      expect(execution.reason).toMatch(/not auto-authorized/i);
    } finally {
      db.close();
    }
  });
});
