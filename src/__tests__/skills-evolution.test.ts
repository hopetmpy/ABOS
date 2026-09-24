import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../state/database.js";
import { appendEvidenceEvent } from "../observability/evidence.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { CapabilityStore, capabilityDefinitionFingerprint } from "../capabilities/store.js";
import { SkillEvolutionEngine } from "../skills/evolution.js";
import { loadSkills } from "../skills/loader.js";

const tempDirs: string[] = [];
afterEach(() => { while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true }); });

function runtime() {
  const dir = mkdtempSync(join(tmpdir(), "abos-skill-evolution-")); tempDirs.push(dir);
  const db = createDatabase(join(dir, "state.db"));
  const registry = new CapabilityRegistry(new CapabilityStore(db.raw));
  const engine = new SkillEvolutionEngine(db.raw);
  return { dir, db, registry, engine };
}
function evidence(db: ReturnType<typeof createDatabase>, label: string) {
  return appendEvidenceEvent(db.raw, { correlationId: `test:${label}`, eventType: "test.observation", domain: "test", authorityType: "test_observation", authorityId: label, epistemicStatus: "observation", payload: { label }, provenance: { source: "skills-evolution.test" } }).id;
}
function candidate(engine: SkillEvolutionEngine, seedEvidence: string, overrides: Partial<Parameters<SkillEvolutionEngine["createCandidate"]>[0]> = {}) {
  return engine.createCandidate({
    definition: { name: "incident-helper", description: "Handle a repeatable incident workflow", autoActivate: true, requires: {}, instructions: "Inspect evidence, run the declared diagnostic capability, and report the observed result.", source: "self", path: "skill-evolution:incident-helper", capability: { requiredCapabilities: [], provides: ["incident-helper"], permissions: [], effects: [], compatibility: [], environment: null, inputs: ["incident"], outputs: ["diagnosis"] } },
    verification: { method: "replay against independent incidents", critical: false, minimumIndependentSuccesses: 1 },
    evidenceEventIds: [seedEvidence], ...overrides,
  });
}
function success(engine: SkillEvolutionEngine, versionId: string, evidenceEventId: string, kind = "replay", taskId?: string, environmentId?: string) {
  return engine.recordEvaluation({ versionId, evaluationKind: kind, outcome: "success", evidenceEventId, taskId, environmentId });
}

