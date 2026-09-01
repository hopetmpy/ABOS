import type { Database } from "better-sqlite3";
import { ulid } from "ulid";
import { pathSignature } from "./path-signature.js";
import type {
  Opportunity,
  PathAttempt,
  PathCandidate,
  PathOutcome,
  PathStatus,
  PersistedPath,
  FailureClass,
  WorldFact,
  TrackedAssumption,
  AssumptionStatus,
} from "./types.js";

const stringify = (value: unknown): string => JSON.stringify(value ?? []);
const parseArray = (value: unknown): string[] => {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

export class AdaptiveStore {
  constructor(private readonly db: Database) {}

  getOrCreatePath(candidate: PathCandidate): PersistedPath {
    const signature = pathSignature(candidate);
    const existing = this.db.prepare(
      "SELECT * FROM adaptive_paths WHERE goal_id = ? AND signature = ? ORDER BY created_at DESC LIMIT 1",
    ).get(candidate.goalId, signature) as any | undefined;

    if (existing) {
      this.db.prepare(
        `UPDATE adaptive_paths
         SET task_id = COALESCE(?, task_id),
             hypothesis = ?,
             strategy = ?,
             assumptions = ?,
             required_capabilities = ?,
             environment = ?,
             executor = ?,
             sequence = ?,
             expected_outcome = ?,
             expected_cost_cents = ?,
             evidence = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        candidate.taskId ?? null,
        candidate.hypothesis,
        candidate.strategy,
        stringify(candidate.assumptions),
        stringify(candidate.requiredCapabilities),
        candidate.environment ?? null,
        candidate.executor ?? null,
        stringify(candidate.sequence),
        candidate.expectedOutcome,
        candidate.expectedCostCents ?? 0,
        stringify(candidate.evidence ?? []),
        existing.id,
      );
      return this.getPath(existing.id)!;
    }

    const id = ulid();
    this.db.prepare(
      `INSERT INTO adaptive_paths
       (id, goal_id, task_id, signature, hypothesis, strategy, assumptions,
        required_capabilities, environment, executor, sequence, expected_outcome,
        expected_cost_cents, evidence, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`,
    ).run(
      id,
      candidate.goalId,
      candidate.taskId ?? null,
      signature,
      candidate.hypothesis,
      candidate.strategy,
      stringify(candidate.assumptions),
      stringify(candidate.requiredCapabilities),
      candidate.environment ?? null,
      candidate.executor ?? null,
      stringify(candidate.sequence),
      candidate.expectedOutcome,
      candidate.expectedCostCents ?? 0,
      stringify(candidate.evidence ?? []),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    return this.getPath(id)!;
  }

  getPath(id: string): PersistedPath | undefined {
    const row = this.db.prepare("SELECT * FROM adaptive_paths WHERE id = ?").get(id) as any | undefined;
    return row ? deserializePath(row) : undefined;
  }

  listPaths(goalId: string): PersistedPath[] {
    const rows = this.db.prepare(
      "SELECT * FROM adaptive_paths WHERE goal_id = ? ORDER BY created_at ASC",
    ).all(goalId) as any[];
    return rows.map(deserializePath);
  }

  setPathStatus(pathId: string, status: PathStatus): void {
    this.db.prepare(
      "UPDATE adaptive_paths SET status = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(status, pathId);
  }

  recordAttempt(input: {
    pathId: string;
    goalId: string;
    taskId?: string | null;
    outcome: PathOutcome;
    failureClass?: FailureClass | null;
    failureReason?: string | null;
    observations?: string[];
    evidence?: string[];
    conditionFingerprint: string;
    noveltyScore: number;
    learnedFacts?: string[];
    retryEligible: boolean;
  }): PathAttempt {
    const id = ulid();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO adaptive_attempts
       (id, path_id, goal_id, task_id, outcome, failure_class, failure_reason,
        observations, evidence, condition_fingerprint, novelty_score,
        learned_facts, retry_eligible, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.pathId,
      input.goalId,
      input.taskId ?? null,
      input.outcome,
      input.failureClass ?? null,
      input.failureReason ?? null,
      stringify(input.observations ?? []),
      stringify(input.evidence ?? []),
      input.conditionFingerprint,
      input.noveltyScore,
      stringify(input.learnedFacts ?? []),
      input.retryEligible ? 1 : 0,
      createdAt,
    );

    return {
      id,
      pathId: input.pathId,
      goalId: input.goalId,
      taskId: input.taskId ?? null,
      outcome: input.outcome,
      failureClass: input.failureClass ?? null,
      failureReason: input.failureReason ?? null,
      observations: input.observations ?? [],
      evidence: input.evidence ?? [],
      conditionFingerprint: input.conditionFingerprint,
      noveltyScore: input.noveltyScore,
      learnedFacts: input.learnedFacts ?? [],
      retryEligible: input.retryEligible,
      createdAt,
    };
  }

  listAttempts(goalId: string, limit = 100): PathAttempt[] {
    const rows = this.db.prepare(
      "SELECT * FROM adaptive_attempts WHERE goal_id = ? ORDER BY created_at DESC LIMIT ?",
    ).all(goalId, limit) as any[];
    return rows.map(deserializeAttempt);
  }

  latestConditionFingerprint(pathId: string): string | undefined {
    const row = this.db.prepare(
      "SELECT condition_fingerprint FROM adaptive_attempts WHERE path_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(pathId) as { condition_fingerprint: string } | undefined;
    return row?.condition_fingerprint;
  }

  conditionFingerprints(goalId: string): Map<string, string> {
    const rows = this.db.prepare(
      `SELECT a.path_id, a.condition_fingerprint
       FROM adaptive_attempts a
       JOIN (
         SELECT path_id, MAX(created_at) AS max_created
         FROM adaptive_attempts
         WHERE goal_id = ?
         GROUP BY path_id
       ) latest
       ON latest.path_id = a.path_id AND latest.max_created = a.created_at`,
    ).all(goalId) as Array<{ path_id: string; condition_fingerprint: string }>;
    return new Map(rows.map((row) => [row.path_id, row.condition_fingerprint]));
  }

  syncAssumptions(
    goalId: string,
    pathId: string,
    assumptions: string[],
  ): TrackedAssumption[] {
    const now = new Date().toISOString();
    const unique = [...new Set(assumptions.map((statement) => statement.trim()).filter(Boolean))];

    for (const statement of unique) {
      const normalized = normalizeAssumption(statement);
      const existing = this.db.prepare(
        "SELECT id FROM adaptive_assumptions WHERE path_id = ? AND normalized_statement = ?",
      ).get(pathId, normalized) as { id: string } | undefined;

      if (existing) continue;

      this.db.prepare(
        `INSERT INTO adaptive_assumptions
         (id, goal_id, path_id, statement, normalized_statement, status,
          confidence, evidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', 0.5, '[]', ?, ?)`,
      ).run(ulid(), goalId, pathId, statement, normalized, now, now);
    }

    return this.listAssumptions(goalId, pathId);
  }

  updateAssumptionStatus(
    id: string,
    status: AssumptionStatus,
    evidence: string[] = [],
    confidence?: number,
  ): void {
    const existing = this.db.prepare(
      "SELECT evidence, confidence FROM adaptive_assumptions WHERE id = ?",
    ).get(id) as { evidence: string; confidence: number } | undefined;
    if (!existing) return;

    const mergedEvidence = [...new Set([
      ...parseArray(existing.evidence),
      ...evidence.filter(Boolean),
    ])];

    this.db.prepare(
      `UPDATE adaptive_assumptions
       SET status = ?, confidence = ?, evidence = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      status,
      confidence ?? existing.confidence,
      stringify(mergedEvidence),
      new Date().toISOString(),
      id,
    );
  }

  listAssumptions(goalId: string, pathId?: string): TrackedAssumption[] {
    const rows = pathId
      ? this.db.prepare(
          "SELECT * FROM adaptive_assumptions WHERE goal_id = ? AND path_id = ? ORDER BY created_at ASC",
        ).all(goalId, pathId) as any[]
      : this.db.prepare(
          "SELECT * FROM adaptive_assumptions WHERE goal_id = ? ORDER BY created_at ASC",
        ).all(goalId) as any[];

    return rows.map((row) => ({
      id: row.id,
      goalId: row.goal_id,
      pathId: row.path_id,
      statement: row.statement,
      normalizedStatement: row.normalized_statement,
      status: row.status,
      confidence: row.confidence,
      evidence: parseArray(row.evidence),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  upsertFact(input: {
    goalId: string;
    key: string;
    value: string;
    confidence?: number;
    epistemicStatus?: "fact" | "hypothesis";
    source: string;
    lastVerifiedAt?: string | null;
  }): WorldFact {
    const existing = this.db.prepare(
      "SELECT id FROM adaptive_world_facts WHERE goal_id = ? AND key = ?",
    ).get(input.goalId, input.key) as { id: string } | undefined;
    const id = existing?.id ?? ulid();

    this.db.prepare(
      `INSERT INTO adaptive_world_facts
       (id, goal_id, key, value, confidence, epistemic_status, source,
        last_verified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(goal_id, key) DO UPDATE SET
         value = excluded.value,
         confidence = excluded.confidence,
         epistemic_status = excluded.epistemic_status,
         source = excluded.source,
         last_verified_at = excluded.last_verified_at,
         updated_at = excluded.updated_at`,
    ).run(
      id,
      input.goalId,
      input.key,
      input.value,
      input.confidence ?? 1,
      input.epistemicStatus ?? "fact",
      input.source,
      input.lastVerifiedAt ?? null,
      new Date().toISOString(),
      new Date().toISOString(),
    );

    return this.getFact(input.goalId, input.key)!;
  }

  getFact(goalId: string, key: string): WorldFact | undefined {
    const row = this.db.prepare(
      "SELECT * FROM adaptive_world_facts WHERE goal_id = ? AND key = ?",
    ).get(goalId, key) as any | undefined;
    return row ? deserializeFact(row) : undefined;
  }

  listFacts(goalId: string): WorldFact[] {
    const rows = this.db.prepare(
      "SELECT * FROM adaptive_world_facts WHERE goal_id = ? ORDER BY confidence DESC, updated_at DESC",
    ).all(goalId) as any[];
    return rows.map(deserializeFact);
  }

  addOpportunity(input: {
    goalId: string;
    sourcePathId?: string | null;
    description: string;
    evidence?: string[];
  }): Opportunity {
    const id = ulid();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO adaptive_opportunities
       (id, goal_id, source_path_id, description, status, evidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).run(
      id,
      input.goalId,
      input.sourcePathId ?? null,
      input.description,
      stringify(input.evidence ?? []),
      now,
      now,
    );
    return {
      id,
      goalId: input.goalId,
      sourcePathId: input.sourcePathId ?? null,
      description: input.description,
      status: "open",
      evidence: input.evidence ?? [],
      createdAt: now,
      updatedAt: now,
    };
  }

  listOpenOpportunities(goalId: string): Opportunity[] {
    const rows = this.db.prepare(
      "SELECT * FROM adaptive_opportunities WHERE goal_id = ? AND status = 'open' ORDER BY created_at ASC",
    ).all(goalId) as any[];
    return rows.map((row) => ({
      id: row.id,
      goalId: row.goal_id,
      sourcePathId: row.source_path_id ?? null,
      description: row.description,
      status: row.status,
      evidence: parseArray(row.evidence),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}

function deserializePath(row: any): PersistedPath {
  return {
    id: row.id,
    goalId: row.goal_id,
    taskId: row.task_id ?? null,
    signature: row.signature,
    hypothesis: row.hypothesis,
    strategy: row.strategy,
    assumptions: parseArray(row.assumptions),
    requiredCapabilities: parseArray(row.required_capabilities),
    environment: row.environment ?? null,
    executor: row.executor ?? null,
    sequence: parseArray(row.sequence),
    expectedOutcome: row.expected_outcome,
    expectedCostCents: row.expected_cost_cents,
    evidence: parseArray(row.evidence),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deserializeAttempt(row: any): PathAttempt {
  return {
    id: row.id,
    pathId: row.path_id,
    goalId: row.goal_id,
    taskId: row.task_id ?? null,
    outcome: row.outcome,
    failureClass: row.failure_class ?? null,
    failureReason: row.failure_reason ?? null,
    observations: parseArray(row.observations),
    evidence: parseArray(row.evidence),
    conditionFingerprint: row.condition_fingerprint,
    noveltyScore: row.novelty_score,
    learnedFacts: parseArray(row.learned_facts),
    retryEligible: !!row.retry_eligible,
    createdAt: row.created_at,
  };
}

function deserializeFact(row: any): WorldFact {
  return {
    id: row.id,
    goalId: row.goal_id,
    key: row.key,
    value: row.value,
    confidence: row.confidence,
    epistemicStatus: row.epistemic_status,
    source: row.source,
    lastVerifiedAt: row.last_verified_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}


function normalizeAssumption(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
