from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one literal match, found {count}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    p = Path(path)
    text = p.read_text()
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one regex match, found {count}: {pattern[:140]!r}")
    p.write_text(new_text)


# 1. Lifecycle semantics: legacy baselines can be durable without pretending to be active/verified.
replace_once(
    "src/skills/evolution.ts",
    'export type SkillLifecycleState = "candidate" | "validated" | "active" | "superseded" | "degraded" | "deprecated";',
    'export type SkillLifecycleState = "candidate" | "validated" | "active" | "superseded" | "degraded" | "disabled" | "deprecated";',
)

# 2. Durable baseline import + managed filesystem observation. `skills` stays the runtime projection.
insert = r'''  bootstrapLegacySkills(): number {
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

'''
replace_once("src/skills/evolution.ts", "  createCandidate(input: {", insert + "  createCandidate(input: {")

# 3. Candidate creation defaults parent to current runtime and deduplicates same semantic version.
replace_regex(
    "src/skills/evolution.ts",
    r'''  createCandidate\(input: \{.*?\n  \}\n\n  recordEvaluation\(input:''',
    r'''  createCandidate(input: {
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

    const existing = this.db.prepare(`SELECT * FROM skill_versions
      WHERE skill_name = ? AND content_hash = ? AND lifecycle_state <> 'deprecated'
      ORDER BY version DESC LIMIT 1`).get(definition.name, hash) as any | undefined;
    if (existing) return deserializeVersion(existing);

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

  recordEvaluation(input:''',
)

# 4. Evaluation outcomes are explicit; typos cannot become durable evidence semantics.
replace_once(
    "src/skills/evolution.ts",
    '    if (!outcome) throw new Error("evaluation outcome is required.");\n',
    '    if (!outcome) throw new Error("evaluation outcome is required.");\n    if (!["success", "failure", "partial", "inconclusive"].includes(outcome)) {\n      throw new Error(`Unsupported evaluation outcome: ${input.outcome}`);\n    }\n',
)

# 5. Promotion independence is contextual, not merely a count of different evidence IDs.
replace_regex(
    "src/skills/evolution.ts",
    r'''  assessPromotion\(versionId: string, registry: CapabilityRegistry\): PromotionAssessment \{.*?\n  \}\n\n  validateVersion''',
    r'''  assessPromotion(versionId: string, registry: CapabilityRegistry): PromotionAssessment {
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
      ? independentContexts.length
      : successfulEvidenceIds.length > 0 ? 1 : 0;
    const reasons: string[] = [];
    if (failedValidation) reasons.push("At least one validation/replay observation failed.");
    if (independentSuccessCount < requiredIndependentSuccesses) {
      reasons.push(`Need ${requiredIndependentSuccesses} independent successful validation/replay contexts; found ${independentSuccessCount}.`);
    }
    for (const dependency of version.definition.capability.requiredCapabilities) {
      if (!registry.isExecutionReady(dependency)) reasons.push(`Required capability is not execution-ready: ${dependency}`);
    }
    return { eligible: reasons.length === 0, requiredIndependentSuccesses, successfulEvidenceIds, reasons };
  }

  validateVersion''',
)

# 6. Deprecating history cannot retire/disable a different runtime version.
replace_regex(
    "src/skills/evolution.ts",
    r'''  deprecateVersion\(versionId: string, evidenceEventId: string, reason: string, registry: CapabilityRegistry\): SkillVersionRecord \{.*?\n  \}\n\n  rollback\(''',
    r'''  deprecateVersion(versionId: string, evidenceEventId: string, reason: string, registry: CapabilityRegistry): SkillVersionRecord {
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

  rollback(''',
)

# 7. Prompt/restart reconciliation distinguishes compatibility baseline from verified promoted versions.
replace_regex(
    "src/skills/evolution.ts",
    r'''  isPromptEligible\(skillName: string, registry: CapabilityRegistry\): boolean \{.*?\n  \}\n\n  reconcileCapabilityRegistry\(registry: CapabilityRegistry\): void \{.*?\n  \}\n\n  private activateProjection''',
    r'''  isPromptEligible(skillName: string, registry: CapabilityRegistry): boolean {
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

  private activateProjection''',
)

