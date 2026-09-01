import type { AbosTool } from "../types.js";
import type { CapabilityRegistry } from "./registry.js";
import { CapabilityResolver } from "./resolver.js";
import type { EnvironmentRegistry } from "../environments/registry.js";

export function createCapabilityTools(
  registry: CapabilityRegistry,
  environments: EnvironmentRegistry,
): AbosTool[] {
  return [
    {
      name: "resolve_capability",
      description:
        "Resolve a required capability across registered tools, skills, services, and execution environments. " +
        "Returns whether to use existing capability, change environment, acquire, compose, or construct.",
      category: "capability",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          requirement: {
            type: "string",
            description: "Outcome/capability requirement, e.g. terraform, object storage, serverless.",
          },
          preferredEnvironment: {
            type: "string",
            description: "Optional preferred environment ID.",
          },
          maxCostCents: {
            type: "number",
            description: "Optional maximum estimated capability cost.",
          },
        },
        required: ["requirement"],
      },
      execute: async (args) => {
        const requirement = String(args.requirement ?? "").trim();
        if (!requirement) return "UNKNOWN: capability requirement is empty.";

        const snapshots = await environments.inspectAll();
        for (const snapshot of snapshots) {
          registry.registerMany(snapshot.capabilities);
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
            available: candidate.available,
            description: candidate.description,
          })),
        });
      },
    },
    {
      name: "inspect_environments",
      description:
        "Inspect registered execution environments and report real current availability, constraints, and advertised capabilities.",
      category: "environment",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        const snapshots = await environments.inspectAll();
        for (const snapshot of snapshots) {
          registry.registerMany(snapshot.capabilities);
        }
        return JSON.stringify(
          snapshots.map((snapshot) => ({
            id: snapshot.id,
            label: snapshot.label,
            availability: snapshot.availability,
            constraints: snapshot.constraints,
            evidence: snapshot.evidence,
            capabilities: snapshot.capabilities.map((capability) => ({
              id: capability.id,
              description: capability.description,
              available: capability.available,
            })),
          })),
        );
      },
    },
  ];
}
