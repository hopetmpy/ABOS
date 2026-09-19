from pathlib import Path
import os

ROOT = Path('.')

MODEL = '''export const CORE_CAPABILITY_TYPES = [
  "tool",
  "skill",
  "cli",
  "package",
  "sdk",
  "api",
  "service",
  "executor",
  "worker",
  "browser",
  "cloud_resource",
  "script",
  "custom",
] as const;

export type CoreCapabilityType = typeof CORE_CAPABILITY_TYPES[number];
/** Open by design: known core types are documentation, not a global allowlist. */
export type CapabilityType = CoreCapabilityType | (string & {});

/**
 * Canonical core lifecycle labels used by ABOS runtime-truth decisions.
 *
 * The state space is intentionally open: future providers may introduce a
 * more specific state without forcing the core to pretend the universe is
 * closed. Only `verified_available` is sufficient for an execution-ready
 * claim, and the registry additionally verifies dependency readiness.
 */
export const CORE_CAPABILITY_STATES = [
  "discovered_unverified",
  "acquired",
  "probed",
  "verified_available",
  "degraded",
  "unavailable",
  "unauthorized",
  "prohibited",
  "unknown",
  "retired",
] as const;

export type CoreCapabilityState = typeof CORE_CAPABILITY_STATES[number];
export type CapabilityState = CoreCapabilityState | (string & {});

export interface CapabilityDescriptor {
  id: string;
  type: CapabilityType;
  provider: string;
  description: string;
  /**
   * Legacy declared-provides aliases retained for compatibility with existing
   * providers. This field is not a dependency list.
   */
  requirements: string[];
  /** Explicit capabilities/outcomes this descriptor claims to provide. */
  provides?: string[];
  permissions: string[];
  /** Explicit externally observable effects relevant to execution contracts. */
  effects?: string[];
  /** Stable capability IDs that must themselves be execution-ready. */
  dependencies?: string[];
  /** Provider/definition version when meaningful. */
  version?: string | null;
  /** Version/ABI/protocol compatibility claims, deliberately open strings. */
  compatibility?: string[];
  environment?: string | null;
  /**
   * Backward-compatible projection only. CapabilityRegistry derives this from
   * `state`; callers must not treat a producer-written boolean as authority.
   */
  available: boolean;
  /** Evidence-backed lifecycle state. Missing legacy state is conservative. */
  state?: CapabilityState;
  /** Time at which the runtime evidence supporting this descriptor was observed. */
  observedAt?: string | null;
  /** Authority/source that produced the runtime claim when known. */
  authority?: string | null;
  inputs?: string[];
  outputs?: string[];
  estimatedCostCents?: number | null;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Legacy `available: true` means only that an older producer advertised the
 * capability. It does not prove current runtime availability.
 */
export function capabilityStateOf(
  capability: Pick<CapabilityDescriptor, "state" | "available">,
): CapabilityState {
  if (typeof capability.state === "string" && capability.state.trim()) {
    return capability.state.trim();
  }
  return capability.available ? "discovered_unverified" : "unknown";
}

export function isCapabilityVerifiedAvailable(
  capability: Pick<CapabilityDescriptor, "state" | "available">,
): boolean {
  return capabilityStateOf(capability) === "verified_available";
}

function normalizedContractToken(value: string): string {
  return value.toLowerCase().replace(/\\s+/g, " ").trim();
}

/**
 * Execution-contract match. Description/provider/id text is intentionally not
 * consulted: those surfaces remain discovery hints, not execution authority.
 */
export function capabilityProvides(
  capability: Pick<CapabilityDescriptor, "provides" | "requirements">,
  requirement: string,
): boolean {
  const needle = normalizedContractToken(requirement);
  if (!needle) return false;
  return [
    ...(capability.provides ?? []),
    ...capability.requirements,
  ].some((claim) => normalizedContractToken(claim) === needle);
}

export interface CapabilityRequest {
  requirement: string;
  preferredEnvironment?: string | null;
  requiredPermissions?: string[];
  requiredInputs?: string[];
  requiredOutputs?: string[];
  requiredEffects?: string[];
  requiredCompatibility?: string[];
  maxCostCents?: number | null;
}

export type CapabilityResolutionKind =
  | "use_existing"
  | "change_environment"
  | "probe"
  | "blocked"
  | "acquire"
  | "compose"
  | "construct"
  | "unknown";

export interface CapabilityResolution {
  kind: CapabilityResolutionKind;
  requirement: string;
  candidates: CapabilityDescriptor[];
  missingRequirements: string[];
  rationale: string;
  nextActions: string[];
}
'''

