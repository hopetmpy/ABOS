import { createHash } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import type { Skill, SkillRequirements, SkillSource } from "../types.js";
import type { CapabilityRegistry, SkillCapabilityProjection } from "../capabilities/registry.js";
import { appendEvidenceEvent, correlationIdFor, getEvidenceEvent } from "../observability/evidence.js";

export type SkillLifecycleState = "candidate" | "validated" | "active" | "superseded" | "degraded" | "disabled" | "deprecated";

export interface SkillCapabilityContract {
  requiredCapabilities: string[];
  provides: string[];
  permissions: string[];
  effects: string[];
  compatibility: string[];
  environment: string | null;
  inputs: string[];
  outputs: string[];
}

export interface SkillVerificationPolicy {
  method: string;
  critical: boolean;
  minimumIndependentSuccesses: number;
}

export interface SkillVersionDefinition {
  name: string;
  description: string;
  autoActivate: boolean;
  requires?: SkillRequirements;
  instructions: string;
  source: SkillSource;
  path: string;
  capability: SkillCapabilityContract;
}

export interface SkillVersionRecord {
  id: string;
  skillName: string;
  version: number;
  parentVersionId: string | null;
  lifecycleState: SkillLifecycleState | string;
  definition: SkillVersionDefinition;
  contentHash: string;
  verification: SkillVerificationPolicy;
  applicability: Record<string, unknown>;
  provenance: Record<string, unknown>;
  evidenceEventIds: string[];
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  deprecatedAt: string | null;
}

export interface SkillEvaluationRecord {
  id: string;
  skillVersionId: string;
  evaluationKind: string;
  outcome: string;
  evidenceEventId: string;
  taskId: string | null;
  environmentId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface PromotionAssessment {
  eligible: boolean;
  requiredIndependentSuccesses: number;
  successfulEvidenceIds: string[];
  reasons: string[];
}

type Database = BetterSqlite3.Database;

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:password|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["'][^"']{6,}["']/i,
];

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Invalid persisted ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeDefinition(input: SkillVersionDefinition): SkillVersionDefinition {
  const name = input.name.trim();
  if (!/^[a-zA-Z0-9-]+$/.test(name)) throw new Error(`Invalid skill name for evolution: ${input.name}`);
  const capability = input.capability ?? ({} as SkillCapabilityContract);
  return {
    name,
    description: input.description.trim().slice(0, 500),
    autoActivate: Boolean(input.autoActivate),
    requires: input.requires ? { bins: unique(input.requires.bins), env: unique(input.requires.env) } : undefined,
    instructions: input.instructions.slice(0, 10_000),
    source: input.source,
    path: input.path,
    capability: {
      requiredCapabilities: unique(capability.requiredCapabilities),
      provides: unique(capability.provides),
      permissions: unique(capability.permissions),
      effects: unique(capability.effects),
      compatibility: unique(capability.compatibility),
      environment: capability.environment?.trim() || null,
      inputs: unique(capability.inputs),
      outputs: unique(capability.outputs),
    },
  };
}

function normalizeVerification(policy: SkillVerificationPolicy): SkillVerificationPolicy {
  const method = policy.method.trim();
  if (!method) throw new Error("Skill verification method is required.");
  const requested = Number.isFinite(policy.minimumIndependentSuccesses)
    ? Math.floor(policy.minimumIndependentSuccesses)
    : 1;
  return { method, critical: Boolean(policy.critical), minimumIndependentSuccesses: Math.max(1, requested) };
}

function rejectSecretMaterial(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) throw new Error("Skill evolution candidate contains secret-like material and was rejected.");
  }
}

function contentHash(definition: SkillVersionDefinition, verification: SkillVerificationPolicy, applicability: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify({ definition, verification, applicability })).digest("hex");
}

