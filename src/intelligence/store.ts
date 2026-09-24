import type { Database } from "better-sqlite3";
import { ulid } from "ulid";
import { MIGRATION_V12, MIGRATION_V18_EVIDENCE_FABRIC } from "../state/schema.js";
import {
  appendEvidenceEvent,
  correlationIdFor,
  latestEvidenceByAuthority,
} from "../observability/evidence.js";
import { pathSignature } from "./path-signature.js";
import { WORLD_BELIEF_SCHEMA } from "./world-belief-schema.js";
import type {
  Opportunity,
  PathAttempt,
  PathCandidate,
  PathOutcome,
  PathStatus,
  PersistedPath,
  FailureClass,
  WorldFact,
  WorldBelief,
  BeliefEpistemicStatus,
  BeliefLifecycleStatus,
  TrackedAssumption,
  AssumptionStatus,
  AdaptiveTaskBinding,
  AdaptiveEvidence,
  EvidenceKind,
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

function appendAdaptiveAuthorityEvent(
  db: Database,
  input: {
    eventType: string;
    authorityType: string;
    authorityId: string;
    goalId: string;
    taskId?: string | null;
    causationId?: string | null;
    epistemicStatus?: BeliefEpistemicStatus | string;
    payload?: Record<string, unknown>;
  },
): void {
  appendEvidenceEvent(db, {
    correlationId: correlationIdFor("goal", input.goalId),
    causationId: input.causationId ?? null,
    eventType: input.eventType,
    domain: "adaptive",
    authorityType: input.authorityType,
    authorityId: input.authorityId,
    goalId: input.goalId,
    taskId: input.taskId ?? null,
    epistemicStatus: input.epistemicStatus ?? "observation",
    payload: input.payload ?? {},
    provenance: { source: input.authorityType },
  });
}

export class AdaptiveStore {
  constructor(private readonly db: Database) {
    // Orchestrator is also used in tests/embeddings that provide a raw DB
    // rather than createDatabase(). Keep the adaptive sidecar schema
    // idempotently available without requiring callers to know migration v12.
    // Production still records migration version through createDatabase().
    db.exec(MIGRATION_V12);
    // Raw DB embeddings that opt into AdaptiveStore also need the causal fabric
    // required by P-013. Production createDatabase() still owns schema_version.
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    // P-022 follows the same sidecar compatibility rule. This remains owned by
    // AdaptiveStore and never creates a second memory/evidence authority.
    db.exec(WORLD_BELIEF_SCHEMA);
  }

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
    this.db.transaction(() => {
      const now = new Date().toISOString();
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
        now,
        now,
      );
      appendAdaptiveAuthorityEvent(this.db, {
        eventType: "adaptive.path_created",
        authorityType: "adaptive_path",
        authorityId: id,
        goalId: candidate.goalId,
        taskId: candidate.taskId ?? null,
        payload: { status: "candidate" },
      });
    })();
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
    const current = this.getPath(pathId);
    if (!current || current.status === status) return;
    this.db.transaction(() => {
      this.db.prepare(
        "UPDATE adaptive_paths SET status = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(status, pathId);
      appendAdaptiveAuthorityEvent(this.db, {
        eventType: "adaptive.path_status_changed",
        authorityType: "adaptive_path",
        authorityId: pathId,
        goalId: current.goalId,
        taskId: current.taskId,
        payload: { fromStatus: current.status, toStatus: status },
      });
    })();
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
    this.db.transaction(() => {
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
      appendAdaptiveAuthorityEvent(this.db, {
        eventType: "adaptive.attempt_recorded",
        authorityType: "adaptive_attempt",
        authorityId: id,
        goalId: input.goalId,
        taskId: input.taskId ?? null,
        causationId:
          latestEvidenceByAuthority(this.db, "adaptive_path", input.pathId)?.id ?? null,
        payload: {
          outcome: input.outcome,
          failureClass: input.failureClass ?? null,
          retryEligible: input.retryEligible,
          noveltyScore: input.noveltyScore,
          learnedFactCount: input.learnedFacts?.length ?? 0,
        },
      });
    })();

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

  latestAttempt(
    pathId: string,
    taskId?: string | null,
  ): PathAttempt | undefined {
    const row = taskId
      ? this.db.prepare(
          `SELECT * FROM adaptive_attempts
           WHERE path_id = ? AND task_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        ).get(pathId, taskId) as any | undefined
      : this.db.prepare(
          `SELECT * FROM adaptive_attempts
           WHERE path_id = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        ).get(pathId) as any | undefined;

    return row ? deserializeAttempt(row) : undefined;
  }

  currentBoundPathId(goalId: string): string | undefined {
    const row = this.db.prepare(
      `SELECT b.path_id
       FROM adaptive_task_bindings b
       JOIN task_graph t ON t.id = b.task_id
       WHERE b.goal_id = ?
         AND b.path_id IS NOT NULL
         AND t.status != 'cancelled'
       ORDER BY b.updated_at DESC
       LIMIT 1`,
    ).get(goalId) as { path_id: string | null } | undefined;

    return row?.path_id ?? undefined;
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

  recordEvidence(input: {
    goalId: string;
    pathId?: string | null;
    attemptId?: string | null;
    kind: EvidenceKind;
    content: string;
    source: string;
    confidence?: number;
  }): AdaptiveEvidence {
    const content = input.content.trim();
    if (!content) {
      throw new Error("Adaptive evidence content cannot be empty");
    }

    const id = ulid();
    const createdAt = new Date().toISOString();
    const confidence = Math.max(0, Math.min(1, input.confidence ?? 1));

    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO adaptive_evidence
         (id, goal_id, path_id, attempt_id, kind, content, source, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.goalId,
        input.pathId ?? null,
        input.attemptId ?? null,
        input.kind,
        content,
        input.source,
        confidence,
        createdAt,
      );
      appendAdaptiveAuthorityEvent(this.db, {
        eventType: "adaptive.evidence_recorded",
        authorityType: "adaptive_evidence",
        authorityId: id,
        goalId: input.goalId,
        causationId: input.attemptId
          ? latestEvidenceByAuthority(this.db, "adaptive_attempt", input.attemptId)?.id ?? null
          : input.pathId
            ? latestEvidenceByAuthority(this.db, "adaptive_path", input.pathId)?.id ?? null
            : null,
        payload: { kind: input.kind, source: input.source, confidence },
      });
    })();

    return {
      id,
      goalId: input.goalId,
      pathId: input.pathId ?? null,
      attemptId: input.attemptId ?? null,
      kind: input.kind,
      content,
      source: input.source,
      confidence,
      createdAt,
    };
  }

  listEvidence(
    goalId: string,
    options: { pathId?: string; attemptId?: string; limit?: number } = {},
  ): AdaptiveEvidence[] {
    const conditions = ["goal_id = ?"];
    const params: unknown[] = [goalId];

    if (options.pathId) {
      conditions.push("path_id = ?");
      params.push(options.pathId);
    }
    if (options.attemptId) {
      conditions.push("attempt_id = ?");
      params.push(options.attemptId);
    }

    const limit = Math.max(1, Math.min(500, options.limit ?? 100));
    params.push(limit);

    const rows = this.db.prepare(
      `SELECT * FROM adaptive_evidence
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(...params) as any[];

    return rows.map((row) => ({
      id: row.id,
      goalId: row.goal_id,
      pathId: row.path_id ?? null,
      attemptId: row.attempt_id ?? null,
      kind: row.kind,
      content: row.content,
      source: row.source,
      confidence: row.confidence,
      createdAt: row.created_at,
    }));
  }

  bindTask(input: {
    taskId: string;
    goalId: string;
    pathId?: string | null;
    requiredCapabilities?: string[];
    preferredEnvironment?: string | null;
  }): AdaptiveTaskBinding {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO adaptive_task_bindings
         (task_id, goal_id, path_id, required_capabilities, preferred_environment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           goal_id = excluded.goal_id,
           path_id = excluded.path_id,
           required_capabilities = excluded.required_capabilities,
           preferred_environment = excluded.preferred_environment,
           updated_at = excluded.updated_at`,
      ).run(
        input.taskId,
        input.goalId,
        input.pathId ?? null,
        stringify(input.requiredCapabilities ?? []),
        input.preferredEnvironment ?? null,
        now,
        now,
      );
      appendAdaptiveAuthorityEvent(this.db, {
        eventType: "adaptive.task_bound",
        authorityType: "adaptive_task_binding",
        authorityId: input.taskId,
        goalId: input.goalId,
        taskId: input.taskId,
        causationId: input.pathId
          ? latestEvidenceByAuthority(this.db, "adaptive_path", input.pathId)?.id ?? null
          : null,
        payload: { pathId: input.pathId ?? null },
      });
    })();
    return this.getTaskBinding(input.taskId)!;
  }

  getTaskBinding(taskId: string): AdaptiveTaskBinding | undefined {
    const row = this.db.prepare(
      "SELECT * FROM adaptive_task_bindings WHERE task_id = ?",
    ).get(taskId) as any | undefined;
    if (!row) return undefined;
    return {
      taskId: row.task_id,
      goalId: row.goal_id,
      pathId: row.path_id ?? null,
      requiredCapabilities: parseArray(row.required_capabilities),
      preferredEnvironment: row.preferred_environment ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
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
      "SELECT goal_id, path_id, status, evidence, confidence FROM adaptive_assumptions WHERE id = ?",
    ).get(id) as {
      goal_id: string;
      path_id: string;
      status: AssumptionStatus;
      evidence: string;
      confidence: number;
    } | undefined;
    if (!existing) return;

    const mergedEvidence = [...new Set([
      ...parseArray(existing.evidence),
      ...evidence.filter(Boolean),
    ])];

    this.db.transaction(() => {
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
      appendAdaptiveAuthorityEvent(this.db, {
        eventType: "adaptive.assumption_status_changed",
        authorityType: "adaptive_assumption",
        authorityId: id,
        goalId: existing.goal_id,
        causationId:
          latestEvidenceByAuthority(this.db, "adaptive_path", existing.path_id)?.id ?? null,
        payload: {
          fromStatus: existing.status,
          toStatus: status,
          confidence: confidence ?? existing.confidence,
          evidenceCount: mergedEvidence.length,
        },
      });
    })();
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

    this.db.transaction(() => {
      const now = new Date().toISOString();
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
        now,
        now,
      );
      appendAdaptiveAuthorityEvent(this.db, {
        eventType: "adaptive.fact_upserted",
        authorityType: "adaptive_world_fact",
        authorityId: id,
        goalId: input.goalId,
        payload: {
          domainEpistemicStatus: input.epistemicStatus ?? "fact",
          confidence: input.confidence ?? 1,
        },
      });
    })();

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

  recordBelief(input: {
    goalId: string;
    key: string;
    value: string;
    epistemicStatus: BeliefEpistemicStatus;
    confidence?: number | null;
    source: string;
    evidenceRefs?: string[];
    falsificationConditions?: string[];
    lastVerifiedAt?: string | null;
    expiresAt?: string | null;
    invalidateBeliefIds?: string[];
    supersedeBeliefIds?: string[];
  }): WorldBelief {
    const key = requireNonEmpty(input.key, "belief key");
    const value = requireNonEmpty(input.value, "belief value");
    const source = requireNonEmpty(input.source, "belief source");
    const confidence = normalizeOptionalConfidence(input.confidence);
    const lastVerifiedAt = normalizeOptionalTimestamp(input.lastVerifiedAt, "lastVerifiedAt");
    const expiresAt = normalizeOptionalTimestamp(input.expiresAt, "expiresAt");
    const evidenceRefs = uniqueStrings(input.evidenceRefs ?? []);
    const falsificationConditions = uniqueStrings(input.falsificationConditions ?? []);
    const invalidateIds = [...new Set(input.invalidateBeliefIds ?? [])];
    const supersedeIds = [...new Set(input.supersedeBeliefIds ?? [])];
    const overlap = invalidateIds.find((id) => supersedeIds.includes(id));
    if (overlap) {
      throw new Error(`Belief ${overlap} cannot be invalidated and superseded by the same update`);
    }

    const id = ulid();
    const now = new Date().toISOString();

    this.db.transaction(() => {
      for (const targetId of invalidateIds) {
        this.transitionBeliefInTransaction(
          targetId,
          input.goalId,
          "invalidated",
          "Contradicted by a newer world-model update.",
          evidenceRefs,
          now,
        );
      }
      for (const targetId of supersedeIds) {
        this.transitionBeliefInTransaction(
          targetId,
          input.goalId,
          "superseded",
          "Superseded by a newer world-model update.",
          evidenceRefs,
          now,
        );
      }

      this.db.prepare(
        `INSERT INTO adaptive_world_beliefs
         (id, goal_id, key, value, epistemic_status, lifecycle_status,
          confidence, source, evidence_refs, falsification_conditions,
          last_verified_at, expires_at, invalidated_at, invalidation_reason,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      ).run(
        id,
        input.goalId,
        key,
        value,
        input.epistemicStatus,
        confidence,
        source,
        stringify(evidenceRefs),
        stringify(falsificationConditions),
        lastVerifiedAt,
        expiresAt,
        now,
        now,
      );

      appendAdaptiveAuthorityEvent(this.db, {
        eventType: "adaptive.world_belief_recorded",
        authorityType: "adaptive_world_belief",
        authorityId: id,
        goalId: input.goalId,
        epistemicStatus: input.epistemicStatus,
        payload: {
          lifecycleStatus: "active",
          confidenceAvailable: confidence !== null,
          evidenceRefCount: evidenceRefs.length,
          falsificationConditionCount: falsificationConditions.length,
          hasExpiry: expiresAt !== null,
          invalidatedBeliefCount: invalidateIds.length,
          supersededBeliefCount: supersedeIds.length,
        },
      });
    })();

    return this.getBelief(id)!;
  }

  getBelief(id: string): WorldBelief | undefined {
    const row = this.db.prepare(
      "SELECT * FROM adaptive_world_beliefs WHERE id = ?",
    ).get(id) as any | undefined;
    return row ? deserializeBelief(row) : undefined;
  }

  listBeliefs(goalId: string, key?: string): WorldBelief[] {
    const rows = key
      ? this.db.prepare(
          `SELECT * FROM adaptive_world_beliefs
           WHERE goal_id = ? AND key = ?
           ORDER BY created_at ASC`,
        ).all(goalId, key) as any[]
      : this.db.prepare(
          `SELECT * FROM adaptive_world_beliefs
           WHERE goal_id = ?
           ORDER BY key ASC, created_at ASC`,
        ).all(goalId) as any[];
    return rows.map(deserializeBelief);
  }

  listActiveBeliefs(
    goalId: string,
    options: { key?: string; at?: string } = {},
  ): WorldBelief[] {
    const at = normalizeRequiredTimestamp(options.at ?? new Date().toISOString(), "at");
    const conditions = [
      "goal_id = ?",
      "lifecycle_status = 'active'",
      "(expires_at IS NULL OR expires_at > ?)",
    ];
    const params: unknown[] = [goalId, at];
    if (options.key) {
      conditions.push("key = ?");
      params.push(options.key);
    }
    const rows = this.db.prepare(
      `SELECT * FROM adaptive_world_beliefs
       WHERE ${conditions.join(" AND ")}
       ORDER BY key ASC, created_at ASC`,
    ).all(...params) as any[];
    return rows.map(deserializeBelief);
  }

  invalidateBelief(id: string, reason: string, evidenceRefs: string[] = []): WorldBelief | undefined {
    const existing = this.getBelief(id);
    if (!existing) return undefined;
    if (existing.lifecycleStatus === "invalidated") return existing;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.transitionBeliefInTransaction(
        id,
        existing.goalId,
        "invalidated",
        requireNonEmpty(reason, "invalidation reason"),
        uniqueStrings(evidenceRefs),
        now,
      );
    })();
    return this.getBelief(id);
  }

  supersedeBelief(id: string, reason: string, evidenceRefs: string[] = []): WorldBelief | undefined {
    const existing = this.getBelief(id);
    if (!existing) return undefined;
    if (existing.lifecycleStatus === "superseded") return existing;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.transitionBeliefInTransaction(
        id,
        existing.goalId,
        "superseded",
        requireNonEmpty(reason, "supersession reason"),
        uniqueStrings(evidenceRefs),
        now,
      );
    })();
    return this.getBelief(id);
  }

  private transitionBeliefInTransaction(
    id: string,
    expectedGoalId: string,
    toStatus: Exclude<BeliefLifecycleStatus, "active">,
    reason: string,
    evidenceRefs: string[],
    now: string,
  ): void {
    const existing = this.getBelief(id);
    if (!existing) {
      throw new Error(`Cannot transition unknown belief: ${id}`);
    }
    if (existing.goalId !== expectedGoalId) {
      throw new Error(`Cannot transition belief across goals: ${id}`);
    }
    if (existing.lifecycleStatus !== "active") {
      if (existing.lifecycleStatus === toStatus) return;
      throw new Error(
        `Cannot transition belief ${id} from ${existing.lifecycleStatus} to ${toStatus}`,
      );
    }

    const mergedEvidence = uniqueStrings([...existing.evidenceRefs, ...evidenceRefs]);
    this.db.prepare(
      `UPDATE adaptive_world_beliefs
       SET lifecycle_status = ?, evidence_refs = ?,
           invalidated_at = CASE WHEN ? = 'invalidated' THEN ? ELSE invalidated_at END,
           invalidation_reason = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      toStatus,
      stringify(mergedEvidence),
      toStatus,
      now,
      reason,
      now,
      id,
    );

    appendAdaptiveAuthorityEvent(this.db, {
      eventType: "adaptive.world_belief_status_changed",
      authorityType: "adaptive_world_belief",
      authorityId: id,
      goalId: expectedGoalId,
      epistemicStatus: existing.epistemicStatus,
      payload: {
        fromStatus: existing.lifecycleStatus,
        toStatus,
        evidenceRefCount: mergedEvidence.length,
      },
    });
  }

  addOpportunity(input: {
    goalId: string;
    sourcePathId?: string | null;
    description: string;
    evidence?: string[];
  }): Opportunity {
    const id = ulid();
    const now = new Date().toISOString();
    this.db.transaction(() => {
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
      appendAdaptiveAuthorityEvent(this.db, {
        eventType: "adaptive.opportunity_opened",
        authorityType: "adaptive_opportunity",
        authorityId: id,
        goalId: input.goalId,
        causationId: input.sourcePathId
          ? latestEvidenceByAuthority(this.db, "adaptive_path", input.sourcePathId)?.id ?? null
          : null,
        payload: { status: "open" },
      });
    })();
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

function deserializeBelief(row: any): WorldBelief {
  return {
    id: row.id,
    goalId: row.goal_id,
    key: row.key,
    value: row.value,
    epistemicStatus: row.epistemic_status,
    lifecycleStatus: row.lifecycle_status,
    confidence: row.confidence ?? null,
    source: row.source,
    evidenceRefs: parseArray(row.evidence_refs),
    falsificationConditions: parseArray(row.falsification_conditions),
    lastVerifiedAt: row.last_verified_at ?? null,
    expiresAt: row.expires_at ?? null,
    invalidatedAt: row.invalidated_at ?? null,
    invalidationReason: row.invalidation_reason ?? null,
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

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty`);
  return normalized;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeOptionalConfidence(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`belief confidence must be between 0 and 1 when provided: ${value}`);
  }
  return value;
}

function normalizeOptionalTimestamp(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value == null) return null;
  return normalizeRequiredTimestamp(value, label);
}

function normalizeRequiredTimestamp(value: string, label: string): string {
  const timestamp = value.trim();
  const parsed = Date.parse(timestamp);
  if (!timestamp || !Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return new Date(parsed).toISOString();
}
