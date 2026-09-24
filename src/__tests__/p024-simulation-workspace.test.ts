import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  appendEvidenceEvent,
  getEvidenceByAuthority,
} from "../observability/evidence.js";
import {
  SimulationWorkspace,
  type SimulatorDefinition,
} from "../intelligence/simulation-workspace.js";
import { SIMULATION_SCHEMA_REVISION } from "../state/simulation-schema.js";

function deterministicSimulator(overrides: Partial<SimulatorDefinition> = {}): SimulatorDefinition {
  return {
    id: "linear",
    version: "1.0.0",
    mode: "deterministic",
    costCentsPerRun: 1,
    run: ({ variables }) => ({
      output: Number(variables.x ?? 0) + Number(variables.y ?? 0),
    }),
    summarize: (outputs) => ({
      summary: { count: outputs.length },
      result: { last: outputs.at(-1) ?? null },
    }),
    ...overrides,
  };
}

function stochasticSimulator(version = "1.0.0"): SimulatorDefinition {
  return {
    id: "noise",
    version,
    mode: "stochastic",
    costCentsPerRun: 0,
    run: ({ variables, random }) => ({
      output: { x: variables.x, noise: random() },
    }),
  };
}

function baseSpec(overrides: Record<string, unknown> = {}): any {
  return {
    question: "What does the cheap model predict?",
    hypothesis: "The in-process simulator preserves the declared relationship.",
    variables: {
      x: { value: 2, provenance: "OBSERVED", confidence: 1 },
      y: { value: 3, provenance: "ASSUMED", confidence: 0.5 },
    },
    simulatorId: "linear",
    simulatorVersion: "1.0.0",
    mode: "deterministic",
    maxRuns: 3,
    costBudgetCents: 3,
    expectedInformationGain: 0.5,
    assumptions: ["The toy relation is stable inside the simulator."],
    ...overrides,
  };
}

