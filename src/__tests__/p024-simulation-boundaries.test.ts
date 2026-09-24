import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { appendEvidenceEvent } from "../observability/evidence.js";
import {
  SimulationWorkspace,
  type ExperimentSpec,
  type SimulatorDefinition,
} from "../intelligence/simulation-workspace.js";
import { SIMULATION_SCHEMA_REVISION } from "../state/simulation-schema.js";

const deterministicSimulator: SimulatorDefinition = {
  id: "boundary-sim",
  version: "1.0.0",
  mode: "deterministic",
  costCentsPerRun: 0,
  run: ({ variables }) => ({
    output: Number(variables.x ?? 0) * 2,
    surprise: { kind: "boundary", x: variables.x },
  }),
};

function spec(
  experimentId: string,
  overrides: Partial<ExperimentSpec> = {},
): ExperimentSpec {
  return {
    experimentId,
    goalId: "G-recovery",
    pathId: "P-recovery",
    question: "Does the experiment preserve recoverable epistemic state?",
    hypothesis: "The canonical E-xxx authority survives restart without losing boundaries.",
    variables: {
      x: { value: 4, provenance: "OBSERVED", confidence: 1 },
    },
    simulatorId: "boundary-sim",
    simulatorVersion: "1.0.0",
    mode: "deterministic",
    maxRuns: 1,
    costBudgetCents: 0,
    ...overrides,
  };
}

describe("P-024 simulation epistemic/recovery boundaries", () => {
  it("upgrades revision-1 sidecar runs to revision 2 idempotently", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        CREATE TABLE simulation_schema_meta (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          revision INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO simulation_schema_meta(singleton, revision, updated_at)
        VALUES (1, 1, datetime('now'));

        CREATE TABLE simulation_runs (
          id TEXT PRIMARY KEY,
          experiment_id TEXT NOT NULL,
          run_index INTEGER NOT NULL CHECK(run_index >= 0),
          derived_seed TEXT,
          variables_json TEXT NOT NULL,
          output_json TEXT NOT NULL,
          cost_cents INTEGER NOT NULL CHECK(cost_cents >= 0),
          created_at TEXT NOT NULL,
          UNIQUE(experiment_id, run_index)
        );
      `);

      new SimulationWorkspace(db);
      const meta = db.prepare(
        "SELECT revision FROM simulation_schema_meta WHERE singleton = 1",
      ).get() as { revision: number };
      const columns = db.prepare("PRAGMA table_info(simulation_runs)").all() as Array<{
        name: string;
      }>;

      expect(meta.revision).toBe(SIMULATION_SCHEMA_REVISION);
      expect(columns.map((column) => column.name)).toContain("surprise_json");

      expect(() => new SimulationWorkspace(db)).not.toThrow();
      const secondMeta = db.prepare(
        "SELECT revision FROM simulation_schema_meta WHERE singleton = 1",
      ).get() as { revision: number };
      expect(secondMeta.revision).toBe(2);
    } finally {
      db.close();
    }
  });

  it("persists per-run surprises and includes them in exact replay", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(deterministicSimulator);
      const experiment = workspace.createExperiment(spec("E-surprise"));
      const completed = workspace.runExperiment(experiment.id);
      const runs = workspace.getRuns(experiment.id);
      const replay = workspace.replayRun(experiment.id, 0);

      expect(runs).toHaveLength(1);
      expect(runs[0].surprise).toEqual({ kind: "boundary", x: 4 });
      expect(completed.surprises).toEqual([{ kind: "boundary", x: 4 }]);
      expect(replay.matches).toBe(true);
      expect(replay.surpriseMatches).toBe(true);
      expect(replay.expectedSurprise).toEqual({ kind: "boundary", x: 4 });
      expect(replay.actualSurprise).toEqual({ kind: "boundary", x: 4 });
    } finally {
      db.close();
    }
  });

  it("rejects simulation-owned observation evidence as real-world calibration", () => {
    const db = new Database(":memory:");
    try {
      const workspace = new SimulationWorkspace(db);
      workspace.registerSimulator(deterministicSimulator);
      const experiment = workspace.createExperiment(spec("E-self-calibration"));
      workspace.runExperiment(experiment.id);

      const forgedObservation = appendEvidenceEvent(db, {
        correlationId: "simulation:forged-real",
        eventType: "simulation.forged_observation",
        domain: "simulation",
        authorityType: "simulation_experiment",
        authorityId: experiment.id,
        epistemicStatus: "observation",
        payload: { value: 8 },
      });

      expect(() => workspace.recordCalibration(experiment.id, forgedObservation.id)).toThrow(
        "calibration requires an external observation, not simulation-owned evidence",
      );
      expect(workspace.getCalibrations(experiment.id)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("discovers persisted experiments by canonical filters after restart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p024-discovery-"));
    const dbPath = path.join(dir, "state.db");
    try {
      const firstDb = new Database(dbPath);
      const first = new SimulationWorkspace(firstDb);
      first.registerSimulator(deterministicSimulator);
      first.createExperiment(spec("E-recover-me"));
      first.createExperiment(spec("E-other", {
        goalId: "G-other",
        pathId: null,
      }));
      firstDb.close();

      const reopenedDb = new Database(dbPath);
      try {
        const reopened = new SimulationWorkspace(reopenedDb);
        expect(reopened.listExperiments({ goalId: "G-recovery" }).map((item) => item.id)).toEqual([
          "E-recover-me",
        ]);
        expect(reopened.listExperiments({ pathId: "P-recovery" }).map((item) => item.id)).toEqual([
          "E-recover-me",
        ]);
        expect(reopened.listExperiments({ pathId: null }).map((item) => item.id)).toEqual([
          "E-other",
        ]);
        expect(reopened.listExperiments({ status: "draft" }).map((item) => item.id).sort()).toEqual([
          "E-other",
          "E-recover-me",
        ]);
      } finally {
        reopenedDb.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
