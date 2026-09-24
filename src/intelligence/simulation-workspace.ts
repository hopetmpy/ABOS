import { createHash, randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { ulid } from "ulid";
import {
  appendEvidenceEvent,
  correlationIdFor,
  getEvidenceEvent,
  latestEvidenceByAuthority,
} from "../observability/evidence.js";
import { MIGRATION_V18_EVIDENCE_FABRIC } from "../state/schema.js";
import {
  SIMULATION_SCHEMA,
  SIMULATION_SCHEMA_REVISION,
  SIMULATION_SCHEMA_V1_TO_V2,
} from "../state/simulation-schema.js";

export type SimulationMode = "deterministic" | "stochastic";
export type ExperimentStatus =
  | "draft"
  | "running"
  | "completed"
  | "failed"
  | "budget_exhausted";
export type ParameterProvenance =
  | "OBSERVED"
  | "ESTIMATED"
  | "INFERRED"
  | "ASSUMED"
  | "UNKNOWN";

export interface ExperimentVariable {
  value: unknown;
  provenance: ParameterProvenance;
  confidence?: number;
  note?: string;
}

export interface ExperimentSpec {
  experimentId?: string;
  goalId?: string | null;
  pathId?: string | null;
  question: string;
  hypothesis: string;
  variables: Record<string, ExperimentVariable>;
  simulatorId: string;
  simulatorVersion: string;
  mode: SimulationMode;
  seed?: string | null;
  config?: unknown;
  maxRuns: number;
  costBudgetCents: number;
  expectedInformationGain?: number | null;
  assumptions?: string[];
  parentExperimentId?: string | null;
  parentRunIndex?: number | null;
}

export interface CounterfactualSpec {
  experimentId?: string;
  question: string;
  hypothesis: string;
  overrides: Record<string, ExperimentVariable>;
  parentRunIndex?: number | null;
  maxRuns?: number;
  costBudgetCents?: number;
  expectedInformationGain?: number | null;
  assumptions?: string[];
}

export interface SimulationRunContext {
  experimentId: string;
  runIndex: number;
  variables: Readonly<Record<string, unknown>>;
  config: unknown;
  derivedSeed: string | null;
  random: () => number;
}

export interface SimulationRunValue {
  output: unknown;
  surprise?: unknown;
}

export interface SimulationSummary {
  summary?: unknown;
  surprises?: unknown[];
  result?: unknown;
}

export interface SimulatorDefinition {
  id: string;
  version: string;
  mode: SimulationMode;
  /** Exact accounting cost for one in-process run. */
  costCentsPerRun: number;
  run(context: SimulationRunContext): SimulationRunValue | unknown;
  summarize?(outputs: readonly unknown[]): SimulationSummary;
}

export interface ExperimentRecord {
  id: string;
  parentExperimentId: string | null;
  parentRunIndex: number | null;
  goalId: string | null;
  pathId: string | null;
  question: string;
  hypothesis: string;
  variables: Record<string, ExperimentVariable>;
  simulatorId: string;
  simulatorVersion: string;
  mode: SimulationMode;
  seed: string | null;
  config: unknown;
  maxRuns: number;
  costBudgetCents: number;
  expectedInformationGain: number | null;
  assumptions: string[];
  status: ExperimentStatus;
  runCount: number;
  spentCents: number;
  summary: unknown | null;
  surprises: unknown[];
  result: unknown | null;
  lesson: string | null;
  decisionImpact: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ExperimentRunRecord {
  id: string;
  experimentId: string;
  runIndex: number;
  derivedSeed: string | null;
  variables: Record<string, unknown>;
  output: unknown;
  surprise: unknown | null;
  costCents: number;
  createdAt: string;
}

export interface ReplayResult {
  experimentId: string;
  runIndex: number;
  matches: boolean;
  surpriseMatches: boolean;
  expected: unknown;
  actual: unknown;
  expectedSurprise: unknown | null;
  actualSurprise: unknown | null;
}

export interface CalibrationInput {
  score?: number | null;
  comparison?: unknown;
}

export interface CalibrationRecord {
  id: string;
  experimentId: string;
  evidenceEventId: string;
  score: number | null;
  comparison: unknown;
  createdAt: string;
}

export interface ExperimentListFilters {
  goalId?: string | null;
  pathId?: string | null;
  status?: ExperimentStatus;
  parentExperimentId?: string | null;
  limit?: number;
}

const PROVENANCE = new Set<ParameterProvenance>([
  "OBSERVED",
  "ESTIMATED",
  "INFERRED",
  "ASSUMED",
  "UNKNOWN",
]);
const EXPERIMENT_STATUSES = new Set<ExperimentStatus>([
  "draft",
  "running",
  "completed",
  "failed",
  "budget_exhausted",
]);

function requireLabel(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty`);
  return normalized;
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function assertConfidence(value: number | undefined, label: string): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} confidence must be between 0 and 1`);
  }
}

