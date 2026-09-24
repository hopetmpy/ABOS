export const SIMULATION_SCHEMA_REVISION = 1;

/**
 * P-024 canonical Simulation / Experiment sidecar schema.
 *
 * This schema is intentionally idempotent and domain-owned, matching the
 * AdaptiveStore compatibility pattern: callers using a raw SQLite database
 * can opt into the authority without knowing the global createDatabase()
 * migration sequence. The global state layer remains the database owner.
 */
export const SIMULATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS simulation_schema_meta (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  INSERT OR IGNORE INTO simulation_schema_meta(singleton, revision, updated_at)
  VALUES (1, ${SIMULATION_SCHEMA_REVISION}, datetime('now'));

  CREATE TABLE IF NOT EXISTS simulation_experiments (
    id TEXT PRIMARY KEY,
    spec_fingerprint TEXT NOT NULL,
    parent_experiment_id TEXT REFERENCES simulation_experiments(id),
    parent_run_index INTEGER,
    goal_id TEXT,
    path_id TEXT,
    question TEXT NOT NULL,
    hypothesis TEXT NOT NULL,
    variables_json TEXT NOT NULL,
    simulator_id TEXT NOT NULL,
    simulator_version TEXT NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('deterministic','stochastic')),
    base_seed TEXT,
    config_json TEXT NOT NULL DEFAULT '{}',
    max_runs INTEGER NOT NULL CHECK(max_runs > 0),
    cost_budget_cents INTEGER NOT NULL CHECK(cost_budget_cents >= 0),
    expected_information_gain REAL,
    assumptions_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK(status IN ('draft','running','completed','failed','budget_exhausted')),
    run_count INTEGER NOT NULL DEFAULT 0 CHECK(run_count >= 0),
    spent_cents INTEGER NOT NULL DEFAULT 0 CHECK(spent_cents >= 0),
    summary_json TEXT,
    surprises_json TEXT,
    result_json TEXT,
    lesson TEXT,
    decision_impact TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    CHECK(mode != 'stochastic' OR base_seed IS NOT NULL),
    CHECK(parent_experiment_id IS NOT NULL OR parent_run_index IS NULL)
  );

  CREATE INDEX IF NOT EXISTS idx_simulation_experiments_goal
    ON simulation_experiments(goal_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_simulation_experiments_path
    ON simulation_experiments(path_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_simulation_experiments_status
    ON simulation_experiments(status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_simulation_experiments_parent
    ON simulation_experiments(parent_experiment_id, created_at);

  CREATE TABLE IF NOT EXISTS simulation_runs (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL REFERENCES simulation_experiments(id) ON DELETE CASCADE,
    run_index INTEGER NOT NULL CHECK(run_index >= 0),
    derived_seed TEXT,
    variables_json TEXT NOT NULL,
    output_json TEXT NOT NULL,
    cost_cents INTEGER NOT NULL CHECK(cost_cents >= 0),
    created_at TEXT NOT NULL,
    UNIQUE(experiment_id, run_index)
  );

  CREATE INDEX IF NOT EXISTS idx_simulation_runs_experiment
    ON simulation_runs(experiment_id, run_index);

  CREATE TABLE IF NOT EXISTS simulation_calibrations (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL REFERENCES simulation_experiments(id) ON DELETE CASCADE,
    evidence_event_id TEXT NOT NULL REFERENCES evidence_events(id),
    score REAL,
    comparison_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE(experiment_id, evidence_event_id)
  );

  CREATE INDEX IF NOT EXISTS idx_simulation_calibrations_experiment
    ON simulation_calibrations(experiment_id, created_at);
`;