# 8. Loader imports baselines before refresh and observes managed file changes as candidates.
loader = Path("src/skills/loader.ts")
text = loader.read_text()
text = text.replace('import { isSkillEvolutionManaged } from "./evolution.js";', 'import { SkillEvolutionEngine } from "./evolution.js";')
start = text.index("export function loadSkills(")
end = text.index("\n/**\n * Validate binary name", start)
new_load = r'''export function loadSkills(
  skillsDir: string,
  db: AbosDatabase,
): Skill[] {
  const resolvedDir = resolveHome(skillsDir);
  const evolution = db.raw ? new SkillEvolutionEngine(db.raw) : null;

  // Capture the pre-existing runtime projection before any filesystem refresh can
  // replace it. This makes the legacy starting point rollbackable without
  // upgrading it to verified capability evidence.
  evolution?.bootstrapLegacySkills();

  if (fs.existsSync(resolvedDir)) {
    const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(resolvedDir, entry.name, "SKILL.md");
      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const content = fs.readFileSync(skillMdPath, "utf-8");
        const skill = parseSkillMd(content, skillMdPath);
        if (!skill) continue;

        const existing = db.getSkillByName(skill.name);
        if (existing) {
          skill.enabled = existing.enabled;
          skill.installedAt = existing.installedAt;
        }

        if (evolution?.isManaged(skill.name)) {
          // A managed file change is evidence for a candidate, never permission
          // to overwrite the currently active runtime projection.
          evolution.observeFilesystemSkill(skill);
          continue;
        }

        // Legacy/new unmanaged skills keep the existing runtime requirement gate.
        if (!checkSkillRequirements(skill)) continue;
        db.upsertSkill(skill);
      } catch {
        // Skip invalid/untrusted skill files. The active projection is preserved.
      }
    }
  }

  // Newly discovered unmanaged skills acquire their durable v1 baseline in the
  // same load after they have passed the legacy runtime requirement gate.
  evolution?.bootstrapLegacySkills();

  return db.getSkills(true).filter((skill) => checkSkillRequirements(skill));
}
'''
loader.write_text(text[:start] + new_load + text[end:])

# 9. Registry validates untrusted names before consulting lifecycle storage.
registry = Path("src/skills/registry.ts")
text = registry.read_text()
pattern = re.compile(r'''  if \(isSkillEvolutionManaged\(db\.raw, name\)\) \{\n    throw new Error\(`Skill \$\{name\} is managed by Skill Evolution; ([^`]+)`\);\n  \}\n  (// Validate[^\n]*\n  if \(!SKILL_NAME_RE\.test\(name\)\) \{\n    throw new Error\(`Invalid skill name: \\"\$\{name\}\\"\. Must match \$\{SKILL_NAME_RE\.source\}`\);\n  \}\n)''')

def reorder(m):
    return m.group(2) + f'''  if (isSkillEvolutionManaged(db.raw, name)) {{\n    throw new Error(`Skill ${{name}} is managed by Skill Evolution; {m.group(1)}`);\n  }}\n'''
text, count = pattern.subn(reorder, text)
if count != 4:
    raise SystemExit(f"src/skills/registry.ts: expected 4 lifecycle/name-order matches, found {count}")
registry.write_text(text)

# 10. Runtime startup imports any legacy DB projections before Capability Fabric ingestion.
replace_once(
    "src/agent/loop.ts",
    "  const skillEvolution = new SkillEvolutionEngine(db.raw);\n\n  // Unified capability/environment view.",
    "  const skillEvolution = new SkillEvolutionEngine(db.raw);\n  skillEvolution.bootstrapLegacySkills();\n\n  // Unified capability/environment view.",
)