function normalizeJson(
  value: unknown,
  label = "value",
  seen = new WeakSet<object>(),
): unknown {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error(`${label} contains a circular reference`);
    seen.add(value);
    const result = value.map((item, index) => normalizeJson(item, `${label}[${index}]`, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (seen.has(object)) throw new Error(`${label} contains a circular reference`);
    seen.add(object);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      const child = object[key];
      if (child === undefined) throw new Error(`${label}.${key} is undefined`);
      result[key] = normalizeJson(child, `${label}.${key}`, seen);
    }
    seen.delete(object);
    return result;
  }
  throw new Error(`${label} must be JSON-compatible`);
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

function parseJson(value: string | null, fallback: unknown): unknown {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeVariables(
  variables: Record<string, ExperimentVariable>,
): Record<string, ExperimentVariable> {
  const normalized: Record<string, ExperimentVariable> = {};
  for (const name of Object.keys(variables).sort()) {
    const key = requireLabel(name, "variable name");
    const variable = variables[name];
    if (!variable || !PROVENANCE.has(variable.provenance)) {
      throw new Error(`variable ${key} has invalid provenance`);
    }
    assertConfidence(variable.confidence, `variable ${key}`);
    normalized[key] = {
      value: normalizeJson(variable.value, `variable ${key}.value`),
      provenance: variable.provenance,
      ...(variable.confidence === undefined ? {} : { confidence: variable.confidence }),
      ...(variable.note === undefined
        ? {}
        : { note: requireLabel(variable.note, `variable ${key}.note`) }),
    };
  }
  return normalized;
}

function variableValues(
  variables: Record<string, ExperimentVariable>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(variables).map(([name, variable]) => [name, variable.value]),
  );
}

function normalizeAssumptions(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => requireLabel(value, "assumption")))];
}

function normalizeExperimentSpec(input: ExperimentSpec): Required<
  Omit<
    ExperimentSpec,
    | "experimentId"
    | "goalId"
    | "pathId"
    | "seed"
    | "config"
    | "expectedInformationGain"
    | "assumptions"
    | "parentExperimentId"
    | "parentRunIndex"
  >
> & {
  experimentId: string;
  goalId: string | null;
  pathId: string | null;
  seed: string | null;
  config: unknown;
  expectedInformationGain: number | null;
  assumptions: string[];
  parentExperimentId: string | null;
  parentRunIndex: number | null;
} {
  const mode = input.mode;
  if (mode !== "deterministic" && mode !== "stochastic") {
    throw new Error(`unsupported simulation mode: ${String(mode)}`);
  }
  const expectedInformationGain = input.expectedInformationGain ?? null;
  if (
    expectedInformationGain !== null &&
    (!Number.isFinite(expectedInformationGain) || expectedInformationGain < 0)
  ) {
    throw new Error("expectedInformationGain must be a finite non-negative number when provided");
  }
  const parentRunIndex = input.parentRunIndex ?? null;
  if (parentRunIndex !== null) requireNonNegativeInteger(parentRunIndex, "parentRunIndex");
  const seed = mode === "stochastic"
    ? requireLabel(input.seed ?? randomUUID(), "seed")
    : null;
  return {
    experimentId: requireLabel(input.experimentId ?? `E-${ulid()}`, "experimentId"),
    goalId: input.goalId == null ? null : requireLabel(input.goalId, "goalId"),
    pathId: input.pathId == null ? null : requireLabel(input.pathId, "pathId"),
    question: requireLabel(input.question, "question"),
    hypothesis: requireLabel(input.hypothesis, "hypothesis"),
    variables: normalizeVariables(input.variables),
    simulatorId: requireLabel(input.simulatorId, "simulatorId"),
    simulatorVersion: requireLabel(input.simulatorVersion, "simulatorVersion"),
    mode,
    seed,
    config: normalizeJson(input.config ?? {}, "config"),
    maxRuns: requirePositiveInteger(input.maxRuns, "maxRuns"),
    costBudgetCents: requireNonNegativeInteger(input.costBudgetCents, "costBudgetCents"),
    expectedInformationGain,
    assumptions: normalizeAssumptions(input.assumptions),
    parentExperimentId: input.parentExperimentId == null
      ? null
      : requireLabel(input.parentExperimentId, "parentExperimentId"),
    parentRunIndex,
  };
}

