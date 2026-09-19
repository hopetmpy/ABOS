import type {
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
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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
            `ABOS knows discovery candidates, but none has current VERIFIED_AVAILABLE evidence sufficient to prove the requested execution contract. States: ${statesOf(known).join(", ")}.`,
          nextActions: [
            "Probe the most relevant candidate through its authoritative runtime/provider boundary.",
            "Promote to VERIFIED_AVAILABLE only after current authority, evidence, time, and contract claims are explicit.",
          ],
        };
      }

      const verifiedButInsufficient = known.filter((capability) =>
        capabilityStateOf(capability) === "verified_available" &&
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