function deserializeVersion(row: any): SkillVersionRecord {
  return {
    id: row.id,
    skillName: row.skill_name,
    version: row.version,
    parentVersionId: row.parent_version_id ?? null,
    lifecycleState: row.lifecycle_state,
    definition: parseJson(row.definition_json, `skill version definition ${row.id}`),
    contentHash: row.content_hash,
    verification: parseJson(row.verification_json, `skill verification ${row.id}`),
    applicability: parseJson(row.applicability_json, `skill applicability ${row.id}`),
    provenance: parseJson(row.provenance_json, `skill provenance ${row.id}`),
    evidenceEventIds: parseJson(row.evidence_json || "[]", `skill evidence ${row.id}`),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activatedAt: row.activated_at ?? null,
    deprecatedAt: row.deprecated_at ?? null,
  };
}

function deserializeEvaluation(row: any): SkillEvaluationRecord {
  return {
    id: row.id,
    skillVersionId: row.skill_version_id,
    evaluationKind: row.evaluation_kind,
    outcome: row.outcome,
    evidenceEventId: row.evidence_event_id,
    taskId: row.task_id ?? null,
    environmentId: row.environment_id ?? null,
    details: parseJson(row.details_json || "{}", `skill evaluation details ${row.id}`),
    createdAt: row.created_at,
  };
}

export function isSkillEvolutionManaged(db: Database | undefined | null, skillName: string): boolean {
  if (!db) return false;
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='skill_versions'").get();
  if (!table) return false;
  return Boolean(db.prepare("SELECT 1 FROM skill_versions WHERE skill_name = ? LIMIT 1").get(skillName));
}

export class SkillEvolutionEngine {
  constructor(private readonly db: Database) {}

  isManaged(skillName: string): boolean { return isSkillEvolutionManaged(this.db, skillName); }

