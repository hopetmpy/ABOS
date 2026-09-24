/**
 * P-022 world-model persistence owned by the canonical state layer.
 *
 * Adaptive Intelligence owns the domain semantics. src/state owns durable SQL
 * schema/migration authority. The SQL is idempotent because AdaptiveStore is
 * also constructed by raw-DB tests/embeddings that bypass createDatabase().
 */
export const WORLD_MODEL_SCHEMA_VERSION = 1;

export const WORLD_MODEL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS adaptive_world_beliefs (
    id TEXT PRIMARY KEY,
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    epistemic_status TEXT NOT NULL
      CHECK(epistemic_status IN ('observation','inference','estimate','assumption','unknown')),
    lifecycle_status TEXT NOT NULL DEFAULT 'active'
      CHECK(lifecycle_status IN ('active','invalidated','superseded')),
    confidence REAL
      CHECK(confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
    source TEXT NOT NULL,
    evidence_refs TEXT NOT NULL DEFAULT '[]',
    falsification_conditions TEXT NOT NULL DEFAULT '[]',
    last_verified_at TEXT,
    expires_at TEXT,
    invalidated_at TEXT,
    invalidation_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_adaptive_world_beliefs_goal_key
    ON adaptive_world_beliefs(goal_id, key, created_at);
  CREATE INDEX IF NOT EXISTS idx_adaptive_world_beliefs_goal_status
    ON adaptive_world_beliefs(goal_id, lifecycle_status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_adaptive_world_beliefs_expiry
    ON adaptive_world_beliefs(goal_id, expires_at)
    WHERE lifecycle_status = 'active' AND expires_at IS NOT NULL;
`;