describe("P-024 SimulationWorkspace", () => {
  it("activates a revisioned sidecar schema and keeps simulation evidence inferential", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(deterministicSimulator());
      const experiment = workspace.createExperiment(baseSpec({ experimentId: "E-basic" }));
      const completed = workspace.runExperiment(experiment.id);

      const revision = db.prepare(
        "SELECT revision FROM simulation_schema_meta WHERE singleton = 1",
      ).get() as { revision: number };
      expect(revision.revision).toBe(SIMULATION_SCHEMA_REVISION);
      expect(completed.status).toBe("completed");
      expect(completed.runCount).toBe(3);
      expect(completed.spentCents).toBe(3);
      expect(completed.summary).toEqual({ count: 3 });
      expect(completed.result).toEqual({ last: 5 });

      const evidence = getEvidenceByAuthority(db, "simulation_experiment", experiment.id);
      expect(evidence.length).toBeGreaterThanOrEqual(2);
      expect(evidence.every((event) => event.epistemicStatus === "inference")).toBe(true);
      expect(JSON.stringify(evidence)).not.toContain('"seed"');
    } finally {
      db.close();
    }
  });

  it("replays deterministic runs exactly without writing duplicate runs", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(deterministicSimulator());
      const experiment = workspace.createExperiment(baseSpec({ experimentId: "E-replay" }));
      workspace.runExperiment(experiment.id, 1);
      const before = workspace.getRuns(experiment.id);
      const replay = workspace.replayRun(experiment.id, 0);
      const after = workspace.getRuns(experiment.id);

      expect(replay.matches).toBe(true);
      expect(replay.expected).toBe(5);
      expect(replay.actual).toBe(5);
      expect(after).toEqual(before);
    } finally {
      db.close();
    }
  });

  it("reproduces stochastic runs across restart with exact seed and simulator version", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p024-restart-"));
    const dbPath = path.join(dir, "state.db");
    try {
      const firstDb = new Database(dbPath);
      const first = new SimulationWorkspace(firstDb);
      first.registerSimulator(stochasticSimulator());
      const experiment = first.createExperiment({
        ...baseSpec({
          experimentId: "E-stochastic",
          simulatorId: "noise",
          mode: "stochastic",
          seed: "reproducible-seed",
          costBudgetCents: 0,
        }),
      });
      first.runExperiment(experiment.id, 2);
      const originalRuns = first.getRuns(experiment.id);
      firstDb.close();

      const reopenedDb = new Database(dbPath);
      try {
        const reopened = new SimulationWorkspace(reopenedDb);
        reopened.registerSimulator(stochasticSimulator());
        expect(reopened.replayRun(experiment.id, 0).matches).toBe(true);
        expect(reopened.replayRun(experiment.id, 1).matches).toBe(true);
        reopened.runExperiment(experiment.id, 1);
        const resumedRuns = reopened.getRuns(experiment.id);
        expect(resumedRuns.map((run) => run.runIndex)).toEqual([0, 1, 2]);
        expect(resumedRuns.slice(0, 2)).toEqual(originalRuns);
      } finally {
        reopenedDb.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses common random numbers for counterfactuals while preserving untouched variable provenance", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(stochasticSimulator());
      const base = workspace.createExperiment({
        ...baseSpec({
          experimentId: "E-base-cf",
          simulatorId: "noise",
          mode: "stochastic",
          seed: "paired-seed",
          costBudgetCents: 0,
          maxRuns: 1,
        }),
      });
      const counterfactual = workspace.createCounterfactual(base.id, {
        experimentId: "E-cf",
        question: "What if x were 20?",
        hypothesis: "Only x should change while the random draw remains paired.",
        overrides: {
          x: { value: 20, provenance: "ASSUMED", confidence: 0.7 },
        },
        maxRuns: 1,
        costBudgetCents: 0,
      });
      workspace.runExperiment(base.id);
      workspace.runExperiment(counterfactual.id);

      expect(counterfactual.parentExperimentId).toBe(base.id);
      expect(counterfactual.variables.y).toEqual(base.variables.y);
      expect(counterfactual.variables.x.provenance).toBe("ASSUMED");
      const baseOutput = workspace.getRuns(base.id)[0].output as any;
      const cfOutput = workspace.getRuns(counterfactual.id)[0].output as any;
      expect(cfOutput.x).toBe(20);
      expect(baseOutput.noise).toBe(cfOutput.noise);
    } finally {
      db.close();
    }
  });

  it("enforces run and cent budgets before invoking the simulator", () => {
    const db = new Database(":memory:");
    let calls = 0;
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(deterministicSimulator({
        costCentsPerRun: 3,
        run: ({ variables }) => {
          calls += 1;
          return Number(variables.x ?? 0);
        },
      }));
      const experiment = workspace.createExperiment(baseSpec({
        experimentId: "E-budget",
        maxRuns: 3,
        costBudgetCents: 5,
      }));
      const result = workspace.runExperiment(experiment.id, 3);

      expect(calls).toBe(1);
      expect(result.runCount).toBe(1);
      expect(result.spentCents).toBe(3);
      expect(result.status).toBe("budget_exhausted");
      expect(workspace.getRuns(experiment.id)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("fails replay when the exact simulator version is unavailable instead of falling back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p024-version-"));
    const dbPath = path.join(dir, "state.db");
    try {
      const firstDb = new Database(dbPath);
      const first = new SimulationWorkspace(firstDb);
      first.registerSimulator(deterministicSimulator());
      const experiment = first.createExperiment(baseSpec({ experimentId: "E-version" }));
      first.runExperiment(experiment.id, 1);
      firstDb.close();

      const reopenedDb = new Database(dbPath);
      try {
        const reopened = new SimulationWorkspace(reopenedDb);
        reopened.registerSimulator(deterministicSimulator({ version: "2.0.0" }));
        expect(() => reopened.replayRun(experiment.id, 0)).toThrow(
          "exact simulator unavailable: linear@1.0.0",
        );
      } finally {
        reopenedDb.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires real observation evidence for simulated-to-real calibration", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(deterministicSimulator());
      const experiment = workspace.createExperiment(baseSpec({ experimentId: "E-calibration" }));
      workspace.runExperiment(experiment.id, 1);

      const inferred = appendEvidenceEvent(db, {
        correlationId: "external:test",
        eventType: "external.estimate",
        domain: "test",
        authorityType: "test_source",
        authorityId: "estimate-1",
        epistemicStatus: "inference",
        payload: { value: 5 },
      });
      expect(() => workspace.recordCalibration(experiment.id, inferred.id)).toThrow(
        "calibration requires external observation evidence; got inference",
      );

      const observed = appendEvidenceEvent(db, {
        correlationId: "external:test",
        eventType: "external.observed",
        domain: "test",
        authorityType: "test_source",
        authorityId: "observation-1",
        epistemicStatus: "observation",
        payload: { value: 5 },
      });
      const calibration = workspace.recordCalibration(experiment.id, observed.id, {
        score: 0,
        comparison: { absoluteError: 0 },
      });
      const duplicate = workspace.recordCalibration(experiment.id, observed.id, {
        score: 99,
        comparison: { shouldNotOverwrite: true },
      });

      expect(duplicate).toEqual(calibration);
      expect(workspace.getCalibrations(experiment.id)).toEqual([calibration]);
      const evidence = getEvidenceByAuthority(db, "simulation_experiment", experiment.id);
      expect(evidence.at(-1)?.eventType).toBe("simulation.calibrated");
      expect(evidence.at(-1)?.epistemicStatus).toBe("inference");
    } finally {
      db.close();
    }
  });

  it("makes experiment creation idempotent by id+spec and rejects semantic collisions", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(deterministicSimulator());
      const first = workspace.createExperiment(baseSpec({ experimentId: "E-idempotent" }));
      const second = workspace.createExperiment(baseSpec({ experimentId: "E-idempotent" }));
      expect(second).toEqual(first);
      expect(getEvidenceByAuthority(db, "simulation_experiment", first.id)).toHaveLength(1);
      expect(() => workspace.createExperiment(baseSpec({
        experimentId: "E-idempotent",
        hypothesis: "different semantic content",
      }))).toThrow("experiment id collision with different spec");
    } finally {
      db.close();
    }
  });

  it("persists completed runs before a later simulator failure without duplicating them", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(deterministicSimulator({
        run: ({ runIndex }) => {
          if (runIndex === 1) throw new Error("synthetic simulator fault");
          return { output: runIndex };
        },
      }));
      const experiment = workspace.createExperiment(baseSpec({ experimentId: "E-fault" }));
      expect(() => workspace.runExperiment(experiment.id, 3)).toThrow("synthetic simulator fault");
      const after = workspace.getExperiment(experiment.id)!;
      expect(after.status).toBe("failed");
      expect(after.runCount).toBe(1);
      expect(workspace.getRuns(experiment.id).map((run) => run.runIndex)).toEqual([0]);
      expect(() => workspace.runExperiment(experiment.id, 1)).toThrow(
        "experiment is failed and requires a new experiment",
      );
    } finally {
      db.close();
    }
  });

  it("rejects async simulators so external/late side effects cannot hide behind a run", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(deterministicSimulator({
        run: (() => Promise.resolve({ output: 5 })) as any,
      }));
      const experiment = workspace.createExperiment(baseSpec({ experimentId: "E-async" }));
      expect(() => workspace.runExperiment(experiment.id, 1)).toThrow(
        "simulation run must be synchronous",
      );
      expect(workspace.getExperiment(experiment.id)?.status).toBe("failed");
      expect(workspace.getRuns(experiment.id)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