RESOLVER = '''import type {
  CapabilityDescriptor,
  CapabilityRequest,
  CapabilityResolution,
} from "./model.js";
import {
  capabilityProvides,
  capabilityStateOf,
} from "./model.js";
import type { CapabilityRegistry } from "./registry.js";
import type { EnvironmentSnapshot } from "../environments/types.js";

function normalized(value: string): string {
  return value.toLowerCase().replace(/\\s+/g, " ").trim();
}

/** Discovery-only textual matching. Never sufficient for `use_existing`. */
function discoverySupports(capability: CapabilityDescriptor, requirement: string): boolean {
  const needle = normalized(requirement);
  if (!needle) return false;
  const haystack = normalized([
    capability.id,
    capability.type,
    capability.provider,
    capability.description,
    ...capability.requirements,
    ...(capability.provides ?? []),
    ...(capability.inputs ?? []),
    ...(capability.outputs ?? []),
    ...(capability.effects ?? []),
    ...(capability.compatibility ?? []),
  ].join(" "));
  return haystack.includes(needle);
}

function normalizedSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map(normalized).filter(Boolean));
}

function includesAll(
  actual: readonly string[] | undefined,
  required: readonly string[] | undefined,
): boolean {
  const requiredValues = (required ?? []).map(normalized).filter(Boolean);
  if (requiredValues.length === 0) return true;
  const actualValues = normalizedSet(actual);
  return requiredValues.every((entry) => actualValues.has(entry));
}

function compatibilityClaims(capability: CapabilityDescriptor): string[] {
  return [
    ...(capability.compatibility ?? []),
    ...(capability.version ? [capability.version] : []),
  ];
}

function missingContractRequirements(
  capability: CapabilityDescriptor,
  request: CapabilityRequest,
  registry: CapabilityRegistry,
): string[] {
  const missing: string[] = [];

  if (!capabilityProvides(capability, request.requirement)) {
    missing.push(`provides:${request.requirement}`);
  }

  const constraints: Array<[string, string[] | undefined, string[] | undefined]> = [
    ["permission", capability.permissions, request.requiredPermissions],
    ["input", capability.inputs, request.requiredInputs],
    ["output", capability.outputs, request.requiredOutputs],
    ["effect", capability.effects, request.requiredEffects],
    ["compatibility", compatibilityClaims(capability), request.requiredCompatibility],
  ];
  for (const [label, actual, required] of constraints) {
    const actualValues = normalizedSet(actual);
    for (const entry of required ?? []) {
      if (entry.trim() && !actualValues.has(normalized(entry))) {
        missing.push(`${label}:${entry}`);
      }
    }
  }

  for (const dependency of capability.dependencies ?? []) {
    if (!registry.isExecutionReady(dependency)) {
      missing.push(`dependency:${dependency}:not_ready`);
    }
  }

  if (request.maxCostCents != null) {
    if (
      typeof capability.estimatedCostCents !== "number" ||
      !Number.isFinite(capability.estimatedCostCents)
    ) {
      missing.push("cost:known");
    } else if (capability.estimatedCostCents > request.maxCostCents) {
      missing.push(`cost<=${request.maxCostCents}`);
    }
  }

  return [...new Set(missing)];
}

function satisfiesExecutionContract(
  capability: CapabilityDescriptor,
  request: CapabilityRequest,
  registry: CapabilityRegistry,
): boolean {
  return registry.isExecutionReady(capability.id) &&
    missingContractRequirements(capability, request, registry).length === 0;
}

function statesOf(capabilities: CapabilityDescriptor[]): string[] {
  return [...new Set(capabilities.map((capability) => capabilityStateOf(capability)))];
}

export class CapabilityResolver {
  constructor(private readonly registry: CapabilityRegistry) {}

  resolve(
    request: CapabilityRequest,
    environments: EnvironmentSnapshot[] = [],
  ): CapabilityResolution {
    const all = this.registry.list();

    const usable = all.filter((capability) =>
      satisfiesExecutionContract(capability, request, this.registry)
    );

    const preferred = request.preferredEnvironment
      ? usable.filter((capability) =>
          capability.environment === request.preferredEnvironment
        )
      : usable;

    if (preferred.length > 0) {
      return {
        kind: "use_existing",
        requirement: request.requirement,
        candidates: preferred,
        missingRequirements: [],
        rationale: request.preferredEnvironment
          ? `A VERIFIED_AVAILABLE capability satisfies the explicit execution contract in preferred environment "${request.preferredEnvironment}".`
          : "A VERIFIED_AVAILABLE registered capability satisfies the explicit execution contract.",
        nextActions: [
          "Select among contract-valid candidates using current observations without weakening the requested constraints.",
        ],
      };
    }

    if (usable.length > 0) {
      const environmentsWithSupport = [...new Set(
        usable.map((capability) => capability.environment).filter(Boolean),
      )] as string[];

      return {
        kind: "change_environment",
        requirement: request.requirement,
        candidates: usable,
        missingRequirements: [],
        rationale:
          "A verified contract-valid capability exists, but not in the preferred/current environment.",
        nextActions: environmentsWithSupport.map(
          (environment) => `Evaluate environment "${environment}" through the canonical environment authority.`,
        ),
      };
    }

    const known = all.filter((capability) =>
      discoverySupports(capability, request.requirement)
    );
    if (known.length > 0) {
      const prohibited = known.filter((capability) =>
        capabilityStateOf(capability) === "prohibited"
      );
      const unauthorized = known.filter((capability) =>
        capabilityStateOf(capability) === "unauthorized"
      );
      const probeable = known.filter((capability) =>
        [
          "discovered_unverified",
          "acquired",
          "probed",
          "unknown",
        ].includes(capabilityStateOf(capability))
      );

      if (prohibited.length === known.length) {
        return {
          kind: "blocked",
          requirement: request.requirement,
          candidates: prohibited,
          missingRequirements: [request.requirement],
          rationale:
            "Known discovery candidates for this route are explicitly PROHIBITED. That blocks this route, not necessarily the objective.",
          nextActions: [
            "Do not execute the prohibited route.",
            "Evaluate a materially different legitimate provider, capability, or strategy.",
          ],
        };
      }

      if (unauthorized.length > 0 && unauthorized.length + prohibited.length === known.length) {
        return {
          kind: "blocked",
          requirement: request.requirement,
          candidates: known,
          missingRequirements: [request.requirement],
          rationale:
            "Known candidates are currently UNAUTHORIZED or PROHIBITED; neither state is runtime availability.",
          nextActions: [
            "Obtain legitimate authorization where permitted, or select another provider/path.",
            "Do not collapse authorization absence into impossibility.",
          ],
        };
      }

      if (probeable.length > 0) {
        return {
          kind: "probe",
          requirement: request.requirement,
          candidates: known,
          missingRequirements: [request.requirement],
          rationale:
            `ABOS knows discovery candidates, but none currently proves the requested execution contract. States: ${statesOf(known).join(", ")}.`,
          nextActions: [
            "Probe the most relevant candidate through its authoritative runtime/provider boundary.",
            "Promote to VERIFIED_AVAILABLE only after current authority, evidence, time, and contract claims are explicit.",
          ],
        };
      }

      const verifiedButInsufficient = known.filter((capability) =>
        this.registry.isExecutionReady(capability.id) &&
        missingContractRequirements(capability, request, this.registry).length > 0
      );
      if (verifiedButInsufficient.length > 0) {
        const missing = verifiedButInsufficient.flatMap((capability) =>
          missingContractRequirements(capability, request, this.registry)
        );
        return {
          kind: "unknown",
          requirement: request.requirement,
          candidates: known,
          missingRequirements: [...new Set(missing)],
          rationale:
            "A candidate is runtime-verified, but its declared contract does not prove the requested permissions, I/O, effects, compatibility, dependencies, or budget ceiling. Lexical similarity cannot authorize execution.",
          nextActions: [
            "Discover or probe a capability whose explicit contract satisfies the unresolved constraints.",
            "Do not weaken the request or infer missing contract claims from descriptions.",
          ],
        };
      }

      return {
        kind: "acquire",
        requirement: request.requirement,
        candidates: known,
        missingRequirements: [request.requirement],
        rationale:
          `Known capabilities are not currently usable. States: ${statesOf(known).join(", ")}.`,
        nextActions: [
          "Determine whether the missing condition is availability, degradation, installation, configuration, authorization, or retirement.",
          "Hand acquisition/construction work to the P-017 capability-gap pipeline rather than claiming success early.",
        ],
      };
    }

    const words = normalized(request.requirement)
      .split(/[^a-z0-9]+/u)
      .filter((word) => word.length >= 3);
    const partial = all.filter((capability) => {
      const text = normalized([
        capability.id,
        capability.description,
        ...capability.requirements,
        ...(capability.provides ?? []),
      ].join(" "));
      return words.some((word) => text.includes(word));
    });

    if (partial.length >= 2) {
      return {
        kind: "compose",
        requirement: request.requirement,
        candidates: partial,
        missingRequirements: [request.requirement],
        rationale:
          "No single registered capability proves the requested execution contract, but multiple discovery candidates may be composable. This is a planning hint, not executable composition evidence.",
        nextActions: [
          "Hand the candidate set to P-017 for an explicit composition plan with compatible contracts.",
          "Probe every material dependency before presenting any composition as executable.",
        ],
      };
    }

    const environmentHints = environments
      .filter((environment) => environment.availability !== "unavailable")
      .flatMap((environment) =>
        environment.capabilities.filter((capability) =>
          discoverySupports(capability, request.requirement)
        )
      );

    if (environmentHints.length > 0) {
      return {
        kind: "probe",
        requirement: request.requirement,
        candidates: environmentHints,
        missingRequirements: [request.requirement],
        rationale:
          "An inspected environment advertises a discovery match, but the generic registry does not yet prove the requested execution contract for the current path.",
        nextActions: [
          "Project the authoritative environment observation into capability state.",
          "Re-evaluate the explicit contract after current evidence is registered.",
        ],
      };
    }

    return {
      kind: "construct",
      requirement: request.requirement,
      candidates: [],
      missingRequirements: [request.requirement],
      rationale:
        "No known registered capability currently proves the requirement. This is UNKNOWN, not evidence of impossibility.",
      nextActions: [
        "Hand the capability gap to P-017 for research of existing tools, services, SDKs, APIs, or skills.",
        "If no suitable capability exists, P-017 may construct and validate one through the canonical self-modification authority.",
      ],
    };
  }
}
'''

