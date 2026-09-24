import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  SimulationWorkspace,
  type ExperimentSpec,
  type SimulatorDefinition,
} from "../intelligence/simulation-workspace.js";

function stochasticSpec(experimentId: string): ExperimentSpec {
  return {
    experimentId,
    question: "Does an omitted stochastic seed remain retry-safe?",
    hypothesis: "The persisted seed is the authority after first creation.",
    variables: {
      x: { value: 1, provenance: "OBSERVED", confidence: 1 },
    },
    simulatorId: "noise",
    simulatorVersion: "1.0.0",
    mode: "stochastic",
    maxRuns: 1,
    costBudgetCents: 0,
  };
}

const stochasticSimulator: SimulatorDefinition = {
  id: "noise",
  version: "1.0.0",
  mode: "stochastic",
  costCentsPerRun: 0,
  run: ({ random }) => ({ output: random() }),
};

describe("P-024 adversarial recovery", () => {
  it("reuses the persisted stochastic seed when a fixed experiment id is retried without a seed", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(stochasticSimulator);
      const first = workspace.createExperiment(stochasticSpec("E-stochastic-retry"));
      const second = workspace.createExperiment(stochasticSpec("E-stochastic-retry"));

      expect(first.seed).toBeTruthy();
      expect(second).toEqual(first);
      expect(second.seed).toBe(first.seed);
    } finally {
      db.close();
    }
  });

  it("marks the experiment failed if summarization fails after confirmed runs", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator({
        id: "summary-fault",
        version: "1.0.0",
        mode: "deterministic",
        costCentsPerRun: 1,
        run: ({ runIndex }) => ({ output: runIndex }),
        summarize: () => {
          throw new Error("synthetic summary fault");
        },
      });
      const experiment = workspace.createExperiment({
        experimentId: "E-summary-fault",
        question: "Does summary failure leave explicit state?",
        hypothesis: "Persisted runs survive while the experiment becomes failed.",
        variables: {},
        simulatorId: "summary-fault",
        simulatorVersion: "1.0.0",
        mode: "deterministic",
        maxRuns: 2,
        costBudgetCents: 2,
      });

      expect(() => workspace.runExperiment(experiment.id, 2)).toThrow("synthetic summary fault");
      const after = workspace.getExperiment(experiment.id)!;
      expect(after.status).toBe("failed");
      expect(after.runCount).toBe(2);
      expect(after.spentCents).toBe(2);
      expect(workspace.getRuns(experiment.id).map((run) => run.runIndex)).toEqual([0, 1]);
      expect(() => workspace.runExperiment(experiment.id, 1)).toThrow(
        "experiment is failed and requires a new experiment",
      );
    } finally {
      db.close();
    }
  });
});