function specFingerprint(spec: ReturnType<typeof normalizeExperimentSpec>): string {
  const { experimentId: _id, ...stable } = spec;
  return createHash("sha256").update(canonicalStringify(stable)).digest("hex");
}

function simulatorKey(id: string, version: string): string {
  return `${id}\u0000${version}`;
}

function deriveSeed(baseSeed: string, runIndex: number): string {
  return createHash("sha256").update(`${baseSeed}:${runIndex}`).digest("hex");
}

function seededRandom(seed: string): () => number {
  let state = Number.parseInt(seed.slice(0, 8), 16) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicRandom(): number {
  throw new Error("deterministic simulator requested randomness");
}

function deserializeExperiment(row: any): ExperimentRecord {
  return {
    id: row.id,
    parentExperimentId: row.parent_experiment_id ?? null,
    parentRunIndex: row.parent_run_index ?? null,
    goalId: row.goal_id ?? null,
    pathId: row.path_id ?? null,
    question: row.question,
    hypothesis: row.hypothesis,
    variables: parseJson(row.variables_json, {}) as Record<string, ExperimentVariable>,
    simulatorId: row.simulator_id,
    simulatorVersion: row.simulator_version,
    mode: row.mode,
    seed: row.base_seed ?? null,
    config: parseJson(row.config_json, {}),
    maxRuns: row.max_runs,
    costBudgetCents: row.cost_budget_cents,
    expectedInformationGain: row.expected_information_gain ?? null,
    assumptions: parseJson(row.assumptions_json, []) as string[],
    status: row.status,
    runCount: row.run_count,
    spentCents: row.spent_cents,
    summary: parseJson(row.summary_json, null),
    surprises: parseJson(row.surprises_json, []) as unknown[],
    result: parseJson(row.result_json, null),
    lesson: row.lesson ?? null,
    decisionImpact: row.decision_impact ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? null,
  };
}

function deserializeRun(row: any): ExperimentRunRecord {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    runIndex: row.run_index,
    derivedSeed: row.derived_seed ?? null,
    variables: parseJson(row.variables_json, {}) as Record<string, unknown>,
    output: parseJson(row.output_json, null),
    surprise: parseJson(row.surprise_json ?? null, null),
    costCents: row.cost_cents,
    createdAt: row.created_at,
  };
}

function unwrapRunValue(value: SimulationRunValue | unknown): SimulationRunValue {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "output")
  ) {
    const candidate = value as SimulationRunValue;
    return {
      output: normalizeJson(candidate.output, "simulator output"),
      ...(candidate.surprise === undefined
        ? {}
        : { surprise: normalizeJson(candidate.surprise, "simulator surprise") }),
    };
  }
  return { output: normalizeJson(value, "simulator output") };
}

export class SimulationWorkspace {
  private readonly simulators = new Map<string, SimulatorDefinition>();

  constructor(private readonly db: Database) {
    // The database remains globally owned by the state layer; this sidecar is
    // domain-owned so raw SQLite embeddings/tests can activate it idempotently.
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    db.exec(SIMULATION_SCHEMA);
    let meta = this.readSchemaMeta();
    if (meta?.revision === 1 && SIMULATION_SCHEMA_REVISION === 2) {
      db.transaction(() => db.exec(SIMULATION_SCHEMA_V1_TO_V2))();
      meta = this.readSchemaMeta();
    }
    if (meta?.revision !== SIMULATION_SCHEMA_REVISION) {
      throw new Error(
        `unsupported simulation schema revision: ${String(meta?.revision ?? "missing")}`,
      );
    }
  }