TOOLS = '''import type { AbosTool } from "../types.js";
import type { CapabilityRegistry } from "./registry.js";
import { CapabilityResolver } from "./resolver.js";
import type { EnvironmentRegistry } from "../environments/registry.js";
import { capabilityStateOf } from "./model.js";

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = [...new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )];
  return result.length > 0 ? result : undefined;
}

export function createCapabilityTools(
  registry: CapabilityRegistry,
  environments: EnvironmentRegistry,
): AbosTool[] {
  return [
    {
      name: "resolve_capability",
      description:
        "Resolve a required capability across registered tools, skills, services, and execution environments using current evidence and explicit contracts. " +
        "Returns whether to use existing capability, change environment, probe, wait for authorization, acquire, compose, or construct.",
      category: "capability",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          requirement: {
            type: "string",
            description: "Explicit capability/outcome contract required, e.g. terraform, object storage, serverless.",
          },
          preferredEnvironment: {
            type: "string",
            description: "Optional preferred environment ID.",
          },
          maxCostCents: {
            type: "number",
            description: "Optional maximum estimated capability cost. Unknown cost cannot prove this ceiling.",
          },
          requiredPermissions: {
            type: "array",
            items: { type: "string" },
            description: "Permissions the capability contract must explicitly declare.",
          },
          requiredInputs: {
            type: "array",
            items: { type: "string" },
            description: "Inputs the capability contract must explicitly accept.",
          },
          requiredOutputs: {
            type: "array",
            items: { type: "string" },
            description: "Outputs the capability contract must explicitly produce.",
          },
          requiredEffects: {
            type: "array",
            items: { type: "string" },
            description: "Effects the capability contract must explicitly declare.",
          },
          requiredCompatibility: {
            type: "array",
            items: { type: "string" },
            description: "Version, ABI, protocol, or compatibility claims required by the path.",
          },
        },
        required: ["requirement"],
      },
      execute: async (args) => {
        const requirement = String(args.requirement ?? "").trim();
        if (!requirement) return "UNKNOWN: capability requirement is empty.";

        const snapshots = await environments.inspectAll();
        for (const snapshot of snapshots) {
          registry.registerEnvironmentSnapshot(snapshot);
        }

        const resolution = new CapabilityResolver(registry).resolve(
          {
            requirement,
            preferredEnvironment:
              typeof args.preferredEnvironment === "string"
                ? args.preferredEnvironment
                : null,
            maxCostCents:
              typeof args.maxCostCents === "number" && Number.isFinite(args.maxCostCents)
                ? args.maxCostCents
                : null,
            requiredPermissions: stringArray(args.requiredPermissions),
            requiredInputs: stringArray(args.requiredInputs),
            requiredOutputs: stringArray(args.requiredOutputs),
            requiredEffects: stringArray(args.requiredEffects),
            requiredCompatibility: stringArray(args.requiredCompatibility),
          },
          snapshots,
        );

        return JSON.stringify({
          ...resolution,
          candidates: resolution.candidates.map((candidate) => ({
            id: candidate.id,
            type: candidate.type,
            provider: candidate.provider,
            environment: candidate.environment,
            state: capabilityStateOf(candidate),
            available: candidate.available,
            observedAt: candidate.observedAt ?? null,
            authority: candidate.authority ?? null,
            evidence: candidate.evidence ?? [],
            description: candidate.description,
            provides: candidate.provides ?? candidate.requirements,
            permissions: candidate.permissions,
            inputs: candidate.inputs ?? [],
            outputs: candidate.outputs ?? [],
            effects: candidate.effects ?? [],
            dependencies: candidate.dependencies ?? [],
            version: candidate.version ?? null,
            compatibility: candidate.compatibility ?? [],
            estimatedCostCents: candidate.estimatedCostCents ?? null,
          })),
        });
      },
    },
    {
      name: "inspect_environments",
      description:
        "Inspect registered execution environments and report current evidence-backed availability, constraints, and capability states.",
      category: "environment",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        const snapshots = await environments.inspectAll();
        for (const snapshot of snapshots) {
          registry.registerEnvironmentSnapshot(snapshot);
        }
        return JSON.stringify(
          snapshots.map((snapshot) => ({
            id: snapshot.id,
            label: snapshot.label,
            availability: snapshot.availability,
            observedAt: snapshot.observedAt,
            constraints: snapshot.constraints,
            evidence: snapshot.evidence,
            capabilities: snapshot.capabilities.map((capability) => {
              const projected = registry.get(capability.id);
              return {
                id: capability.id,
                description: capability.description,
                state: projected ? capabilityStateOf(projected) : "unknown",
                available: projected?.available ?? false,
                authority: projected?.authority ?? null,
                evidence: projected?.evidence ?? snapshot.evidence,
              };
            }),
          })),
        );
      },
    },
  ];
}
'''