describe("P-021 skill evolution", () => {
  it("creates durable ordered versions without projecting candidates active", () => {
    const { db, engine } = runtime(); const v1 = candidate(engine, evidence(db, "seed-1")); const v2 = candidate(engine, evidence(db, "seed-2"), { parentVersionId: v1.id });
    expect(v1.version).toBe(1); expect(v2.version).toBe(2); expect(engine.listVersions("incident-helper").map((v) => v.version)).toEqual([2, 1]); expect(db.getSkillByName("incident-helper")).toBeUndefined(); db.close();
  });
  it("rejects invented evaluation evidence", () => {
    const { db, engine } = runtime(); const version = candidate(engine, evidence(db, "seed"));
    expect(() => engine.recordEvaluation({ versionId: version.id, evaluationKind: "replay", outcome: "success", evidenceEventId: "does-not-exist" })).toThrow(/does not exist/i); db.close();
  });
  it("does not promote a critical skill from one isolated success", () => {
    const { db, engine, registry } = runtime(); const version = candidate(engine, evidence(db, "seed"), { verification: { method: "independent critical replay", critical: true, minimumIndependentSuccesses: 1 } });
    success(engine, version.id, evidence(db, "success-1"), "replay", "incident-a"); expect(() => engine.validateVersion(version.id, registry)).toThrow(/Need 2 independent/i);
    success(engine, version.id, evidence(db, "success-2"), "replay", "incident-b"); expect(engine.validateVersion(version.id, registry).lifecycleState).toBe("validated"); db.close();
  });
  it("blocks validation while a declared capability dependency is not execution-ready", () => {
    const { db, engine, registry } = runtime(); registry.register({ id: "tool:diagnostic", type: "tool", provider: "abos", description: "diagnostic", requirements: [], provides: ["diagnostic"], permissions: [], available: false, state: "unknown" });
    const version = candidate(engine, evidence(db, "seed"), { definition: { name: "incident-helper", description: "needs diagnostic", autoActivate: true, requires: {}, instructions: "Use diagnostic.", source: "self", path: "skill-evolution:incident-helper", capability: { requiredCapabilities: ["tool:diagnostic"], provides: ["incident-helper"], permissions: [], effects: [], compatibility: [], environment: null, inputs: [], outputs: [] } } });
    success(engine, version.id, evidence(db, "success")); expect(() => engine.validateVersion(version.id, registry)).toThrow(/not execution-ready/i); db.close();
  });
  it("activates only after validation and verifies the projected capability", () => {
    const { db, engine, registry } = runtime(); const version = candidate(engine, evidence(db, "seed")); success(engine, version.id, evidence(db, "success")); engine.validateVersion(version.id, registry); const active = engine.activateVersion(version.id, registry);
    expect(active.lifecycleState).toBe("active"); expect(db.getSkillByName("incident-helper")?.instructions).toContain("Inspect evidence"); expect(registry.isExecutionReady("skill:incident-helper")).toBe(true); expect(registry.get("skill:incident-helper")?.version).toBe("1"); expect(engine.isPromptEligible("incident-helper", registry)).toBe(true); db.close();
  });
  it("a changed version definition gets a different capability fingerprint and loses stale readiness", () => {
    const { db, engine, registry } = runtime(); const v1 = candidate(engine, evidence(db, "seed-1")); success(engine, v1.id, evidence(db, "success-1")); engine.validateVersion(v1.id, registry); engine.activateVersion(v1.id, registry);
    const before = registry.get("skill:incident-helper")!; const beforeFingerprint = capabilityDefinitionFingerprint(before); expect(registry.isExecutionReady(before.id)).toBe(true);
    const v2 = candidate(engine, evidence(db, "seed-2"), { parentVersionId: v1.id, definition: { ...v1.definition, instructions: "A materially changed instruction set.", capability: { ...v1.definition.capability, outputs: ["diagnosis", "remediation-plan"] } } });
    registry.registerSkillInventory({ name: v2.skillName, description: v2.definition.description, enabled: true }, { version: String(v2.version), provides: v2.definition.capability.provides, dependencies: v2.definition.capability.requiredCapabilities, permissions: v2.definition.capability.permissions, effects: v2.definition.capability.effects, compatibility: v2.definition.capability.compatibility, environment: v2.definition.capability.environment, inputs: v2.definition.capability.inputs, outputs: v2.definition.capability.outputs });
    const after = registry.get("skill:incident-helper")!; expect(capabilityDefinitionFingerprint(after)).not.toBe(beforeFingerprint); expect(registry.isExecutionReady(after.id)).toBe(false); db.close();
  });
  it("degrades without erasing history and rolls back to a previously activated version", () => {
    const { db, engine, registry } = runtime(); const v1 = candidate(engine, evidence(db, "seed-1")); success(engine, v1.id, evidence(db, "v1-ok")); engine.validateVersion(v1.id, registry); engine.activateVersion(v1.id, registry);
    const v2 = candidate(engine, evidence(db, "seed-2"), { parentVersionId: v1.id, definition: { ...v1.definition, instructions: "Version two instructions." } }); success(engine, v2.id, evidence(db, "v2-ok")); engine.validateVersion(v2.id, registry); engine.activateVersion(v2.id, registry); expect(engine.getVersion(v1.id)?.lifecycleState).toBe("superseded");
    engine.degradeVersion(v2.id, evidence(db, "v2-failure"), "new environment broke the path", registry); expect(db.getSkillByName("incident-helper")?.enabled).toBe(false); expect(engine.listVersions("incident-helper")).toHaveLength(2);
    const rolled = engine.rollback("incident-helper", v1.id, evidence(db, "rollback-decision"), registry); expect(rolled.lifecycleState).toBe("active"); expect(db.getSkillByName("incident-helper")?.instructions).toContain("Inspect evidence"); expect(registry.isExecutionReady("skill:incident-helper")).toBe(true); db.close();
  });
  it("restores managed lifecycle and readiness after file-backed restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "abos-skill-restart-")); tempDirs.push(dir); const dbPath = join(dir, "state.db");
    const first = createDatabase(dbPath); const firstRegistry = new CapabilityRegistry(new CapabilityStore(first.raw)); const firstEngine = new SkillEvolutionEngine(first.raw); const v1 = candidate(firstEngine, evidence(first, "seed")); success(firstEngine, v1.id, evidence(first, "ok")); firstEngine.validateVersion(v1.id, firstRegistry); firstEngine.activateVersion(v1.id, firstRegistry); first.close();
    const second = createDatabase(dbPath); const secondRegistry = new CapabilityRegistry(new CapabilityStore(second.raw)); const secondEngine = new SkillEvolutionEngine(second.raw); secondRegistry.ingestSkills(second.getSkills(), (name) => secondEngine.getCapabilityProjection(name)); secondEngine.reconcileCapabilityRegistry(secondRegistry);
    expect(secondEngine.getActiveVersion("incident-helper")?.version).toBe(1); expect(secondRegistry.isExecutionReady("skill:incident-helper")).toBe(true); expect(secondEngine.isPromptEligible("incident-helper", secondRegistry)).toBe(true); second.close();
  });
  it("does not let stale SKILL.md overwrite managed projection", () => {
    const { dir, db, engine, registry } = runtime(); const v1 = candidate(engine, evidence(db, "seed")); success(engine, v1.id, evidence(db, "ok")); engine.validateVersion(v1.id, registry); engine.activateVersion(v1.id, registry);
    const skillsDir = join(dir, "skills"); const skillDir = join(skillsDir, "incident-helper"); mkdirSync(skillDir, { recursive: true }); writeFileSync(join(skillDir, "SKILL.md"), `---\nname: incident-helper\ndescription: stale\nauto-activate: true\n---\n\nSTALE FILE INSTRUCTIONS`);
    loadSkills(skillsDir, db); loadSkills(skillsDir, db); expect(db.getSkillByName("incident-helper")?.instructions).toContain("Inspect evidence"); expect(db.getSkillByName("incident-helper")?.instructions).not.toContain("STALE FILE"); const versions = engine.listVersions("incident-helper"); expect(versions).toHaveLength(2); expect(versions[0].lifecycleState).toBe("candidate"); expect(versions[0].definition.instructions).toContain("STALE FILE INSTRUCTIONS"); db.close();
  });
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

  it("rejects secret-like material before persistence", () => {
    const { db, engine } = runtime(); expect(() => candidate(engine, evidence(db, "seed"), { definition: { name: "incident-helper", description: "bad candidate", autoActivate: true, requires: {}, instructions: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456", source: "self", path: "skill-evolution:incident-helper", capability: { requiredCapabilities: [], provides: [], permissions: [], effects: [], compatibility: [], environment: null, inputs: [], outputs: [] } } })).toThrow(/secret-like material/i); expect(engine.listVersions("incident-helper")).toHaveLength(0); db.close();
  });
});