  registerSimulator(definition: SimulatorDefinition): void {
    const id = requireLabel(definition.id, "simulator id");
    const version = requireLabel(definition.version, "simulator version");
    if (definition.mode !== "deterministic" && definition.mode !== "stochastic") {
      throw new Error(`unsupported simulator mode: ${String(definition.mode)}`);
    }
    requireNonNegativeInteger(definition.costCentsPerRun, "costCentsPerRun");
    if (typeof definition.run !== "function") throw new Error("simulator run must be a function");
    const key = simulatorKey(id, version);
    if (this.simulators.has(key)) {
      throw new Error(`simulator already registered: ${id}@${version}`);
    }
    this.simulators.set(key, { ...definition, id, version });
  }

  createExperiment(input: ExperimentSpec): ExperimentRecord {
    const requestedId = input.experimentId == null
      ? null
      : requireLabel(input.experimentId, "experimentId");
    const existingBeforeNormalize = requestedId == null
      ? undefined
      : this.getExperiment(requestedId);
    const normalizedInput =
      existingBeforeNormalize && input.mode === "stochastic" && input.seed == null
        ? { ...input, seed: existingBeforeNormalize.seed }
        : input;
    const spec = normalizeExperimentSpec(normalizedInput);

    if (spec.parentExperimentId) {
      const parent = this.getExperiment(spec.parentExperimentId);
      if (!parent) throw new Error(`parent experiment not found: ${spec.parentExperimentId}`);
      if (spec.parentRunIndex !== null && !this.getRun(parent.id, spec.parentRunIndex)) {
        throw new Error(`parent run not found: ${spec.parentExperimentId}#${spec.parentRunIndex}`);
      }
    } else if (spec.parentRunIndex !== null) {
      throw new Error("parentRunIndex requires parentExperimentId");
    }

    const fingerprint = specFingerprint(spec);
    const existing = existingBeforeNormalize ?? this.getExperiment(spec.experimentId);
    if (existing) {
      const row = this.db.prepare(
        "SELECT spec_fingerprint FROM simulation_experiments WHERE id = ?",
      ).get(spec.experimentId) as { spec_fingerprint: string };
      if (row.spec_fingerprint !== fingerprint) {
        throw new Error(`experiment id collision with different spec: ${spec.experimentId}`);
      }
      return existing;
    }

    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO simulation_experiments (
          id, spec_fingerprint, parent_experiment_id, parent_run_index,
          goal_id, path_id, question, hypothesis, variables_json,
          simulator_id, simulator_version, mode, base_seed, config_json,
          max_runs, cost_budget_cents, expected_information_gain,
          assumptions_json, status, run_count, spent_cents,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, 0, ?, ?)`,
      ).run(
        spec.experimentId,
        fingerprint,
        spec.parentExperimentId,
        spec.parentRunIndex,
        spec.goalId,
        spec.pathId,
        spec.question,
        spec.hypothesis,
        canonicalStringify(spec.variables),
        spec.simulatorId,
        spec.simulatorVersion,
        spec.mode,
        spec.seed,
        canonicalStringify(spec.config),
        spec.maxRuns,
        spec.costBudgetCents,
        spec.expectedInformationGain,
        canonicalStringify(spec.assumptions),
        now,
        now,
      );
      this.appendExperimentEvidence(spec.experimentId, "simulation.experiment.created", {
        simulatorId: spec.simulatorId,
        simulatorVersion: spec.simulatorVersion,
        mode: spec.mode,
        maxRuns: spec.maxRuns,
        costBudgetCents: spec.costBudgetCents,
        parentExperimentId: spec.parentExperimentId,
      });
    })();
    return this.requireExperiment(spec.experimentId);
  }

  createCounterfactual(
    baseExperimentId: string,
    input: CounterfactualSpec,
  ): ExperimentRecord {
    const base = this.requireExperiment(baseExperimentId);
    const variables = { ...base.variables, ...normalizeVariables(input.overrides) };
    return this.createExperiment({
      experimentId: input.experimentId,
      goalId: base.goalId,
      pathId: base.pathId,
      question: input.question,
      hypothesis: input.hypothesis,
      variables,
      simulatorId: base.simulatorId,
      simulatorVersion: base.simulatorVersion,
      mode: base.mode,
      seed: base.seed,
      config: base.config,
      maxRuns: input.maxRuns ?? base.maxRuns,
      costBudgetCents: input.costBudgetCents ?? base.costBudgetCents,
      expectedInformationGain:
        input.expectedInformationGain === undefined
          ? base.expectedInformationGain
          : input.expectedInformationGain,
      assumptions: input.assumptions ?? base.assumptions,
      parentExperimentId: base.id,
      parentRunIndex: input.parentRunIndex ?? null,
    });
  }

  runExperiment(experimentId: string, requestedRuns?: number): ExperimentRecord {
    let experiment = this.requireExperiment(experimentId);
    if (requestedRuns !== undefined) requirePositiveInteger(requestedRuns, "requestedRuns");
    if (experiment.status === "completed" || experiment.status === "budget_exhausted") {
      return experiment;
    }
    if (experiment.status === "failed") {
      throw new Error(`experiment is failed and requires a new experiment: ${experiment.id}`);
    }

    const simulator = this.requireSimulator(experiment);
    const remaining = experiment.maxRuns - experiment.runCount;
    const target = Math.min(requestedRuns ?? remaining, remaining);
    let completedInCall = 0;

    try {
      while (completedInCall < target) {
        experiment = this.requireExperiment(experiment.id);
        if (experiment.runCount >= experiment.maxRuns) break;
        if (experiment.spentCents + simulator.costCentsPerRun > experiment.costBudgetCents) {
          this.db.prepare(
            `UPDATE simulation_experiments
             SET status = 'budget_exhausted', updated_at = ?
             WHERE id = ?`,
          ).run(new Date().toISOString(), experiment.id);
          break;
        }
        this.executeOneRun(experiment, simulator);
        completedInCall += 1;
      }

      experiment = this.refreshSummary(experiment.id, simulator);
      experiment = this.finishIfComplete(experiment);
      this.appendExperimentEvidence(experiment.id, "simulation.batch.completed", {
        requestedRuns: requestedRuns ?? null,
        completedInCall,
        runCount: experiment.runCount,
        spentCents: experiment.spentCents,
        status: experiment.status,
      });
      return this.requireExperiment(experiment.id);
    } catch (error) {
      this.failExperiment(experiment.id, error);
      throw error;
    }
  }

  replayRun(experimentId: string, runIndex: number): ReplayResult {
    requireNonNegativeInteger(runIndex, "runIndex");
    const experiment = this.requireExperiment(experimentId);
    const persisted = this.getRun(experimentId, runIndex);
    if (!persisted) throw new Error(`simulation run not found: ${experimentId}#${runIndex}`);
    const simulator = this.requireSimulator(experiment);
    const actual = this.invokeSimulator(experiment, simulator, runIndex, persisted.derivedSeed);
    const actualSurprise = actual.surprise === undefined ? null : actual.surprise;
    const outputMatches = canonicalStringify(actual.output) === canonicalStringify(persisted.output);
    const surpriseMatches =
      canonicalStringify(actualSurprise) === canonicalStringify(persisted.surprise);
    return {
      experimentId,
      runIndex,
      matches: outputMatches && surpriseMatches,
      surpriseMatches,
      expected: persisted.output,
      actual: actual.output,
      expectedSurprise: persisted.surprise,
      actualSurprise,
    };
  }

