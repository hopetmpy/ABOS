from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected block once, got {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")

# AdaptiveStore remains the domain authority. P-013 adds only causal references.
replace_once(
    "src/intelligence/store.ts",
    'import { MIGRATION_V12 } from "../state/schema.js";',
    'import { MIGRATION_V12, MIGRATION_V18_EVIDENCE_FABRIC } from "../state/schema.js";\nimport { appendEvidenceEvent, correlationIdFor } from "../observability/evidence.js";',
)

anchor = '''const parseArray = (value: unknown): string[] => {\n  if (typeof value !== "string") return [];\n  try {\n    const parsed = JSON.parse(value);\n    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];\n  } catch {\n    return [];\n  }\n};\n'''
helper = anchor + '''\nfunction appendAdaptiveAuthorityEvent(\n  db: Database,\n  input: {\n    eventType: string;\n    authorityType: string;\n    authorityId: string;\n    goalId: string;\n    taskId?: string | null;\n    causationId?: string | null;\n    payload?: Record<string, unknown>;\n  },\n): void {\n  appendEvidenceEvent(db, {\n    correlationId: correlationIdFor("goal", input.goalId),\n    causationId: input.causationId ?? null,\n    eventType: input.eventType,\n    domain: "adaptive",\n    authorityType: input.authorityType,\n    authorityId: input.authorityId,\n    goalId: input.goalId,\n    taskId: input.taskId ?? null,\n    epistemicStatus: "observation",\n    payload: input.payload ?? {},\n    provenance: { source: input.authorityType },\n  });\n}\n'''
replace_once("src/intelligence/store.ts", anchor, helper)

replace_once(
    "src/intelligence/store.ts",
    '''    db.exec(MIGRATION_V12);\n  }''',
    '''    db.exec(MIGRATION_V12);\n    // Raw DB embeddings that opt into AdaptiveStore also need the causal fabric\n    // required by P-013. Production createDatabase() still owns schema_version.\n    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);\n  }''',
)

old_new_path = '''    const id = ulid();\n    this.db.prepare(\n      `INSERT INTO adaptive_paths\n       (id, goal_id, task_id, signature, hypothesis, strategy, assumptions,\n        required_capabilities, environment, executor, sequence, expected_outcome,\n        expected_cost_cents, evidence, status, created_at, updated_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`,\n    ).run(\n      id,\n      candidate.goalId,\n      candidate.taskId ?? null,\n      signature,\n      candidate.hypothesis,\n      candidate.strategy,\n      stringify(candidate.assumptions),\n      stringify(candidate.requiredCapabilities),\n      candidate.environment ?? null,\n      candidate.executor ?? null,\n      stringify(candidate.sequence),\n      candidate.expectedOutcome,\n      candidate.expectedCostCents ?? 0,\n      stringify(candidate.evidence ?? []),\n      new Date().toISOString(),\n      new Date().toISOString(),\n    );\n    return this.getPath(id)!;'''
new_new_path = '''    const id = ulid();\n    this.db.transaction(() => {\n      const now = new Date().toISOString();\n      this.db.prepare(\n        `INSERT INTO adaptive_paths\n         (id, goal_id, task_id, signature, hypothesis, strategy, assumptions,\n          required_capabilities, environment, executor, sequence, expected_outcome,\n          expected_cost_cents, evidence, status, created_at, updated_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`,\n      ).run(\n        id,\n        candidate.goalId,\n        candidate.taskId ?? null,\n        signature,\n        candidate.hypothesis,\n        candidate.strategy,\n        stringify(candidate.assumptions),\n        stringify(candidate.requiredCapabilities),\n        candidate.environment ?? null,\n        candidate.executor ?? null,\n        stringify(candidate.sequence),\n        candidate.expectedOutcome,\n        candidate.expectedCostCents ?? 0,\n        stringify(candidate.evidence ?? []),\n        now,\n        now,\n      );\n      appendAdaptiveAuthorityEvent(this.db, {\n        eventType: "adaptive.path_created",\n        authorityType: "adaptive_path",\n        authorityId: id,\n        goalId: candidate.goalId,\n        taskId: candidate.taskId ?? null,\n        payload: { status: "candidate" },\n      });\n    })();\n    return this.getPath(id)!;'''
replace_once("src/intelligence/store.ts", old_new_path, new_new_path)

replace_once(
    "src/intelligence/store.ts",
    '''  setPathStatus(pathId: string, status: PathStatus): void {\n    this.db.prepare(\n      "UPDATE adaptive_paths SET status = ?, updated_at = datetime('now') WHERE id = ?",\n    ).run(status, pathId);\n  }''',
    '''  setPathStatus(pathId: string, status: PathStatus): void {\n    const current = this.getPath(pathId);\n    if (!current || current.status === status) return;\n    this.db.transaction(() => {\n      this.db.prepare(\n        "UPDATE adaptive_paths SET status = ?, updated_at = datetime('now') WHERE id = ?",\n      ).run(status, pathId);\n      appendAdaptiveAuthorityEvent(this.db, {\n        eventType: "adaptive.path_status_changed",\n        authorityType: "adaptive_path",\n        authorityId: pathId,\n        goalId: current.goalId,\n        taskId: current.taskId,\n        payload: { fromStatus: current.status, toStatus: status },\n      });\n    })();\n  }''',
)

old_attempt_insert = '''    this.db.prepare(\n      `INSERT INTO adaptive_attempts\n       (id, path_id, goal_id, task_id, outcome, failure_class, failure_reason,\n        observations, evidence, condition_fingerprint, novelty_score,\n        learned_facts, retry_eligible, created_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n    ).run(\n      id,\n      input.pathId,\n      input.goalId,\n      input.taskId ?? null,\n      input.outcome,\n      input.failureClass ?? null,\n      input.failureReason ?? null,\n      stringify(input.observations ?? []),\n      stringify(input.evidence ?? []),\n      input.conditionFingerprint,\n      input.noveltyScore,\n      stringify(input.learnedFacts ?? []),\n      input.retryEligible ? 1 : 0,\n      createdAt,\n    );'''
new_attempt_insert = '''    this.db.transaction(() => {\n      this.db.prepare(\n        `INSERT INTO adaptive_attempts\n         (id, path_id, goal_id, task_id, outcome, failure_class, failure_reason,\n          observations, evidence, condition_fingerprint, novelty_score,\n          learned_facts, retry_eligible, created_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n      ).run(\n        id,\n        input.pathId,\n        input.goalId,\n        input.taskId ?? null,\n        input.outcome,\n        input.failureClass ?? null,\n        input.failureReason ?? null,\n        stringify(input.observations ?? []),\n        stringify(input.evidence ?? []),\n        input.conditionFingerprint,\n        input.noveltyScore,\n        stringify(input.learnedFacts ?? []),\n        input.retryEligible ? 1 : 0,\n        createdAt,\n      );\n      appendAdaptiveAuthorityEvent(this.db, {\n        eventType: "adaptive.attempt_recorded",\n        authorityType: "adaptive_attempt",\n        authorityId: id,\n        goalId: input.goalId,\n        taskId: input.taskId ?? null,\n        causationId: correlationIdFor("adaptive_path", input.pathId),\n        payload: {\n          outcome: input.outcome,\n          failureClass: input.failureClass ?? null,\n          retryEligible: input.retryEligible,\n          noveltyScore: input.noveltyScore,\n          learnedFactCount: input.learnedFacts?.length ?? 0,\n        },\n      });\n    })();'''
replace_once("src/intelligence/store.ts", old_attempt_insert, new_attempt_insert)

old_evidence_insert = '''    this.db.prepare(\n      `INSERT INTO adaptive_evidence\n       (id, goal_id, path_id, attempt_id, kind, content, source, confidence, created_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n    ).run(\n      id,\n      input.goalId,\n      input.pathId ?? null,\n      input.attemptId ?? null,\n      input.kind,\n      content,\n      input.source,\n      confidence,\n      createdAt,\n    );'''
new_evidence_insert = '''    this.db.transaction(() => {\n      this.db.prepare(\n        `INSERT INTO adaptive_evidence\n         (id, goal_id, path_id, attempt_id, kind, content, source, confidence, created_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,\n      ).run(\n        id,\n        input.goalId,\n        input.pathId ?? null,\n        input.attemptId ?? null,\n        input.kind,\n        content,\n        input.source,\n        confidence,\n        createdAt,\n      );\n      appendAdaptiveAuthorityEvent(this.db, {\n        eventType: "adaptive.evidence_recorded",\n        authorityType: "adaptive_evidence",\n        authorityId: id,\n        goalId: input.goalId,\n        causationId: input.attemptId\n          ? correlationIdFor("adaptive_attempt", input.attemptId)\n          : input.pathId\n            ? correlationIdFor("adaptive_path", input.pathId)\n            : null,\n        payload: { kind: input.kind, source: input.source, confidence },\n      });\n    })();'''
replace_once("src/intelligence/store.ts", old_evidence_insert, new_evidence_insert)

old_bind = '''    this.db.prepare(\n      `INSERT INTO adaptive_task_bindings\n       (task_id, goal_id, path_id, required_capabilities, preferred_environment, created_at, updated_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?)\n       ON CONFLICT(task_id) DO UPDATE SET\n         goal_id = excluded.goal_id,\n         path_id = excluded.path_id,\n         required_capabilities = excluded.required_capabilities,\n         preferred_environment = excluded.preferred_environment,\n         updated_at = excluded.updated_at`,\n    ).run(\n      input.taskId,\n      input.goalId,\n      input.pathId ?? null,\n      stringify(input.requiredCapabilities ?? []),\n      input.preferredEnvironment ?? null,\n      now,\n      now,\n    );\n    return this.getTaskBinding(input.taskId)!;'''
new_bind = '''    this.db.transaction(() => {\n      this.db.prepare(\n        `INSERT INTO adaptive_task_bindings\n         (task_id, goal_id, path_id, required_capabilities, preferred_environment, created_at, updated_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?)\n         ON CONFLICT(task_id) DO UPDATE SET\n           goal_id = excluded.goal_id,\n           path_id = excluded.path_id,\n           required_capabilities = excluded.required_capabilities,\n           preferred_environment = excluded.preferred_environment,\n           updated_at = excluded.updated_at`,\n      ).run(\n        input.taskId,\n        input.goalId,\n        input.pathId ?? null,\n        stringify(input.requiredCapabilities ?? []),\n        input.preferredEnvironment ?? null,\n        now,\n        now,\n      );\n      appendAdaptiveAuthorityEvent(this.db, {\n        eventType: "adaptive.task_bound",\n        authorityType: "adaptive_task_binding",\n        authorityId: input.taskId,\n        goalId: input.goalId,\n        taskId: input.taskId,\n        causationId: input.pathId ? correlationIdFor("adaptive_path", input.pathId) : null,\n        payload: { pathId: input.pathId ?? null },\n      });\n    })();\n    return this.getTaskBinding(input.taskId)!;'''
replace_once("src/intelligence/store.ts", old_bind, new_bind)

old_assumption_lookup = '''    const existing = this.db.prepare(\n      "SELECT evidence, confidence FROM adaptive_assumptions WHERE id = ?",\n    ).get(id) as { evidence: string; confidence: number } | undefined;'''
new_assumption_lookup = '''    const existing = this.db.prepare(\n      "SELECT goal_id, path_id, status, evidence, confidence FROM adaptive_assumptions WHERE id = ?",\n    ).get(id) as {\n      goal_id: string;\n      path_id: string;\n      status: AssumptionStatus;\n      evidence: string;\n      confidence: number;\n    } | undefined;'''
replace_once("src/intelligence/store.ts", old_assumption_lookup, new_assumption_lookup)

old_assumption_update = '''    this.db.prepare(\n      `UPDATE adaptive_assumptions\n       SET status = ?, confidence = ?, evidence = ?, updated_at = ?\n       WHERE id = ?`,\n    ).run(\n      status,\n      confidence ?? existing.confidence,\n      stringify(mergedEvidence),\n      new Date().toISOString(),\n      id,\n    );'''
new_assumption_update = '''    this.db.transaction(() => {\n      this.db.prepare(\n        `UPDATE adaptive_assumptions\n         SET status = ?, confidence = ?, evidence = ?, updated_at = ?\n         WHERE id = ?`,\n      ).run(\n        status,\n        confidence ?? existing.confidence,\n        stringify(mergedEvidence),\n        new Date().toISOString(),\n        id,\n      );\n      appendAdaptiveAuthorityEvent(this.db, {\n        eventType: "adaptive.assumption_status_changed",\n        authorityType: "adaptive_assumption",\n        authorityId: id,\n        goalId: existing.goal_id,\n        causationId: correlationIdFor("adaptive_path", existing.path_id),\n        payload: {\n          fromStatus: existing.status,\n          toStatus: status,\n          confidence: confidence ?? existing.confidence,\n          evidenceCount: mergedEvidence.length,\n        },\n      });\n    })();'''
replace_once("src/intelligence/store.ts", old_assumption_update, new_assumption_update)

old_fact = '''    this.db.prepare(\n      `INSERT INTO adaptive_world_facts\n       (id, goal_id, key, value, confidence, epistemic_status, source,\n        last_verified_at, created_at, updated_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n       ON CONFLICT(goal_id, key) DO UPDATE SET\n         value = excluded.value,\n         confidence = excluded.confidence,\n         epistemic_status = excluded.epistemic_status,\n         source = excluded.source,\n         last_verified_at = excluded.last_verified_at,\n         updated_at = excluded.updated_at`,\n    ).run(\n      id,\n      input.goalId,\n      input.key,\n      input.value,\n      input.confidence ?? 1,\n      input.epistemicStatus ?? "fact",\n      input.source,\n      input.lastVerifiedAt ?? null,\n      new Date().toISOString(),\n      new Date().toISOString(),\n    );\n\n    return this.getFact(input.goalId, input.key)!;'''
new_fact = '''    this.db.transaction(() => {\n      const now = new Date().toISOString();\n      this.db.prepare(\n        `INSERT INTO adaptive_world_facts\n         (id, goal_id, key, value, confidence, epistemic_status, source,\n          last_verified_at, created_at, updated_at)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\n         ON CONFLICT(goal_id, key) DO UPDATE SET\n           value = excluded.value,\n           confidence = excluded.confidence,\n           epistemic_status = excluded.epistemic_status,\n           source = excluded.source,\n           last_verified_at = excluded.last_verified_at,\n           updated_at = excluded.updated_at`,\n      ).run(\n        id,\n        input.goalId,\n        input.key,\n        input.value,\n        input.confidence ?? 1,\n        input.epistemicStatus ?? "fact",\n        input.source,\n        input.lastVerifiedAt ?? null,\n        now,\n        now,\n      );\n      appendAdaptiveAuthorityEvent(this.db, {\n        eventType: "adaptive.fact_upserted",\n        authorityType: "adaptive_world_fact",\n        authorityId: id,\n        goalId: input.goalId,\n        payload: {\n          domainEpistemicStatus: input.epistemicStatus ?? "fact",\n          confidence: input.confidence ?? 1,\n        },\n      });\n    })();\n\n    return this.getFact(input.goalId, input.key)!;'''
replace_once("src/intelligence/store.ts", old_fact, new_fact)

old_opportunity = '''    this.db.prepare(\n      `INSERT INTO adaptive_opportunities\n       (id, goal_id, source_path_id, description, status, evidence, created_at, updated_at)\n       VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,\n    ).run(\n      id,\n      input.goalId,\n      input.sourcePathId ?? null,\n      input.description,\n      stringify(input.evidence ?? []),\n      now,\n      now,\n    );\n    return {'''
new_opportunity = '''    this.db.transaction(() => {\n      this.db.prepare(\n        `INSERT INTO adaptive_opportunities\n         (id, goal_id, source_path_id, description, status, evidence, created_at, updated_at)\n         VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`,\n      ).run(\n        id,\n        input.goalId,\n        input.sourcePathId ?? null,\n        input.description,\n        stringify(input.evidence ?? []),\n        now,\n        now,\n      );\n      appendAdaptiveAuthorityEvent(this.db, {\n        eventType: "adaptive.opportunity_opened",\n        authorityType: "adaptive_opportunity",\n        authorityId: id,\n        goalId: input.goalId,\n        causationId: input.sourcePathId\n          ? correlationIdFor("adaptive_path", input.sourcePathId)\n          : null,\n        payload: { status: "open" },\n      });\n    })();\n    return {'''
replace_once("src/intelligence/store.ts", old_opportunity, new_opportunity)

# Focused proof that the fabric references, but does not replace, AdaptiveStore.
(ROOT / "src/__tests__/p013-adaptive-correlation.test.ts").write_text(r'''import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MIGRATION_V12 } from "../state/schema.js";
import { AdaptivePathEngine } from "../intelligence/adaptive-engine.js";
import type { PathCandidate } from "../intelligence/types.js";
import { getEvidenceByCorrelation } from "../observability/evidence.js";

function dbForTest(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE goals (
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
  db.exec(MIGRATION_V12);
  db.prepare(
    "INSERT INTO goals (id, title, description, created_at) VALUES (?, ?, ?, ?)",
  ).run("goal-p013", "Goal", "Correlation test", new Date().toISOString());
  return db;
}

function candidate(): PathCandidate {
  return {
    goalId: "goal-p013",
    taskId: "task-p013",
    hypothesis: "Provider path can satisfy the task",
    strategy: "Use provider",
    assumptions: ["Provider is reachable"],
    requiredCapabilities: ["api"],
    environment: "local",
    executor: "local://worker",
    sequence: ["attempt provider"],
    expectedOutcome: "result",
    expectedCostCents: 5,
    evidence: [],
  };
}

describe("P-013 adaptive correlation", () => {
  it("reconstructs path, attempt and learning references under the goal correlation", () => {
    const db = dbForTest();
    try {
      const engine = new AdaptivePathEngine(db);
      const selected = engine.selectCandidate(candidate(), { network: "degraded" });
      engine.store.bindTask({
        taskId: "task-p013",
        goalId: "goal-p013",
        pathId: selected.path.id,
      });
      const decision = engine.recordFailure({
        candidate: candidate(),
        pathId: selected.path.id,
        error: "The provider returned an invalid result",
        observations: ["provider response failed validation"],
        evidence: ["artifact://validation-result"],
        learnedFacts: [{ key: "provider.validation", value: "failed", confidence: 0.9 }],
        conditions: { network: "degraded" },
      });

      const events = getEvidenceByCorrelation(db, "goal:goal-p013");
      const types = events.map((event) => event.eventType);
      expect(types).toContain("adaptive.path_created");
      expect(types).toContain("adaptive.path_status_changed");
      expect(types).toContain("adaptive.task_bound");
      expect(types).toContain("adaptive.fact_upserted");
      expect(types).toContain("adaptive.attempt_recorded");
      expect(types).toContain("adaptive.evidence_recorded");
      expect(types).toContain("adaptive.opportunity_opened");

      const attemptEvent = events.find((event) => event.eventType === "adaptive.attempt_recorded");
      expect(attemptEvent?.authorityType).toBe("adaptive_attempt");
      expect(attemptEvent?.authorityId).toBe(decision.attempt.id);
      expect(attemptEvent?.taskId).toBe("task-p013");
      expect(attemptEvent?.causationId).toBe(`adaptive_path:${selected.path.id}`);

      const evidenceRows = db.prepare(
        "SELECT id FROM adaptive_evidence WHERE attempt_id = ? ORDER BY created_at",
      ).all(decision.attempt.id) as Array<{ id: string }>;
      expect(evidenceRows.length).toBeGreaterThan(0);
      for (const row of evidenceRows) {
        expect(events.some((event) =>
          event.authorityType === "adaptive_evidence" && event.authorityId === row.id
        )).toBe(true);
      }

      // The fabric indexes facts; canonical values stay in adaptive_world_facts.
      expect(JSON.stringify(events)).not.toContain("provider.validation");
      expect(JSON.stringify(events)).not.toContain('"failed"');
      expect(engine.store.getFact("goal-p013", "provider.validation")?.value).toBe("failed");
    } finally {
      db.close();
    }
  });

  it("rolls back the canonical attempt row when its critical evidence reference cannot commit", () => {
    const db = dbForTest();
    try {
      const engine = new AdaptivePathEngine(db);
      const selected = engine.selectCandidate(candidate());
      db.exec(`
        CREATE TRIGGER reject_adaptive_attempt_evidence
        BEFORE INSERT ON evidence_events
        WHEN NEW.event_type = 'adaptive.attempt_recorded'
        BEGIN
          SELECT RAISE(ABORT, 'intentional adaptive evidence failure');
        END;
      `);

      expect(() => engine.store.recordAttempt({
        pathId: selected.path.id,
        goalId: "goal-p013",
        taskId: "task-p013",
        outcome: "failed",
        failureClass: "strategic_failure",
        failureReason: "probe",
        conditionFingerprint: "conditions:none",
        noveltyScore: 1,
        retryEligible: false,
      })).toThrow("intentional adaptive evidence failure");

      const count = db.prepare(
        "SELECT COUNT(*) AS count FROM adaptive_attempts WHERE goal_id = ?",
      ).get("goal-p013") as { count: number };
      expect(count.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
''', encoding="utf-8")

print("P013_ADAPTIVE_APPLY: PASS")
