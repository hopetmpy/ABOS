import type { AbosTool } from "../types.js";
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