# 11. Focused tests make the adversarial contracts executable.
tests = Path("src/__tests__/skills-evolution.test.ts")
text = tests.read_text()
text = text.replace(
    'function success(engine: SkillEvolutionEngine, versionId: string, evidenceEventId: string, kind = "replay") {\n  return engine.recordEvaluation({ versionId, evaluationKind: kind, outcome: "success", evidenceEventId });\n}',
    'function success(engine: SkillEvolutionEngine, versionId: string, evidenceEventId: string, kind = "replay", taskId?: string, environmentId?: string) {\n  return engine.recordEvaluation({ versionId, evaluationKind: kind, outcome: "success", evidenceEventId, taskId, environmentId });\n}',
)
text = text.replace(
    '    success(engine, version.id, evidence(db, "success-1")); expect(() => engine.validateVersion(version.id, registry)).toThrow(/Need 2 independent/i);\n    success(engine, version.id, evidence(db, "success-2")); expect(engine.validateVersion(version.id, registry).lifecycleState).toBe("validated"); db.close();',
    '    success(engine, version.id, evidence(db, "success-1"), "replay", "incident-a"); expect(() => engine.validateVersion(version.id, registry)).toThrow(/Need 2 independent/i);\n    success(engine, version.id, evidence(db, "success-2"), "replay", "incident-b"); expect(engine.validateVersion(version.id, registry).lifecycleState).toBe("validated"); db.close();',
)
text = text.replace(
    '    loadSkills(skillsDir, db); expect(db.getSkillByName("incident-helper")?.instructions).toContain("Inspect evidence"); expect(db.getSkillByName("incident-helper")?.instructions).not.toContain("STALE FILE"); db.close();',
    '    loadSkills(skillsDir, db); loadSkills(skillsDir, db); expect(db.getSkillByName("incident-helper")?.instructions).toContain("Inspect evidence"); expect(db.getSkillByName("incident-helper")?.instructions).not.toContain("STALE FILE"); const versions = engine.listVersions("incident-helper"); expect(versions).toHaveLength(2); expect(versions[0].lifecycleState).toBe("candidate"); expect(versions[0].definition.instructions).toContain("STALE FILE INSTRUCTIONS"); db.close();',
)
extra = r'''
  it("imports an existing runtime skill exactly once without fabricating capability readiness", () => {
    const { db, engine, registry } = runtime();
    db.upsertSkill({ name: "legacy-helper", description: "legacy", autoActivate: true, instructions: "Legacy instructions", source: "self", path: "legacy://helper", enabled: true, installedAt: new Date().toISOString() });
    expect(engine.bootstrapLegacySkills()).toBe(1); expect(engine.bootstrapLegacySkills()).toBe(0);
    registry.ingestSkills(db.getSkills(), (name) => engine.getCapabilityProjection(name)); engine.reconcileCapabilityRegistry(registry);
    const versions = engine.listVersions("legacy-helper"); expect(versions).toHaveLength(1); expect(versions[0].lifecycleState).toBe("active"); expect(versions[0].provenance.legacyBaseline).toBe(true);
    expect(registry.isExecutionReady("skill:legacy-helper")).toBe(false); expect(engine.isPromptEligible("legacy-helper", registry)).toBe(true); db.close();
  });

  it("requires distinct task or environment context when multiple independent successes are required", () => {
    const { db, engine, registry } = runtime(); const version = candidate(engine, evidence(db, "seed-independent"), { verification: { method: "independent replay", critical: true, minimumIndependentSuccesses: 2 } });
    success(engine, version.id, evidence(db, "same-context-1"), "replay", "incident-a"); success(engine, version.id, evidence(db, "same-context-2"), "replay", "incident-a");
    expect(() => engine.validateVersion(version.id, registry)).toThrow(/found 1/i);
    success(engine, version.id, evidence(db, "distinct-context"), "replay", "incident-b"); expect(engine.validateVersion(version.id, registry).lifecycleState).toBe("validated"); db.close();
  });

  it("rejects unsupported evaluation outcome strings before persistence", () => {
    const { db, engine } = runtime(); const version = candidate(engine, evidence(db, "seed-outcome")); const proof = evidence(db, "bad-outcome");
    expect(() => engine.recordEvaluation({ versionId: version.id, evaluationKind: "replay", outcome: "succes", evidenceEventId: proof })).toThrow(/Unsupported evaluation outcome/i);
    expect(engine.listEvaluations(version.id)).toHaveLength(0); db.close();
  });

  it("deprecating superseded history does not disable or retire the active version", () => {
    const { db, engine, registry } = runtime(); const v1 = candidate(engine, evidence(db, "dep-seed-1")); success(engine, v1.id, evidence(db, "dep-v1-ok")); engine.validateVersion(v1.id, registry); engine.activateVersion(v1.id, registry);
    const v2 = candidate(engine, evidence(db, "dep-seed-2"), { parentVersionId: v1.id, definition: { ...v1.definition, instructions: "Version two stays active." } }); success(engine, v2.id, evidence(db, "dep-v2-ok")); engine.validateVersion(v2.id, registry); engine.activateVersion(v2.id, registry);
    engine.deprecateVersion(v1.id, evidence(db, "dep-old"), "retire old history", registry);
    expect(engine.getActiveVersion("incident-helper")?.id).toBe(v2.id); expect(db.getSkillByName("incident-helper")?.enabled).toBe(true); expect(registry.isExecutionReady("skill:incident-helper")).toBe(true); db.close();
  });
'''
marker = '\n  it("rejects secret-like material before persistence", () => {'
if marker not in text:
    raise SystemExit("skills-evolution.test.ts: final insertion marker missing")
text = text.replace(marker, extra + marker, 1)
tests.write_text(text)

print("P-021 adversarial hardening applied")