  getVersion(id: string): SkillVersionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM skill_versions WHERE id = ?").get(id) as any | undefined;
    return row ? deserializeVersion(row) : undefined;
  }

  listVersions(skillName: string): SkillVersionRecord[] {
    return (this.db.prepare("SELECT * FROM skill_versions WHERE skill_name = ? ORDER BY version DESC").all(skillName) as any[]).map(deserializeVersion);
  }

  getActiveVersion(skillName: string): SkillVersionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM skill_versions WHERE skill_name = ? AND lifecycle_state = 'active' LIMIT 1").get(skillName) as any | undefined;
    return row ? deserializeVersion(row) : undefined;
  }

  getRuntimeVersion(skillName: string): SkillVersionRecord | undefined {
    const active = this.getActiveVersion(skillName);
    if (active) return active;
    const row = this.db.prepare(`SELECT * FROM skill_versions WHERE skill_name = ? AND activated_at IS NOT NULL ORDER BY datetime(updated_at) DESC, version DESC LIMIT 1`).get(skillName) as any | undefined;
    return row ? deserializeVersion(row) : undefined;
  }

  listEvaluations(versionId: string): SkillEvaluationRecord[] {
    return (this.db.prepare("SELECT * FROM skill_evaluations WHERE skill_version_id = ? ORDER BY created_at ASC, id ASC").all(versionId) as any[]).map(deserializeEvaluation);
  }

  bootstrapLegacySkills(): number {
    const rows = this.db.prepare("SELECT * FROM skills ORDER BY name ASC").all() as any[];
    let imported = 0;
    for (const row of rows) {
      const skillName = String(row.name);
      if (this.isManaged(skillName)) continue;

      const definition = normalizeDefinition({
        name: skillName,
        description: String(row.description ?? ""),
        autoActivate: Boolean(row.auto_activate),
        requires: parseJson<SkillRequirements>(String(row.requires || "{}"), `legacy skill requirements ${skillName}`),
        instructions: String(row.instructions ?? ""),
        source: String(row.source ?? "builtin") as SkillSource,
        path: String(row.path ?? ""),
        capability: {
          requiredCapabilities: [],
          provides: [skillName],
          permissions: [],
          effects: [],
          compatibility: [],
          environment: null,
          inputs: [],
          outputs: [],
        },
      });
      const verification = normalizeVerification({
        method: "legacy_runtime_baseline",
        critical: false,
        minimumIndependentSuccesses: 1,
      });
      const applicability: Record<string, unknown> = {};
      const provenance: Record<string, unknown> = {
        legacyBaseline: true,
        importedFrom: "skills_projection",
        installedAt: row.installed_at ?? null,
      };
      rejectSecretMaterial({ definition, provenance });
      const id = ulid();
      const now = new Date().toISOString();
      const enabled = Boolean(row.enabled);
      const hash = contentHash(definition, verification, applicability);

      this.db.transaction(() => {
        const observation = appendEvidenceEvent(this.db, {
          correlationId: correlationIdFor("skill", skillName),
          eventType: "skill.legacy_baseline_imported",
          domain: "skill",
          authorityType: "skill_version",
          authorityId: id,
          epistemicStatus: "observation",
          payload: { skillName, enabled, contentHash: hash, importedFrom: "skills_projection" },
          provenance: { source: "SkillEvolutionEngine.bootstrapLegacySkills" },
        });
        this.db.prepare(`INSERT INTO skill_versions (
          id, skill_name, version, parent_version_id, lifecycle_state,
          definition_json, content_hash, verification_json, applicability_json,
          provenance_json, evidence_json, created_at, updated_at, activated_at
        ) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id,
          skillName,
          enabled ? "active" : "disabled",
          JSON.stringify(definition),
          hash,
          JSON.stringify(verification),
          JSON.stringify(applicability),
          JSON.stringify(provenance),
          JSON.stringify([observation.id]),
          now,
          now,
          enabled ? now : null,
        );
      })();
      imported += 1;
    }
    return imported;
  }

  observeFilesystemSkill(skill: Skill): SkillVersionRecord | undefined {
    const runtime = this.getRuntimeVersion(skill.name);
    if (!runtime) return undefined;

    const definition = normalizeDefinition({
      ...runtime.definition,
      name: skill.name,
      description: skill.description,
      autoActivate: skill.autoActivate,
      requires: skill.requires,
      instructions: skill.instructions,
      source: skill.source,
      path: skill.path,
      capability: runtime.definition.capability,
    });
    const verification = runtime.provenance.legacyBaseline
      ? normalizeVerification({
          method: "managed_file_change_validation",
          critical: false,
          minimumIndependentSuccesses: 1,
        })
      : runtime.verification;
    const applicability = runtime.applicability;
    rejectSecretMaterial({ definition });
    const hash = contentHash(definition, verification, applicability);
    if (hash === runtime.contentHash) return runtime;

    const existing = this.db.prepare(`SELECT * FROM skill_versions
      WHERE skill_name = ? AND content_hash = ? AND lifecycle_state <> 'deprecated'
      ORDER BY version DESC LIMIT 1`).get(skill.name, hash) as any | undefined;
    if (existing) return deserializeVersion(existing);

    const observed = appendEvidenceEvent(this.db, {
      correlationId: correlationIdFor("skill", skill.name),
      eventType: "skill.file_change_observed",
      domain: "skill",
      authorityType: "skill_version",
      authorityId: runtime.id,
      epistemicStatus: "observation",
      payload: { skillName: skill.name, parentVersionId: runtime.id, contentHash: hash, path: skill.path },
      provenance: { source: "SkillEvolutionEngine.observeFilesystemSkill" },
    });
    return this.createCandidate({
      definition,
      verification,
      applicability,
      provenance: {
        observedFromFilesystem: true,
        observedAt: new Date().toISOString(),
        parentVersionId: runtime.id,
      },
      evidenceEventIds: [observed.id],
      parentVersionId: runtime.id,
    });
  }

  createCandidate(input: {
    definition: SkillVersionDefinition;
    verification: SkillVerificationPolicy;
    applicability?: Record<string, unknown>;
    provenance?: Record<string, unknown>;
    evidenceEventIds: string[];
    parentVersionId?: string | null;
  }): SkillVersionRecord {
    const definition = normalizeDefinition(input.definition);
    const verification = normalizeVerification(input.verification);
    const applicability = record(input.applicability);
    const provenance = record(input.provenance);
    const evidenceEventIds = unique(input.evidenceEventIds);
    if (evidenceEventIds.length === 0) throw new Error("Skill evolution candidate requires at least one existing evidence event.");
    for (const evidenceId of evidenceEventIds) {
      if (!getEvidenceEvent(this.db, evidenceId)) throw new Error(`Unknown evidence event for skill candidate: ${evidenceId}`);
    }
    rejectSecretMaterial({ definition, provenance });
    const hash = contentHash(definition, verification, applicability);

    let parent: SkillVersionRecord | undefined;
    const requestedParentId = input.parentVersionId === undefined
      ? this.getRuntimeVersion(definition.name)?.id ?? null
      : input.parentVersionId;
    if (requestedParentId) {
      parent = this.getVersion(requestedParentId);
      if (!parent) throw new Error(`Unknown parent skill version: ${requestedParentId}`);
      if (parent.skillName !== definition.name) throw new Error("Parent skill version belongs to a different skill.");
    }

    const latest = this.db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM skill_versions WHERE skill_name = ?").get(definition.name) as { version: number };
    const version = latest.version + 1;
    const id = ulid();
    const now = new Date().toISOString();

    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO skill_versions (id, skill_name, version, parent_version_id, lifecycle_state, definition_json, content_hash, verification_json, applicability_json, provenance_json, evidence_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, definition.name, version, parent?.id ?? null, JSON.stringify(definition), hash,
        JSON.stringify(verification), JSON.stringify(applicability), JSON.stringify(provenance),
        JSON.stringify(evidenceEventIds), now, now,
      );
      appendEvidenceEvent(this.db, {
        correlationId: correlationIdFor("skill", definition.name), causationId: evidenceEventIds[0],
        eventType: "skill.candidate_created", domain: "skill", authorityType: "skill_version", authorityId: id,
        epistemicStatus: "observation",
        payload: { skillName: definition.name, version, parentVersionId: parent?.id ?? null, contentHash: hash, verification },
        provenance: { source: "SkillEvolutionEngine", evidenceEventIds },
      });
    })();
    return this.getVersion(id)!;
  }

  recordEvaluation(input: {
    versionId: string; evaluationKind: string; outcome: string; evidenceEventId: string;
    taskId?: string | null; environmentId?: string | null; details?: Record<string, unknown>;
  }): SkillEvaluationRecord {
    const version = this.requireVersion(input.versionId);
    const evaluationKind = input.evaluationKind.trim();
    const outcome = input.outcome.trim().toLowerCase();
    if (!evaluationKind) throw new Error("evaluationKind is required.");
    if (!outcome) throw new Error("evaluation outcome is required.");
    if (!["success", "failure", "partial", "inconclusive"].includes(outcome)) {
      throw new Error(`Unsupported evaluation outcome: ${input.outcome}`);
    }
    if (!getEvidenceEvent(this.db, input.evidenceEventId)) throw new Error(`Evaluation evidence does not exist: ${input.evidenceEventId}`);
    const id = ulid();
    const now = new Date().toISOString();
    const details = record(input.details);
    rejectSecretMaterial(details);
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO skill_evaluations (id, skill_version_id, evaluation_kind, outcome, evidence_event_id, task_id, environment_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, version.id, evaluationKind, outcome, input.evidenceEventId, input.taskId ?? null,
        input.environmentId ?? null, JSON.stringify(details), now,
      );
      appendEvidenceEvent(this.db, {
        correlationId: correlationIdFor("skill", version.skillName), causationId: input.evidenceEventId,
        eventType: "skill.evaluation_recorded", domain: "skill", authorityType: "skill_version", authorityId: version.id,
        taskId: input.taskId ?? null, epistemicStatus: "observation",
        payload: { evaluationId: id, evaluationKind, outcome, environmentId: input.environmentId ?? null },
        provenance: { source: "SkillEvolutionEngine" },
      });
    })();
    return this.listEvaluations(version.id).find((entry) => entry.id === id)!;
  }

  assessPromotion(versionId: string, registry: CapabilityRegistry): PromotionAssessment {
    const version = this.requireVersion(versionId);
    const evaluations = this.listEvaluations(version.id);
    const relevant = evaluations.filter((entry) => ["validation", "replay"].includes(entry.evaluationKind.toLowerCase()));
    const successful = relevant.filter((entry) => entry.outcome === "success");
    const successfulEvidenceIds = unique(successful.map((entry) => entry.evidenceEventId));
    const failedValidation = relevant.some((entry) => entry.outcome === "failure");
    const requiredIndependentSuccesses = Math.max(version.verification.minimumIndependentSuccesses, version.verification.critical ? 2 : 1);
    const independentContexts = unique(successful.map((entry) => {
      if (entry.taskId || entry.environmentId) return `task:${entry.taskId ?? "unknown"}|env:${entry.environmentId ?? "unknown"}`;
      return "context:unspecified";
    }));
    const independentSuccessCount = requiredIndependentSuccesses > 1
      ? Math.min(successfulEvidenceIds.length, independentContexts.length)
      : successfulEvidenceIds.length > 0 ? 1 : 0;
    const reasons: string[] = [];
    if (failedValidation) reasons.push("At least one validation/replay observation failed.");
    if (independentSuccessCount < requiredIndependentSuccesses) {
      reasons.push(`Need ${requiredIndependentSuccesses} independent successful validation/replay evidence contexts; found ${independentSuccessCount}.`);
    }
    for (const dependency of version.definition.capability.requiredCapabilities) {
      if (!registry.isExecutionReady(dependency)) reasons.push(`Required capability is not execution-ready: ${dependency}`);
    }
    return { eligible: reasons.length === 0, requiredIndependentSuccesses, successfulEvidenceIds, reasons };
  }

  validateVersion(versionId: string, registry: CapabilityRegistry): SkillVersionRecord {
    const version = this.requireVersion(versionId);
    if (version.lifecycleState !== "candidate") throw new Error(`Skill version ${version.id} cannot be validated from state ${version.lifecycleState}; only candidate versions can enter validation.`);
    const assessment = this.assessPromotion(version.id, registry);
    if (!assessment.eligible) throw new Error(`Skill version is not validation-ready: ${assessment.reasons.join(" ")}`);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE skill_versions SET lifecycle_state = 'validated', updated_at = ? WHERE id = ?").run(now, version.id);
      appendEvidenceEvent(this.db, {
        correlationId: correlationIdFor("skill", version.skillName), causationId: assessment.successfulEvidenceIds[0],
        eventType: "skill.version_validated", domain: "skill", authorityType: "skill_version", authorityId: version.id,
        epistemicStatus: "observation", payload: { method: version.verification.method, successfulEvidenceIds: assessment.successfulEvidenceIds },
        provenance: { source: "SkillEvolutionEngine" },
      });
    })();
    return this.getVersion(version.id)!;
  }

  activateVersion(versionId: string, registry: CapabilityRegistry): SkillVersionRecord {
    const version = this.requireVersion(versionId);
    if (version.lifecycleState !== "validated") throw new Error(`Skill version ${version.id} must be validated before activation.`);
    const assessment = this.assessPromotion(version.id, registry);
    if (!assessment.eligible) throw new Error(`Skill version is no longer activation-ready: ${assessment.reasons.join(" ")}`);
    this.activateProjection(version, registry, assessment.successfulEvidenceIds, "skill.version_activated");
    return this.getVersion(version.id)!;
  }

  degradeVersion(versionId: string, evidenceEventId: string, reason: string, registry: CapabilityRegistry): SkillVersionRecord {
    const version = this.requireVersion(versionId);
    if (version.lifecycleState !== "active") throw new Error(`Only an active skill version can be degraded; state=${version.lifecycleState}.`);
    this.requireEvidence(evidenceEventId);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE skill_versions SET lifecycle_state = 'degraded', updated_at = ? WHERE id = ?").run(now, version.id);
      this.db.prepare("UPDATE skills SET enabled = 0 WHERE name = ?").run(version.skillName);
      appendEvidenceEvent(this.db, {
        correlationId: correlationIdFor("skill", version.skillName), causationId: evidenceEventId,
        eventType: "skill.version_degraded", domain: "skill", authorityType: "skill_version", authorityId: version.id,
        epistemicStatus: "observation", payload: { reason }, provenance: { source: "SkillEvolutionEngine" },
      });
    })();
    registry.registerSkillInventory({ name: version.skillName, description: version.definition.description, enabled: false }, this.projectionFor(version));
    registry.recordProbe(`skill:${version.skillName}`, { state: "degraded", authority: `skill-evolution:${version.id}`, evidence: [`Skill version ${version.version} degraded from evidence event ${evidenceEventId}.`] });
    return this.getVersion(version.id)!;
  }

  deprecateVersion(versionId: string, evidenceEventId: string, reason: string, registry: CapabilityRegistry): SkillVersionRecord {
    const version = this.requireVersion(versionId);
    this.requireEvidence(evidenceEventId);
    const runtimeBefore = this.getRuntimeVersion(version.skillName);
    const controlledRuntime = runtimeBefore?.id === version.id;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE skill_versions SET lifecycle_state = 'deprecated', deprecated_at = ?, updated_at = ? WHERE id = ?").run(now, now, version.id);
      if (controlledRuntime) this.db.prepare("UPDATE skills SET enabled = 0 WHERE name = ?").run(version.skillName);
      appendEvidenceEvent(this.db, {
        correlationId: correlationIdFor("skill", version.skillName), causationId: evidenceEventId,
        eventType: "skill.version_deprecated", domain: "skill", authorityType: "skill_version", authorityId: version.id,
        epistemicStatus: "observation", payload: { reason, controlledRuntime }, provenance: { source: "SkillEvolutionEngine" },
      });
    })();
    if (controlledRuntime) {
      registry.registerSkillInventory({ name: version.skillName, description: version.definition.description, enabled: false }, this.projectionFor(version));
      registry.recordProbe(`skill:${version.skillName}`, { state: "retired", authority: `skill-evolution:${version.id}`, evidence: [`Skill version ${version.version} deprecated from evidence event ${evidenceEventId}.`] });
    }
    return this.getVersion(version.id)!;
  }

  rollback(skillName: string, targetVersionId: string, evidenceEventId: string, registry: CapabilityRegistry): SkillVersionRecord {
    const target = this.requireVersion(targetVersionId);
    if (target.skillName !== skillName) throw new Error("Rollback target belongs to another skill.");
    if (!target.activatedAt) throw new Error("Rollback target has never been an activated runtime version.");
    if (target.lifecycleState !== "superseded") throw new Error(`Rollback target must be a superseded previously activated version; state=${target.lifecycleState}.`);
    this.requireEvidence(evidenceEventId);
    const dependencyFailures = target.definition.capability.requiredCapabilities.filter((dependency) => !registry.isExecutionReady(dependency));
    if (dependencyFailures.length > 0) throw new Error(`Rollback target dependencies are not execution-ready: ${dependencyFailures.join(", ")}`);
    this.activateProjection(target, registry, [evidenceEventId], "skill.version_rolled_back");
    return this.getVersion(target.id)!;
  }

  getCapabilityProjection(skillName: string): SkillCapabilityProjection | undefined {
    const runtimeVersion = this.getRuntimeVersion(skillName);
    return runtimeVersion ? this.projectionFor(runtimeVersion) : undefined;
  }

  isPromptEligible(skillName: string, registry: CapabilityRegistry): boolean {
    if (!this.isManaged(skillName)) return true;
    const active = this.getActiveVersion(skillName);
    if (!active) return false;
    if (active.provenance.legacyBaseline === true) return true;
    return registry.isExecutionReady(`skill:${skillName}`);
  }

  reconcileCapabilityRegistry(registry: CapabilityRegistry): void {
    const rows = this.db.prepare(`SELECT * FROM skill_versions WHERE activated_at IS NOT NULL ORDER BY skill_name ASC, datetime(updated_at) DESC, version DESC`).all() as any[];
    const seen = new Set<string>();
    for (const row of rows) {
      const version = deserializeVersion(row);
      if (seen.has(version.skillName)) continue;
      seen.add(version.skillName);
      const enabled = version.lifecycleState === "active";
      registry.registerSkillInventory({ name: version.skillName, description: version.definition.description, enabled }, this.projectionFor(version));
      const legacyBaseline = version.provenance.legacyBaseline === true;
      const state = legacyBaseline
        ? "discovered_unverified"
        : version.lifecycleState === "active" ? "verified_available"
          : version.lifecycleState === "degraded" ? "degraded"
            : version.lifecycleState === "deprecated" ? "retired" : "unavailable";
      registry.recordProbe(`skill:${version.skillName}`, {
        state,
        authority: `skill-evolution:${version.id}`,
        evidence: legacyBaseline
          ? [`Restored legacy runtime baseline version ${version.version}; this is compatibility evidence, not execution-readiness proof.`]
          : [`Restored skill version ${version.version} lifecycle=${version.lifecycleState} from durable skill evolution authority.`, ...version.evidenceEventIds.map((id) => `Evidence event ${id}`)],
        observedAt: version.updatedAt,
        metadata: { skillVersionId: version.id, skillVersion: version.version, legacyBaseline },
      });
    }
  }

  private activateProjection(version: SkillVersionRecord, registry: CapabilityRegistry, evidenceIds: string[], eventType: string): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`UPDATE skill_versions SET lifecycle_state = 'superseded', updated_at = ? WHERE skill_name = ? AND lifecycle_state = 'active' AND id <> ?`).run(now, version.skillName, version.id);
      this.db.prepare(`UPDATE skill_versions SET lifecycle_state = 'active', activated_at = COALESCE(activated_at, ?), deprecated_at = NULL, updated_at = ? WHERE id = ?`).run(now, now, version.id);
      this.projectSkill(version.definition, now);
      appendEvidenceEvent(this.db, {
        correlationId: correlationIdFor("skill", version.skillName), causationId: evidenceIds[0] ?? null,
        eventType, domain: "skill", authorityType: "skill_version", authorityId: version.id,
        epistemicStatus: "observation", payload: { version: version.version, evidenceIds }, provenance: { source: "SkillEvolutionEngine" },
      });
    })();
    registry.registerSkillInventory({ name: version.skillName, description: version.definition.description, enabled: true }, this.projectionFor(version));
    registry.recordProbe(`skill:${version.skillName}`, {
      state: "verified_available", authority: `skill-evolution:${version.id}`,
      evidence: [`Skill version ${version.version} activated from evidence-backed lifecycle.`, ...evidenceIds.map((id) => `Validation evidence event ${id}`)],
      observedAt: now, metadata: { skillVersionId: version.id, skillVersion: version.version },
    });
  }

  private projectSkill(definition: SkillVersionDefinition, now: string): void {
    this.db.prepare(`INSERT INTO skills (name, description, auto_activate, requires, instructions, source, path, enabled, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(name) DO UPDATE SET description = excluded.description, auto_activate = excluded.auto_activate, requires = excluded.requires, instructions = excluded.instructions, source = excluded.source, path = excluded.path, enabled = 1`).run(
      definition.name, definition.description, definition.autoActivate ? 1 : 0,
      JSON.stringify(definition.requires ?? {}), definition.instructions, definition.source, definition.path, now,
    );
  }

  private projectionFor(version: SkillVersionRecord): SkillCapabilityProjection {
    const contract = version.definition.capability;
    return {
      version: String(version.version), dependencies: [...contract.requiredCapabilities],
      provides: contract.provides.length > 0 ? [...contract.provides] : [version.skillName],
      permissions: [...contract.permissions], effects: [...contract.effects], compatibility: [...contract.compatibility],
      environment: contract.environment, inputs: [...contract.inputs], outputs: [...contract.outputs],
      metadata: { skillEvolutionManaged: true, skillVersionId: version.id, lifecycleState: version.lifecycleState, verificationMethod: version.verification.method, contentHash: version.contentHash },
    };
  }

  private requireVersion(id: string): SkillVersionRecord {
    const version = this.getVersion(id);
    if (!version) throw new Error(`Unknown skill version: ${id}`);
    return version;
  }

  private requireEvidence(id: string): void {
    if (!getEvidenceEvent(this.db, id)) throw new Error(`Unknown evidence event: ${id}`);
  }
}

export function skillRecordFromProjection(skill: Skill): Pick<Skill, "name" | "description" | "enabled"> {
  return { name: skill.name, description: skill.description, enabled: skill.enabled };
}