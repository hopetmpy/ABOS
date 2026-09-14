import type {
  CapabilityDescriptor,
  CapabilityRequest,
  CapabilityResolution,
} from "./model.js";
import {
  capabilityStateOf,
  isCapabilityVerifiedAvailable,
} from "./model.js";
import type { CapabilityRegistry } from "./registry.js";
import type { EnvironmentSnapshot } from "../environments/types.js";

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function supports(capability: CapabilityDescriptor, requirement: string): boolean {
  const needle = normalized(requirement);
  const haystack = normalized([
    capability.id,
    capability.type,
    capability.provider,
    capability.description,
    ...capability.requirements,
    ...(capability.inputs ?? []),
    ...(capability.outputs ?? []),
  ].join(" "));
  return haystack.includes(needle);
}

function satisfiesRequest(
  capability: CapabilityDescriptor,
  request: CapabilityRequest,
): boolean {
  const requiredPermissions = request.requiredPermissions ?? [];
  return supports(capability, request.requirement) &&
    requiredPermissions.every((permission) =>
      capability.permissions.includes(permission)
    ) &&
    (request.maxCostCents == null ||
      capability.estimatedCostCents == null ||
      capability.estimatedCostCents <= request.maxCostCents);
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
      isCapabilityVerifiedAvailable(capability) &&
      satisfiesRequest(capability, request)
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
          ? `A VERIFIED_AVAILABLE capability satisfies the requirement in preferred environment "${request.preferredEnvironment}".`
          : "A VERIFIED_AVAILABLE registered capability satisfies the requirement.",
        nextActions: [
          "Select the best candidate using current cost, evidence, observation time, and environment health.",
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
          "A verified capability exists, but not in the preferred/current environment.",
        nextActions: environmentsWithSupport.map(
          (environment) => `Evaluate environment "${environment}" for this path using current evidence.`,
        ),
      };
    }

    const known = all.filter((capability) => satisfiesRequest(capability, request));
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
            "Known candidates for this route are explicitly PROHIBITED. That blocks this route, not necessarily the objective.",
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
            `ABOS knows candidate capabilities, but none has current VERIFIED_AVAILABLE evidence. States: ${statesOf(known).join(", ")}.`,
          nextActions: [
            "Probe the most relevant candidate through its authoritative runtime/provider boundary.",
            "Promote to VERIFIED_AVAILABLE only after current evidence supports the claim.",
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
          "Restore/acquire legitimately or evaluate another provider without claiming success early.",
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
          "No single verified registered capability satisfies the requirement, but multiple partial capabilities may be composable.",
        nextActions: [
          "Plan an explicit composition with compatible inputs/outputs.",
          "Probe every material dependency before presenting the composition as executable.",
        ],
      };
    }

    const environmentHints = environments
      .filter((environment) => environment.availability !== "unavailable")
      .flatMap((environment) =>
        environment.capabilities.filter((capability) =>
          supports(capability, request.requirement)
        )
      );

    if (environmentHints.length > 0) {
      return {
        kind: "probe",
        requirement: request.requirement,
        candidates: environmentHints,
        missingRequirements: [request.requirement],
        rationale:
          "An inspected environment advertises the required capability, but the generic registry does not yet hold VERIFIED_AVAILABLE evidence for the current path.",
        nextActions: [
          "Project the authoritative environment observation into capability state.",
          "Re-evaluate after current evidence is registered.",
        ],
      };
    }

    return {
      kind: "construct",
      requirement: request.requirement,
      candidates: [],
      missingRequirements: [request.requirement],
      rationale:
        "No known registered capability currently satisfies the requirement. This is UNKNOWN, not evidence of impossibility.",
      nextActions: [
        "Research existing tools, services, SDKs, APIs, or skills.",
        "If no suitable capability exists, construct a minimal reusable capability and validate it.",
      ],
    };
  }
}
