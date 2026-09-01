import type {
  CapabilityDescriptor,
  CapabilityRequest,
  CapabilityResolution,
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

export class CapabilityResolver {
  constructor(private readonly registry: CapabilityRegistry) {}

  resolve(
    request: CapabilityRequest,
    environments: EnvironmentSnapshot[] = [],
  ): CapabilityResolution {
    const requiredPermissions = request.requiredPermissions ?? [];
    const all = this.registry.list();

    const usable = all.filter((capability) =>
      capability.available &&
      supports(capability, request.requirement) &&
      requiredPermissions.every((permission) =>
        capability.permissions.includes(permission)
      ) &&
      (request.maxCostCents == null ||
        capability.estimatedCostCents == null ||
        capability.estimatedCostCents <= request.maxCostCents)
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
          ? `An available capability satisfies the requirement in preferred environment "${request.preferredEnvironment}".`
          : "An available registered capability satisfies the requirement.",
        nextActions: ["Select the best candidate using current cost, evidence, and environment health."],
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
          "The capability exists, but not in the preferred/current environment.",
        nextActions: environmentsWithSupport.map(
          (environment) => `Evaluate environment "${environment}" for this path.`,
        ),
      };
    }

    const unavailableButKnown = all.filter((capability) =>
      !capability.available && supports(capability, request.requirement)
    );
    if (unavailableButKnown.length > 0) {
      return {
        kind: "acquire",
        requirement: request.requirement,
        candidates: unavailableButKnown,
        missingRequirements: [request.requirement],
        rationale:
          "ABOS knows capabilities that satisfy the requirement, but they are not currently available.",
        nextActions: [
          "Determine the missing authorization, installation, configuration, or resource condition.",
          "Acquire the capability legitimately or evaluate another provider.",
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
          "No single registered capability satisfies the requirement, but multiple partial capabilities may be composable.",
        nextActions: [
          "Plan an explicit composition with compatible inputs/outputs.",
          "Verify the composition against the objective before execution.",
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
        kind: "acquire",
        requirement: request.requirement,
        candidates: environmentHints,
        missingRequirements: [request.requirement],
        rationale:
          "An inspected environment advertises the required capability but it is not yet registered/available for the current path.",
        nextActions: [
          "Register or authorize the environment capability.",
          "Re-evaluate after the environment state changes.",
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
