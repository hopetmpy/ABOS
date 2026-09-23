import type { AbosTool } from "../types.js";
import type { CapabilityRegistry } from "./registry.js";
import { CapabilityResolver } from "./resolver.js";
import type { EnvironmentRegistry } from "../environments/registry.js";
import { capabilityStateOf, type CapabilityRequest, type CapabilityResolution } from "./model.js";
import { CapabilityAcquisitionCoordinator } from "./acquisition.js";
import { createCapabilityAcquisitionEvidenceSink } from "./acquisition-evidence.js";
import { createMcpFunctionalProbeRoute } from "./routes/mcp-functional-probe.js";

export const CAPABILITY_TOOL_NAMES = [
  "resolve_capability",
  "remediate_capability",
  "inspect_environments",
] as const;

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

function recordObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function requestFromArgs(args: Record<string, unknown>): CapabilityRequest | null {
  const requirement = String(args.requirement ?? "").trim();
  if (!requirement) return null;
  return {
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
  };
}

function serializeResolution(resolution: CapabilityResolution) {
  return {
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
  };
}

const requestProperties = {
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
} as const;

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
        properties: requestProperties,
        required: ["requirement"],
      },
      execute: async (args) => {
        const request = requestFromArgs(args);
        if (!request) return "UNKNOWN: capability requirement is empty.";

        const snapshots = await environments.inspectAll();
        for (const snapshot of snapshots) {
          registry.registerEnvironmentSnapshot(snapshot);
        }

        const resolution = new CapabilityResolver(registry).resolve(
          request,
          snapshots,
        );

        return JSON.stringify(serializeResolution(resolution));
      },
    },
    {
      name: "remediate_capability",
      description:
        "Execute the P-017 capability-gap lifecycle over evidence-backed acquisition routes, then re-resolve the original contract through the canonical CapabilityRegistry. " +
        "It never treats install/configuration success as readiness. For a P-015-discovered MCP tool, optional probeArguments are the real intended operation and are executed only by re-entering that tool's own protected Policy boundary. " +
        "Omit probeArguments to inspect the remediation path without inventing a side-effecting probe.",
      category: "capability",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          ...requestProperties,
          probeArguments: {
            type: "object",
            additionalProperties: true,
            description:
              "Optional exact arguments for a real functional probe/use of an already P-015-discovered MCP candidate. The selected inner tool is evaluated by its own Policy; no synthetic no-op arguments are invented.",
          },
        },
        required: ["requirement"],
      },
      execute: async (args, ctx) => {
        const request = requestFromArgs(args);
        if (!request) return "UNKNOWN: capability requirement is empty.";

        const snapshots = await environments.inspectAll();
        for (const snapshot of snapshots) {
          registry.registerEnvironmentSnapshot(snapshot);
        }

        const coordinator = new CapabilityAcquisitionCoordinator(
          registry,
          [
            createMcpFunctionalProbeRoute({
              probeArguments: recordObject(args.probeArguments),
            }),
          ],
          createCapabilityAcquisitionEvidenceSink(ctx.db.raw),
        );

        const outcome = await coordinator.remediate(request, snapshots);
        return JSON.stringify({
          status: outcome.status,
          reason: outcome.reason,
          routes: coordinator.listRouteIds(),
          initialResolution: serializeResolution(outcome.initialResolution),
          finalResolution: serializeResolution(outcome.finalResolution),
          attempts: outcome.attempts,
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
