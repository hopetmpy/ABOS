import type {
  CapabilityDescriptor,
  CapabilityState,
} from "./model.js";
import {
  capabilityStateOf,
  isCapabilityVerifiedAvailable,
} from "./model.js";
import type { EnvironmentSnapshot } from "../environments/types.js";

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function hasValidObservation(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function normalizeClaimState(capability: CapabilityDescriptor): CapabilityState {
  const requestedState = capabilityStateOf(capability);
  if (requestedState !== "verified_available") return requestedState;

  const hasEvidence = (capability.evidence ?? []).some((entry) => entry.trim().length > 0);
  if (!hasEvidence || !hasValidObservation(capability.observedAt)) {
    // A producer may have executed a probe, but without evidence + observation
    // time the generic registry cannot truthfully advertise current availability.
    return "probed";
  }
  return requestedState;
}

function environmentCapabilityState(
  snapshot: EnvironmentSnapshot,
  capability: CapabilityDescriptor,
): CapabilityState {
  if (snapshot.availability === "requires_authorization") return "unauthorized";
  if (snapshot.availability === "unavailable") return "unavailable";
  if (snapshot.availability === "unknown") return "unknown";
  if (snapshot.availability === "degraded") return "degraded";
  if (snapshot.availability === "available") {
    return capability.available ? "verified_available" : "unavailable";
  }
  return "unknown";
}

export class CapabilityRegistry {
  private readonly entries = new Map<string, CapabilityDescriptor>();

  register(capability: CapabilityDescriptor): void {
    const state = normalizeClaimState(capability);
    this.entries.set(capability.id, {
      ...capability,
      state,
      available: state === "verified_available",
      requirements: [...capability.requirements],
      permissions: [...capability.permissions],
      inputs: capability.inputs ? [...capability.inputs] : undefined,
      outputs: capability.outputs ? [...capability.outputs] : undefined,
      evidence: capability.evidence ? [...capability.evidence] : undefined,
      metadata: capability.metadata ? { ...capability.metadata } : undefined,
    });
  }

  registerMany(capabilities: CapabilityDescriptor[]): void {
    for (const capability of capabilities) this.register(capability);
  }

  /**
   * Project an evidence-bearing environment observation into the generic
   * capability authority. Environment lifecycle remains authoritative for the
   * environment itself; this method only derives capability truth from that
   * observation.
   */
  registerEnvironmentSnapshot(snapshot: EnvironmentSnapshot): void {
    for (const capability of snapshot.capabilities) {
      const state = environmentCapabilityState(snapshot, capability);
      this.register({
        ...capability,
        state,
        available: state === "verified_available",
        observedAt: snapshot.observedAt,
        authority: `environment:${snapshot.id}`,
        evidence: unique([
          ...(capability.evidence ?? []),
          ...snapshot.evidence,
        ]),
        metadata: {
          ...(capability.metadata ?? {}),
          environmentAvailability: snapshot.availability,
          environmentObservedAt: snapshot.observedAt,
        },
      });
    }
  }

  get(id: string): CapabilityDescriptor | undefined {
    return this.entries.get(id);
  }

  list(options?: { availableOnly?: boolean; environment?: string }): CapabilityDescriptor[] {
    return [...this.entries.values()].filter((entry) => {
      if (options?.availableOnly && !isCapabilityVerifiedAvailable(entry)) return false;
      if (options?.environment && entry.environment !== options.environment) return false;
      return true;
    });
  }

  findSupporting(requirement: string): CapabilityDescriptor[] {
    const needle = requirement.trim().toLowerCase();
    if (!needle) return [];

    return this.list({ availableOnly: true }).filter((entry) => {
      const haystack = [
        entry.id,
        entry.type,
        entry.provider,
        entry.description,
        ...entry.requirements,
        ...(entry.inputs ?? []),
        ...(entry.outputs ?? []),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }

  /**
   * Tool registration proves that a callable surface is known to this runtime,
   * not that every external dependency behind the tool is currently usable.
   * Keep it unverified until a producer supplies runtime evidence.
   */
  ingestTools(tools: Array<{ name: string; description?: string }>): void {
    const observedAt = new Date().toISOString();
    for (const tool of tools) {
      this.register({
        id: `tool:${tool.name}`,
        type: "tool",
        provider: "abos",
        description: tool.description ?? tool.name,
        requirements: [],
        permissions: [],
        available: false,
        state: "discovered_unverified",
        observedAt,
        authority: "runtime:tool-definition",
        evidence: [
          "Tool definition is registered in the current ABOS runtime; external execution readiness has not been independently verified.",
        ],
      });
    }
  }

  /**
   * `enabled` is an administrative/inventory flag. It is not runtime evidence
   * that the skill file and all requirements are currently usable.
   */
  ingestSkills(skills: Array<{ name: string; description?: string; enabled?: boolean }>): void {
    const observedAt = new Date().toISOString();
    for (const skill of skills) {
      this.register({
        id: `skill:${skill.name}`,
        type: "skill",
        provider: "abos",
        description: skill.description ?? skill.name,
        requirements: [],
        permissions: [],
        available: false,
        state: skill.enabled === false ? "unavailable" : "discovered_unverified",
        observedAt,
        authority: "runtime:skill-inventory",
        evidence: [
          skill.enabled === false
            ? "Skill is disabled in the current inventory."
            : "Skill is enabled in inventory, but inventory state alone is not execution-readiness evidence.",
        ],
      });
    }
  }
}