def replace_once(path: str, old: str, new: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected exactly one replacement target, got {text.count(old)}")
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def insert_before_final_close(path: str, addition: str) -> None:
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    marker = "\n});\n"
    pos = text.rfind(marker)
    if pos < 0:
        raise SystemExit(f"{path}: final describe close not found")
    p.write_text(text[:pos] + addition + text[pos:], encoding='utf-8')


def apply() -> None:
    (ROOT / 'src/capabilities/model.ts').write_text(MODEL, encoding='utf-8')
    (ROOT / 'src/capabilities/resolver.ts').write_text(RESOLVER, encoding='utf-8')
    (ROOT / 'src/capabilities/tools.ts').write_text(TOOLS, encoding='utf-8')

    replace_once(
        'src/capabilities/registry.ts',
        '''  const hasEvidence = (capability.evidence ?? []).some((entry) => entry.trim().length > 0);\n  if (!hasEvidence || !hasValidObservation(capability.observedAt)) {\n    return "probed";\n  }\n''',
        '''  const hasEvidence = (capability.evidence ?? []).some((entry) => entry.trim().length > 0);\n  const hasAuthority = typeof capability.authority === "string" && capability.authority.trim().length > 0;\n  if (!hasEvidence || !hasAuthority || !hasValidObservation(capability.observedAt)) {\n    return "probed";\n  }\n''',
    )
    replace_once(
        'src/capabilities/registry.ts',
        '''    inputs: capability.inputs ? [...capability.inputs] : undefined,\n    outputs: capability.outputs ? [...capability.outputs] : undefined,\n    evidence: capability.evidence ? [...capability.evidence] : undefined,\n''',
        '''    provides: capability.provides ? [...capability.provides] : undefined,\n    inputs: capability.inputs ? [...capability.inputs] : undefined,\n    outputs: capability.outputs ? [...capability.outputs] : undefined,\n    effects: capability.effects ? [...capability.effects] : undefined,\n    dependencies: capability.dependencies ? [...capability.dependencies] : undefined,\n    compatibility: capability.compatibility ? [...capability.compatibility] : undefined,\n    evidence: capability.evidence ? [...capability.evidence] : undefined,\n''',
    )
    replace_once(
        'src/capabilities/registry.ts',
        '''  list(options?: { availableOnly?: boolean; environment?: string }): CapabilityDescriptor[] {\n    return [...this.entries.values()].filter((entry) => {\n      if (options?.availableOnly && !isCapabilityVerifiedAvailable(entry)) return false;\n      if (options?.environment && entry.environment !== options.environment) return false;\n      return true;\n    });\n  }\n\n  findSupporting(requirement: string): CapabilityDescriptor[] {\n    const needle = requirement.trim().toLowerCase();\n    if (!needle) return [];\n\n    return this.list({ availableOnly: true }).filter((entry) => {\n      const haystack = [\n        entry.id,\n        entry.type,\n        entry.provider,\n        entry.description,\n        ...entry.requirements,\n        ...(entry.inputs ?? []),\n        ...(entry.outputs ?? []),\n      ].join(" ").toLowerCase();\n      return haystack.includes(needle);\n    });\n  }\n''',
        '''  list(options?: { availableOnly?: boolean; environment?: string }): CapabilityDescriptor[] {\n    return [...this.entries.values()].filter((entry) => {\n      if (options?.availableOnly && !isCapabilityVerifiedAvailable(entry)) return false;\n      if (options?.environment && entry.environment !== options.environment) return false;\n      return true;\n    });\n  }\n\n  /** Verified state plus a fully verified, acyclic declared dependency chain. */\n  isExecutionReady(id: string, trail: ReadonlySet<string> = new Set()): boolean {\n    if (trail.has(id)) return false;\n    const capability = this.entries.get(id);\n    if (!capability || !isCapabilityVerifiedAvailable(capability)) return false;\n    const nextTrail = new Set(trail);\n    nextTrail.add(id);\n    return (capability.dependencies ?? []).every((dependency) =>\n      this.isExecutionReady(dependency, nextTrail)\n    );\n  }\n\n  findSupporting(requirement: string): CapabilityDescriptor[] {\n    const needle = requirement.trim();\n    if (!needle) return [];\n    return this.list().filter((entry) =>\n      this.isExecutionReady(entry.id) &&\n      capabilityProvides(entry, needle)\n    );\n  }\n''',
    )
    replace_once(
        'src/capabilities/registry.ts',
        '''  capabilityStateOf,\n  isCapabilityVerifiedAvailable,\n} from "./model.js";\n''',
        '''  capabilityProvides,\n  capabilityStateOf,\n  isCapabilityVerifiedAvailable,\n} from "./model.js";\n''',
    )
    replace_once(
        'src/capabilities/registry.ts',
        '''        description: tool.description ?? tool.name,\n        requirements: [],\n        permissions: [],\n''',
        '''        description: tool.description ?? tool.name,\n        requirements: [],\n        provides: [tool.name],\n        permissions: [],\n''',
    )
    replace_once(
        'src/capabilities/registry.ts',
        '''        description: skill.description ?? skill.name,\n        requirements: [],\n        permissions: [],\n''',
        '''        description: skill.description ?? skill.name,\n        requirements: [],\n        provides: [skill.name],\n        permissions: [],\n''',
    )

    replace_once(
        'src/capabilities/store.ts',
        '''    requirements: canonicalStrings(capability.requirements),\n    permissions: canonicalStrings(capability.permissions),\n    environment: capability.environment ?? null,\n    inputs: canonicalStrings(capability.inputs),\n    outputs: canonicalStrings(capability.outputs),\n''',
        '''    requirements: canonicalStrings(capability.requirements),\n    provides: canonicalStrings(capability.provides),\n    permissions: canonicalStrings(capability.permissions),\n    effects: canonicalStrings(capability.effects),\n    dependencies: canonicalStrings(capability.dependencies),\n    version: capability.version?.trim() || null,\n    compatibility: canonicalStrings(capability.compatibility),\n    environment: capability.environment ?? null,\n    inputs: canonicalStrings(capability.inputs),\n    outputs: canonicalStrings(capability.outputs),\n''',
    )

    # Existing VERIFIED fixtures must name their authority under the stronger invariant.
    resolver_test = ROOT / 'src/__tests__/capability-resolver.test.ts'
    text = resolver_test.read_text(encoding='utf-8')
    needle = '      observedAt: "2026-09-13T23:00:00.000Z",\n      evidence: ['
    if text.count(needle) != 3:
        raise SystemExit(f"capability-resolver.test.ts: expected 3 verified fixtures, got {text.count(needle)}")
    text = text.replace(
        needle,
        '      observedAt: "2026-09-13T23:00:00.000Z",\n      authority: "test:verified-probe",\n      evidence: [',
    )
    resolver_test.write_text(text, encoding='utf-8')

    insert_before_final_close(
        'src/__tests__/capability-registry.test.ts',
        '''\n\n  it("does not accept verified_available without a named authority", () => {\n    const registry = new CapabilityRegistry();\n    registry.register({\n      id: "claimed:no-authority",\n      type: "future_runtime",\n      provider: "test",\n      description: "Future runtime",\n      requirements: ["future runtime"],\n      permissions: [],\n      available: true,\n      state: "verified_available",\n      observedAt: "2026-09-19T01:00:00.000Z",\n      evidence: ["probe returned ok"],\n    });\n\n    const capability = registry.get("claimed:no-authority")!;\n    expect(capabilityStateOf(capability)).toBe("probed");\n    expect(capability.available).toBe(false);\n  });\n\n  it("accepts future capability types without extending a central union", () => {\n    const registry = new CapabilityRegistry();\n    registry.register({\n      id: "future:gpu-runtime",\n      type: "gpu_runtime",\n      provider: "future",\n      description: "GPU runtime",\n      requirements: ["gpu runtime"],\n      provides: ["gpu runtime"],\n      permissions: [],\n      available: false,\n      state: "discovered_unverified",\n    });\n\n    expect(registry.get("future:gpu-runtime")?.type).toBe("gpu_runtime");\n  });\n''',
    )

    insert_before_final_close(
        'src/__tests__/capability-resolver.test.ts',
        '''\n\n  it("never elevates lexical description similarity to use_existing", () => {\n    const registry = new CapabilityRegistry();\n    registry.register({\n      id: "service:python-docs",\n      type: "service",\n      provider: "test",\n      description: "Python documentation and package guidance",\n      requirements: ["documentation"],\n      provides: ["documentation"],\n      permissions: [],\n      available: true,\n      state: "verified_available",\n      observedAt: "2026-09-19T01:00:00.000Z",\n      authority: "test:probe",\n      evidence: ["documentation endpoint probe passed"],\n    });\n\n    const result = new CapabilityResolver(registry).resolve({ requirement: "python" });\n    expect(result.kind).not.toBe("use_existing");\n    expect(result.missingRequirements).toContain("provides:python");\n  });\n\n  it("fails closed when an explicit budget has unknown capability cost", () => {\n    const registry = new CapabilityRegistry();\n    registry.register({\n      id: "api:storage",\n      type: "api",\n      provider: "test",\n      description: "Object storage API",\n      requirements: ["object storage"],\n      permissions: [],\n      available: true,\n      state: "verified_available",\n      observedAt: "2026-09-19T01:01:00.000Z",\n      authority: "test:probe",\n      evidence: ["storage probe passed"],\n      estimatedCostCents: null,\n    });\n\n    const result = new CapabilityResolver(registry).resolve({\n      requirement: "object storage",\n      maxCostCents: 10,\n    });\n    expect(result.kind).not.toBe("use_existing");\n    expect(result.missingRequirements).toContain("cost:known");\n  });\n\n  it("requires explicit permissions, I/O, effects, compatibility and ready dependencies", () => {\n    const registry = new CapabilityRegistry();\n    registry.register({\n      id: "dependency:codec",\n      type: "library_runtime",\n      provider: "test",\n      description: "Codec dependency",\n      requirements: ["codec"],\n      permissions: [],\n      available: false,\n      state: "discovered_unverified",\n    });\n    registry.register({\n      id: "service:transform",\n      type: "service",\n      provider: "test",\n      description: "Structured transform service",\n      requirements: ["transform data"],\n      provides: ["transform data"],\n      permissions: ["data:read"],\n      inputs: ["json"],\n      outputs: ["json"],\n      effects: ["read"],\n      dependencies: ["dependency:codec"],\n      version: "2.0",\n      compatibility: ["schema-v2"],\n      estimatedCostCents: 2,\n      available: true,\n      state: "verified_available",\n      observedAt: "2026-09-19T01:02:00.000Z",\n      authority: "test:probe",\n      evidence: ["transform probe passed"],\n    });\n\n    const result = new CapabilityResolver(registry).resolve({\n      requirement: "transform data",\n      requiredPermissions: ["data:write"],\n      requiredInputs: ["csv"],\n      requiredOutputs: ["parquet"],\n      requiredEffects: ["write"],\n      requiredCompatibility: ["schema-v3"],\n      maxCostCents: 5,\n    });\n\n    expect(result.kind).not.toBe("use_existing");\n    expect(result.missingRequirements).toEqual(expect.arrayContaining([\n      "permission:data:write",\n      "input:csv",\n      "output:parquet",\n      "effect:write",\n      "compatibility:schema-v3",\n      "dependency:dependency:codec:not_ready",\n    ]));\n  });\n\n  it("allows exact contract use only after the dependency chain is verified", () => {\n    const registry = new CapabilityRegistry();\n    registry.register({\n      id: "dependency:codec",\n      type: "library_runtime",\n      provider: "test",\n      description: "Codec dependency",\n      requirements: ["codec"],\n      permissions: [],\n      available: true,\n      state: "verified_available",\n      observedAt: "2026-09-19T01:03:00.000Z",\n      authority: "test:probe",\n      evidence: ["codec probe passed"],\n    });\n    registry.register({\n      id: "service:transform",\n      type: "service",\n      provider: "test",\n      description: "Structured transform service",\n      requirements: ["transform data"],\n      provides: ["transform data"],\n      permissions: ["data:write"],\n      inputs: ["json"],\n      outputs: ["parquet"],\n      effects: ["write"],\n      dependencies: ["dependency:codec"],\n      version: "2.0",\n      compatibility: ["schema-v2"],\n      estimatedCostCents: 2,\n      available: true,\n      state: "verified_available",\n      observedAt: "2026-09-19T01:04:00.000Z",\n      authority: "test:probe",\n      evidence: ["transform probe passed"],\n    });\n\n    const result = new CapabilityResolver(registry).resolve({\n      requirement: "transform data",\n      requiredPermissions: ["data:write"],\n      requiredInputs: ["json"],\n      requiredOutputs: ["parquet"],\n      requiredEffects: ["write"],\n      requiredCompatibility: ["schema-v2"],\n      maxCostCents: 5,\n    });\n    expect(result.kind).toBe("use_existing");\n    expect(result.candidates[0]?.id).toBe("service:transform");\n  });\n''',
    )

    replace_once(
        'src/__tests__/capability-persistence.test.ts',
        '''      expect(registry.findSupporting("execute").map((entry) => entry.id)).toContain("tool:exec");\n''',
        '''      expect(registry.findSupporting("exec").map((entry) => entry.id)).toContain("tool:exec");\n''',
    )
    insert_before_final_close(
        'src/__tests__/capability-persistence.test.ts',
        '''\n\n  it("invalidates persisted verification when a contract field changes across restart", () => {\n    const dbPath = tempDbPath();\n    const first = createDatabase(dbPath);\n    try {\n      const registry = new CapabilityRegistry(new CapabilityStore(first.raw));\n      registry.register({\n        id: "service:contracted",\n        type: "service",\n        provider: "test",\n        description: "Contracted service",\n        requirements: ["transform"],\n        provides: ["transform"],\n        permissions: [],\n        effects: ["read"],\n        version: "1",\n        available: true,\n        state: "verified_available",\n        authority: "probe:contract",\n        observedAt: "2026-09-19T01:10:00.000Z",\n        evidence: ["contract probe passed"],\n      });\n\n      const row = first.raw.prepare(\n        "SELECT descriptor_json FROM capability_records WHERE id = ?",\n      ).get("service:contracted") as { descriptor_json: string };\n      const changed = JSON.parse(row.descriptor_json) as Record<string, unknown>;\n      changed.effects = ["write"];\n      changed.version = "2";\n      first.raw.prepare(\n        "UPDATE capability_records SET descriptor_json = ? WHERE id = ?",\n      ).run(JSON.stringify(changed), "service:contracted");\n    } finally {\n      first.close();\n    }\n\n    const second = createDatabase(dbPath);\n    try {\n      const registry = new CapabilityRegistry(new CapabilityStore(second.raw));\n      const capability = registry.get("service:contracted")!;\n      expect(capabilityStateOf(capability)).toBe("discovered_unverified");\n      expect(capability.available).toBe(false);\n      expect(capability.authority).toBe("capability-store:definition-mismatch");\n    } finally {\n      second.close();\n    }\n  });\n''',
    )

    insert_before_final_close(
        'src/__tests__/capability-tools.test.ts',
        '''\n\n  it("passes explicit permission and effect requirements through resolve_capability", async () => {\n    const capabilities = new CapabilityRegistry();\n    const environments = new EnvironmentRegistry();\n    environments.register({\n      id: "remote",\n      async inspect() {\n        return {\n          id: "remote",\n          label: "Remote",\n          availability: "available",\n          evidence: ["remote provider probe passed"],\n          constraints: [],\n          observedAt: "2026-09-19T01:20:00.000Z",\n          capabilities: [{\n            id: "remote:writer",\n            type: "future_writer",\n            provider: "remote",\n            description: "Object writer",\n            requirements: ["object write"],\n            provides: ["object write"],\n            permissions: ["object:write"],\n            effects: ["write"],\n            environment: "remote",\n            available: true,\n          }],\n        };\n      },\n    });\n\n    const tool = createCapabilityTools(capabilities, environments)\n      .find((entry) => entry.name === "resolve_capability")!;\n    const raw = await tool.execute({\n      requirement: "object write",\n      requiredPermissions: ["object:write"],\n      requiredEffects: ["write"],\n    }, {} as any);\n    const result = JSON.parse(raw) as { kind: string; candidates: Array<{ id: string; effects: string[] }> };\n    expect(result.kind).toBe("use_existing");\n    expect(result.candidates[0]?.id).toBe("remote:writer");\n    expect(result.candidates[0]?.effects).toContain("write");\n  });\n''',
    )


def finalize() -> None:
    run_id = os.environ.get('P014_RUN_ID', 'UNKNOWN')
    c = ROOT / 'ProjectOps/continuity/C0010.md'
    text = c.read_text(encoding='utf-8')
    text = text.replace(
        'Classification: V19_UNIT_INTEGRATION_VERIFIED / CONTRACT_HARDENING_DECISION_READY',
        'Classification: CONTRACT_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING',
        1,
    )
    text += f'''\n\n### Segunda unidad contractual — source green interno\n\n- apply/validation run: `{run_id}`;\n- modelo abierto + contracts explícitos: IMPLEMENTADO;\n- authority requerida para VERIFIED: IMPLEMENTADO;\n- exact contract gate para `use_existing`: IMPLEMENTADO;\n- dependency readiness recursivo/acyclic: IMPLEMENTADO;\n- explicit budget con coste desconocido: FAIL-CLOSED;\n- fingerprint incluye campos contractuales nuevos: IMPLEMENTADO;\n- `resolve_capability` expone restrictions contractuales: IMPLEMENTADO;\n- P-017/P-018 ownership: PRESERVADO;\n- targeted adversarial, typecheck, build, full suite, security-focused, ProjectOps y `git diff --check`: PASS dentro del aplicador.\n\nEstado: `SOURCE_GREEN / EXACT_GATE_PENDING`. El commit producido por este workflow debe identificarse y gatearse luego con CI/ProjectOps ordinarios antes de ampliar P-014.\n'''
    c.write_text(text, encoding='utf-8')

    p = ROOT / 'ProjectOps/plan/P-014.md'
    text = p.read_text(encoding='utf-8')
    text = text.replace(
        'Evidence-State: V19_UNIT_INTEGRATION_VERIFIED / CONTRACT_HARDENING_DECISION_READY',
        'Evidence-State: CONTRACT_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING',
        1,
    )
    text += f'''\n\n## Segunda unidad contractual — validación interna\n\nRun `{run_id}`: source contractual implementado y validado internamente. Exact ordinary CI/ProjectOps gate del clean source head sigue pendiente; por tanto P-014 permanece EN_EJECUCIÓN y esta unidad no se clasifica todavía INTEGRATION_VERIFIED.\n'''
    p.write_text(text, encoding='utf-8')

    root = ROOT / 'ProjectOps/CONTINUITY.md'
    text = root.read_text(encoding='utf-8')
    text = text.replace(
        'Active-Intervention: P014_CAPABILITY_FABRIC — V19_UNIT_INTEGRATION_VERIFIED / CONTRACT_HARDENING_DECISION_READY',
        'Active-Intervention: P014_CAPABILITY_FABRIC — CONTRACT_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING',
        1,
    )
    text = text.replace(
        '- P-014: EN_EJECUCIÓN / DECISION_READY / V19_UNIT_INTEGRATION_VERIFIED / CONTRACT_HARDENING_DECISION_READY — lifecycle durable v19 gateado en rama; segunda unidad contractual registrada antes de source.',
        '- P-014: EN_EJECUCIÓN / CONTRACT_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING — lifecycle durable v19 gateado; contract hardening validado internamente y pendiente de gate ordinario exact-head.',
        1,
    )
    root.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    import sys
    if len(sys.argv) != 2 or sys.argv[1] not in {'apply', 'finalize'}:
        raise SystemExit('usage: p014-contract-apply.py apply|finalize')
    apply() if sys.argv[1] == 'apply' else finalize()