  recordCalibration(
    experimentId: string,
    evidenceEventId: string,
    input: CalibrationInput = {},
  ): CalibrationRecord {
    const experiment = this.requireExperiment(experimentId);
    const evidence = getEvidenceEvent(this.db, requireLabel(evidenceEventId, "evidenceEventId"));
    if (!evidence) throw new Error(`evidence event not found: ${evidenceEventId}`);
    if (evidence.epistemicStatus !== "observation") {
      throw new Error(
        `calibration requires external observation evidence; got ${evidence.epistemicStatus}`,
      );
    }
    if (evidence.domain === "simulation" || evidence.authorityType === "simulation_experiment") {
      throw new Error("calibration requires an external observation, not simulation-owned evidence");
    }

    const score = input.score ?? null;
    if (score !== null && !Number.isFinite(score)) {
      throw new Error("calibration score must be finite when provided");
    }
    const comparison = normalizeJson(input.comparison ?? {}, "calibration comparison");
    const existing = this.db.prepare(
      `SELECT * FROM simulation_calibrations
       WHERE experiment_id = ? AND evidence_event_id = ?`,
    ).get(experiment.id, evidence.id) as any | undefined;
    if (existing) return this.deserializeCalibration(existing);

    const record: CalibrationRecord = {
      id: `C-${ulid()}`,
      experimentId: experiment.id,
      evidenceEventId: evidence.id,
      score,
      comparison,
      createdAt: new Date().toISOString(),
    };
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO simulation_calibrations (
          id, experiment_id, evidence_event_id, score, comparison_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.experimentId,
        record.evidenceEventId,
        record.score,
        canonicalStringify(record.comparison),
        record.createdAt,
      );
      appendEvidenceEvent(this.db, {
        correlationId: this.correlationId(experiment),
        causationId: evidence.id,
        eventType: "simulation.calibrated",
        domain: "simulation",
        authorityType: "simulation_experiment",
        authorityId: experiment.id,
        goalId: experiment.goalId,
        epistemicStatus: "inference",
        payload: {
          calibrationId: record.id,
          realEvidenceId: evidence.id,
          score,
          comparison,
        },
        provenance: {
          source: "simulation_workspace",
          schemaRevision: SIMULATION_SCHEMA_REVISION,
        },
      });
    })();
    return record;
  }

  setInterpretation(
    experimentId: string,
    input: { lesson?: string | null; decisionImpact?: string | null },
  ): ExperimentRecord {
    const experiment = this.requireExperiment(experimentId);
    const lesson = input.lesson == null ? null : requireLabel(input.lesson, "lesson");
    const decisionImpact = input.decisionImpact == null
      ? null
      : requireLabel(input.decisionImpact, "decisionImpact");
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE simulation_experiments
       SET lesson = ?, decision_impact = ?, updated_at = ?
       WHERE id = ?`,
    ).run(lesson, decisionImpact, now, experiment.id);
    this.appendExperimentEvidence(experiment.id, "simulation.interpretation.updated", {
      hasLesson: lesson !== null,
      hasDecisionImpact: decisionImpact !== null,
    });
    return this.requireExperiment(experiment.id);
  }

  getExperiment(id: string): ExperimentRecord | undefined {
    const row = this.db.prepare(
      "SELECT * FROM simulation_experiments WHERE id = ?",
    ).get(id) as any | undefined;
    return row ? deserializeExperiment(row) : undefined;
  }

  listExperiments(filters: ExperimentListFilters = {}): ExperimentRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const addNullableFilter = (column: string, value: string | null, label: string) => {
      if (value === null) {
        clauses.push(`${column} IS NULL`);
      } else {
        clauses.push(`${column} = ?`);
        params.push(requireLabel(value, label));
      }
    };

    if (filters.goalId !== undefined) addNullableFilter("goal_id", filters.goalId, "goalId");
    if (filters.pathId !== undefined) addNullableFilter("path_id", filters.pathId, "pathId");
    if (filters.parentExperimentId !== undefined) {
      addNullableFilter(
        "parent_experiment_id",
        filters.parentExperimentId,
        "parentExperimentId",
      );
    }
    if (filters.status !== undefined) {
      if (!EXPERIMENT_STATUSES.has(filters.status)) {
        throw new Error(`unsupported experiment status: ${String(filters.status)}`);
      }
      clauses.push("status = ?");
      params.push(filters.status);
    }
    const limit = filters.limit ?? 100;
    requirePositiveInteger(limit, "limit");
    if (limit > 1000) throw new Error("limit must be <= 1000");
    params.push(limit);

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(
      `SELECT * FROM simulation_experiments${where}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(...params) as any[];
    return rows.map(deserializeExperiment);
  }

  getRuns(experimentId: string): ExperimentRunRecord[] {
    const rows = this.db.prepare(
      `SELECT * FROM simulation_runs
       WHERE experiment_id = ? ORDER BY run_index ASC`,
    ).all(experimentId) as any[];
    return rows.map(deserializeRun);
  }

  getCalibrations(experimentId: string): CalibrationRecord[] {
    const rows = this.db.prepare(
      `SELECT * FROM simulation_calibrations
       WHERE experiment_id = ? ORDER BY created_at ASC, id ASC`,
    ).all(experimentId) as any[];
    return rows.map((row) => this.deserializeCalibration(row));
  }

  private readSchemaMeta(): { revision: number } | undefined {
    return this.db.prepare(
      "SELECT revision FROM simulation_schema_meta WHERE singleton = 1",
    ).get() as { revision: number } | undefined;
  }

  private requireExperiment(id: string): ExperimentRecord {
    const experiment = this.getExperiment(requireLabel(id, "experimentId"));
    if (!experiment) throw new Error(`experiment not found: ${id}`);
    return experiment;
  }

  private getRun(experimentId: string, runIndex: number): ExperimentRunRecord | undefined {
    const row = this.db.prepare(
      `SELECT * FROM simulation_runs
       WHERE experiment_id = ? AND run_index = ?`,
    ).get(experimentId, runIndex) as any | undefined;
    return row ? deserializeRun(row) : undefined;
  }

  private requireSimulator(experiment: ExperimentRecord): SimulatorDefinition {
    const simulator = this.simulators.get(
      simulatorKey(experiment.simulatorId, experiment.simulatorVersion),
    );
    if (!simulator) {
      throw new Error(
        `exact simulator unavailable: ${experiment.simulatorId}@${experiment.simulatorVersion}`,
      );
    }
    if (simulator.mode !== experiment.mode) {
      throw new Error(
        `simulator mode mismatch for ${experiment.simulatorId}@${experiment.simulatorVersion}`,
      );
    }
    return simulator;
  }

  private executeOneRun(
    experiment: ExperimentRecord,
    simulator: SimulatorDefinition,
  ): ExperimentRunRecord {
    const runIndex = experiment.runCount;
    const derivedSeed = experiment.mode === "stochastic"
      ? deriveSeed(experiment.seed!, runIndex)
      : null;
    return this.db.transaction(() => {
      const current = this.requireExperiment(experiment.id);
      if (current.runCount !== runIndex) {
        throw new Error(
          `concurrent simulation state changed for ${experiment.id}: expected run ${runIndex}, got ${current.runCount}`,
        );
      }
      if (current.spentCents + simulator.costCentsPerRun > current.costBudgetCents) {
        throw new Error(`simulation budget changed before run ${runIndex}`);
      }

      const value = this.invokeSimulator(current, simulator, runIndex, derivedSeed);
      const surprise = value.surprise === undefined ? null : value.surprise;
      const now = new Date().toISOString();
      const record: ExperimentRunRecord = {
        id: `R-${ulid()}`,
        experimentId: current.id,
        runIndex,
        derivedSeed,
        variables: variableValues(current.variables),
        output: value.output,
        surprise,
        costCents: simulator.costCentsPerRun,
        createdAt: now,
      };
      this.db.prepare(
        `INSERT INTO simulation_runs (
          id, experiment_id, run_index, derived_seed, variables_json,
          output_json, surprise_json, cost_cents, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.id,
        record.experimentId,
        record.runIndex,
        record.derivedSeed,
        canonicalStringify(record.variables),
        canonicalStringify(record.output),
        record.surprise === null ? null : canonicalStringify(record.surprise),
        record.costCents,
        record.createdAt,
      );
      this.db.prepare(
        `UPDATE simulation_experiments
         SET status = 'running', run_count = run_count + 1,
             spent_cents = spent_cents + ?, updated_at = ?
         WHERE id = ?`,
      ).run(record.costCents, now, current.id);
      return record;
    })();
  }

  private invokeSimulator(
    experiment: ExperimentRecord,
    simulator: SimulatorDefinition,
    runIndex: number,
    derivedSeed: string | null,
  ): SimulationRunValue {
    const random = experiment.mode === "stochastic"
      ? seededRandom(derivedSeed ?? deriveSeed(experiment.seed!, runIndex))
      : deterministicRandom;
    const raw = simulator.run({
      experimentId: experiment.id,
      runIndex,
      variables: Object.freeze(variableValues(experiment.variables)),
      config: experiment.config,
      derivedSeed,
      random,
    });
    if (raw && typeof (raw as any).then === "function") {
      throw new Error("simulation run must be synchronous; async/external execution belongs behind policy");
    }
    return unwrapRunValue(raw);
  }

  private refreshSummary(
    experimentId: string,
    simulator: SimulatorDefinition,
  ): ExperimentRecord {
    const runs = this.getRuns(experimentId);
    if (runs.length === 0) return this.requireExperiment(experimentId);

    const runSurprises = runs
      .map((run) => run.surprise)
      .filter((value): value is Exclude<unknown, null> => value !== null);
    let summary: unknown | null = null;
    let result: unknown | null = null;
    let summarizerSurprises: unknown[] = [];

    if (simulator.summarize) {
      const value = simulator.summarize(runs.map((run) => run.output));
      if (value && typeof (value as any).then === "function") {
        throw new Error("simulation summary must be synchronous");
      }
      summary = value.summary === undefined ? null : normalizeJson(value.summary, "summary");
      const normalizedSurprises = value.surprises === undefined
        ? []
        : normalizeJson(value.surprises, "surprises");
      if (!Array.isArray(normalizedSurprises)) throw new Error("surprises must be an array");
      summarizerSurprises = normalizedSurprises;
      result = value.result === undefined ? null : normalizeJson(value.result, "result");
    }

    const surprises = [...runSurprises, ...summarizerSurprises];
    this.db.prepare(
      `UPDATE simulation_experiments
       SET summary_json = ?, surprises_json = ?, result_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      summary === null ? null : canonicalStringify(summary),
      canonicalStringify(surprises),
      result === null ? null : canonicalStringify(result),
      new Date().toISOString(),
      experimentId,
    );
    return this.requireExperiment(experimentId);
  }

  private finishIfComplete(experiment: ExperimentRecord): ExperimentRecord {
    if (experiment.runCount < experiment.maxRuns) return experiment;
    if (experiment.status === "completed") return experiment;
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE simulation_experiments
       SET status = 'completed', completed_at = COALESCE(completed_at, ?), updated_at = ?
       WHERE id = ?`,
    ).run(now, now, experiment.id);
    return this.requireExperiment(experiment.id);
  }

  private failExperiment(experimentId: string, error: unknown): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE simulation_experiments
       SET status = 'failed', updated_at = ?
       WHERE id = ?`,
    ).run(now, experimentId);
    this.appendExperimentEvidence(experimentId, "simulation.experiment.failed", {
      error: error instanceof Error ? error.message : String(error),
      runCount: this.requireExperiment(experimentId).runCount,
    });
  }

  private appendExperimentEvidence(
    experimentId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    const experiment = this.requireExperiment(experimentId);
    const previous = latestEvidenceByAuthority(
      this.db,
      "simulation_experiment",
      experiment.id,
    );
    appendEvidenceEvent(this.db, {
      correlationId: this.correlationId(experiment),
      causationId: previous?.id ?? null,
      eventType,
      domain: "simulation",
      authorityType: "simulation_experiment",
      authorityId: experiment.id,
      goalId: experiment.goalId,
      epistemicStatus: "inference",
      payload,
      provenance: {
        source: "simulation_workspace",
        schemaRevision: SIMULATION_SCHEMA_REVISION,
      },
    });
  }

  private correlationId(experiment: ExperimentRecord): string {
    return experiment.goalId
      ? correlationIdFor("goal", experiment.goalId)
      : correlationIdFor("experiment", experiment.id);
  }

  private deserializeCalibration(row: any): CalibrationRecord {
    return {
      id: row.id,
      experimentId: row.experiment_id,
      evidenceEventId: row.evidence_event_id,
      score: row.score ?? null,
      comparison: parseJson(row.comparison_json, {}),
      createdAt: row.created_at,
    };
  }
}
