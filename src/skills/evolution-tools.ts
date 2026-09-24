import type { AbosTool, SkillSource, ToolContext } from "../types.js";
import { SkillEvolutionEngine } from "./evolution.js";

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function bool(value: unknown, fallback = false): boolean { return typeof value === "boolean" ? value : fallback; }
function source(value: unknown): SkillSource {
  return ["builtin", "git", "url", "self"].includes(String(value)) ? String(value) as SkillSource : "self";
}
function engineFor(ctx: ToolContext) { return new SkillEvolutionEngine(ctx.db.raw); }
function requireRegistry(ctx: ToolContext) {
  if (!ctx.capabilityRegistry) throw new Error("CapabilityRegistry is currently unavailable in this executor; lifecycle action is blocked, not impossible.");
  return ctx.capabilityRegistry;
}

export const SKILL_EVOLUTION_TOOL_NAMES = [
  "propose_skill_version", "record_skill_evaluation", "validate_skill_version", "activate_skill_version",
  "degrade_skill_version", "deprecate_skill_version", "rollback_skill_version", "list_skill_versions",
] as const;

export function createSkillEvolutionTools(): AbosTool[] {
  return [
    {
      name: "propose_skill_version", description: "Create an evidence-backed candidate version of a reusable skill. This does not activate or verify the skill.",
      category: "skills", riskLevel: "caution",
      parameters: { type: "object", properties: {
        name: { type: "string" }, description: { type: "string" }, instructions: { type: "string" }, source: { type: "string" }, path: { type: "string" }, autoActivate: { type: "boolean" },
        requiredBins: { type: "array", items: { type: "string" } }, requiredEnv: { type: "array", items: { type: "string" } }, requiredCapabilities: { type: "array", items: { type: "string" } },
        provides: { type: "array", items: { type: "string" } }, permissions: { type: "array", items: { type: "string" } }, effects: { type: "array", items: { type: "string" } },
        compatibility: { type: "array", items: { type: "string" } }, environment: { type: "string" }, inputs: { type: "array", items: { type: "string" } }, outputs: { type: "array", items: { type: "string" } },
        verificationMethod: { type: "string" }, critical: { type: "boolean" }, minimumIndependentSuccesses: { type: "number" }, applicability: { type: "object" }, provenance: { type: "object" },
        evidenceEventIds: { type: "array", items: { type: "string" } }, parentVersionId: { type: "string" },
      }, required: ["name", "instructions", "verificationMethod", "evidenceEventIds"] },
      execute: async (args, ctx) => {
        const name = String(args.name ?? "").trim();
        const result = engineFor(ctx).createCandidate({
          definition: { name, description: String(args.description ?? ""), autoActivate: bool(args.autoActivate, true),
            requires: { bins: strings(args.requiredBins), env: strings(args.requiredEnv) }, instructions: String(args.instructions ?? ""), source: source(args.source), path: String(args.path ?? `skill-evolution:${name}`),
            capability: { requiredCapabilities: strings(args.requiredCapabilities), provides: strings(args.provides), permissions: strings(args.permissions), effects: strings(args.effects), compatibility: strings(args.compatibility), environment: typeof args.environment === "string" ? args.environment : null, inputs: strings(args.inputs), outputs: strings(args.outputs) } },
          verification: { method: String(args.verificationMethod ?? ""), critical: bool(args.critical), minimumIndependentSuccesses: typeof args.minimumIndependentSuccesses === "number" ? args.minimumIndependentSuccesses : 1 },
          applicability: object(args.applicability), provenance: object(args.provenance), evidenceEventIds: strings(args.evidenceEventIds), parentVersionId: typeof args.parentVersionId === "string" && args.parentVersionId.trim() ? args.parentVersionId.trim() : null,
        });
        return JSON.stringify({ status: "candidate", skillName: result.skillName, version: result.version, versionId: result.id, contentHash: result.contentHash });
      },
    },
    {
      name: "record_skill_evaluation", description: "Record replay, validation, or usage outcome for a skill version using an existing Evidence Fabric event.", category: "skills", riskLevel: "caution",
      parameters: { type: "object", properties: { versionId: { type: "string" }, evaluationKind: { type: "string" }, outcome: { type: "string" }, evidenceEventId: { type: "string" }, taskId: { type: "string" }, environmentId: { type: "string" }, details: { type: "object" } }, required: ["versionId", "evaluationKind", "outcome", "evidenceEventId"] },
      execute: async (args, ctx) => JSON.stringify(engineFor(ctx).recordEvaluation({ versionId: String(args.versionId ?? ""), evaluationKind: String(args.evaluationKind ?? ""), outcome: String(args.outcome ?? ""), evidenceEventId: String(args.evidenceEventId ?? ""), taskId: typeof args.taskId === "string" ? args.taskId : null, environmentId: typeof args.environmentId === "string" ? args.environmentId : null, details: object(args.details) })),
    },
    {
      name: "validate_skill_version", description: "Mark a candidate validated only when declared replay/validation evidence and required capabilities satisfy its policy.", category: "skills", riskLevel: "caution",
      parameters: { type: "object", properties: { versionId: { type: "string" } }, required: ["versionId"] },
      execute: async (args, ctx) => { const result = engineFor(ctx).validateVersion(String(args.versionId ?? ""), requireRegistry(ctx)); return JSON.stringify({ status: result.lifecycleState, versionId: result.id }); },
    },
    {
      name: "activate_skill_version", description: "Activate a validated skill version and project it into runtime inventory. Capability Fabric remains readiness authority.", category: "skills", riskLevel: "dangerous",
      parameters: { type: "object", properties: { versionId: { type: "string" } }, required: ["versionId"] },
      execute: async (args, ctx) => { const result = engineFor(ctx).activateVersion(String(args.versionId ?? ""), requireRegistry(ctx)); return JSON.stringify({ status: result.lifecycleState, versionId: result.id }); },
    },
    {
      name: "degrade_skill_version", description: "Degrade an active skill from concrete evidence without deleting version history.", category: "skills", riskLevel: "dangerous",
      parameters: { type: "object", properties: { versionId: { type: "string" }, evidenceEventId: { type: "string" }, reason: { type: "string" } }, required: ["versionId", "evidenceEventId", "reason"] },
      execute: async (args, ctx) => { const result = engineFor(ctx).degradeVersion(String(args.versionId ?? ""), String(args.evidenceEventId ?? ""), String(args.reason ?? ""), requireRegistry(ctx)); return JSON.stringify({ status: result.lifecycleState, versionId: result.id }); },
    },
    {
      name: "deprecate_skill_version", description: "Deprecate a skill version from evidence while retaining immutable history.", category: "skills", riskLevel: "dangerous",
      parameters: { type: "object", properties: { versionId: { type: "string" }, evidenceEventId: { type: "string" }, reason: { type: "string" } }, required: ["versionId", "evidenceEventId", "reason"] },
      execute: async (args, ctx) => { const result = engineFor(ctx).deprecateVersion(String(args.versionId ?? ""), String(args.evidenceEventId ?? ""), String(args.reason ?? ""), requireRegistry(ctx)); return JSON.stringify({ status: result.lifecycleState, versionId: result.id }); },
    },
    {
      name: "rollback_skill_version", description: "Rollback to a previously activated superseded version when dependencies remain execution-ready.", category: "skills", riskLevel: "dangerous",
      parameters: { type: "object", properties: { skillName: { type: "string" }, targetVersionId: { type: "string" }, evidenceEventId: { type: "string" } }, required: ["skillName", "targetVersionId", "evidenceEventId"] },
      execute: async (args, ctx) => { const result = engineFor(ctx).rollback(String(args.skillName ?? ""), String(args.targetVersionId ?? ""), String(args.evidenceEventId ?? ""), requireRegistry(ctx)); return JSON.stringify({ status: result.lifecycleState, versionId: result.id, version: result.version }); },
    },
    {
      name: "list_skill_versions", description: "Inspect durable version/evaluation history without changing lifecycle state.", category: "skills", riskLevel: "safe",
      parameters: { type: "object", properties: { skillName: { type: "string" } }, required: ["skillName"] },
      execute: async (args, ctx) => { const engine = engineFor(ctx); const skillName = String(args.skillName ?? ""); return JSON.stringify({ skillName, versions: engine.listVersions(skillName).map((version) => ({ id: version.id, version: version.version, lifecycleState: version.lifecycleState, contentHash: version.contentHash, activatedAt: version.activatedAt, deprecatedAt: version.deprecatedAt, evaluations: engine.listEvaluations(version.id).map((evaluation) => ({ id: evaluation.id, kind: evaluation.evaluationKind, outcome: evaluation.outcome, evidenceEventId: evaluation.evidenceEventId, createdAt: evaluation.createdAt })) })) }); },
    },
  ];
}
