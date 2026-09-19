import type {
  CapabilityDescriptor,
  CapabilityState,
} from "./model.js";
import {
  capabilityStateOf,
  isCapabilityVerifiedAvailable,
} from "./model.js";
import type { EnvironmentSnapshot } from "../environments/types.js";
import {
  CapabilityStore,
  capabilityDefinitionFingerprint,
} from "./store.js";

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

function cloneCapability(
  capability: CapabilityDescriptor,
  state: CapabilityState,
): CapabilityDescriptor {
  return {
    ...capability,
    state,
    available: state === "verified_available",
    requirements: [...capability.requirements],
    permissions: [...capability.permissions],
    inputs: capability.inputs ? [...capability.inputs] : undefined,
    outputs: capability.outputs ? [...capability.outputs] : undefined,
    evidence: capability.evidence ? [...capability.evidence] : undefined,
    metadata: capability.metadata ? { ...capability.metadata } : undefined,
  };
}

function isWeakInventoryAuthority(authority: string | null | undefined): boolean {
  return authority === "runtime:tool-definition" || authority === "runtime:skill-inventory";
}

export interface CapabilityProbeObservation {
  state: CapabilityState;
  authority: string;
  evidence: string[];
  observedAt?: string;
  metadata?: Record<string, unknown>;
}

export class CapabilityRegistry {
  private readonly entries = new Map<string, CapabilityDescriptor>();
  private readonly fingerprints = new Map<string, string>();

  constructor(private readonly store?: CapabilityStore) {
    this.hydrate();
  }

  private hydrate(): void {
    if (!this.store) return;
    for (const persisted of this.store.list()) {
      const computedFingerprint = capabilityDefinitionFingerprint(persisted.capability);
      const fingerprintMatches = computedFingerprint === persisted.definitionFingerprint;
      const candidate = fingerprintMatches
        ? persisted.capability
        : {
            ...persisted.capability,
            state: "discovered_unverified",
            available: false,
            authority: "capability-store:definition-mismatch",
            evidence: unique([
              ...(persisted.capability.evidence ?? []),
              "Persisted capability definition fingerprint did not match its descriptor; runtime verification was invalidated.",
            ]),
          };
      const normalized = cloneCapability(candidate, normalizeClaimState(candidate));
      this.entries.set(normalized.id, normalized);
      this.fingerprints.set(normalized.id, computedFingerprint);

      if (
        !fingerprintMatches ||
        capabilityStateOf(normalized) !== capabilityStateOf(persisted.capability) ||
        normalized.available !== persisted.capability.available
      ) {
        this.store.upsert(normalized, computedFingerprint);
      }
    }
  }

  private storeNormalized(
    capability: CapabilityDescriptor,
    definitionFingerprint = capabilityDefinitionFingerprint(capability),
  ): void {
    const normalized = cloneCapability(capability, normalizeClaimState(capability));
    this.entries.set(normalized.id, normalized);
    this.fingerprints.set(normalized.id, definitionFingerprint);
    this.store?.upsert(normalized, definitionFingerprint);
  }

  register(capability: CapabilityDescriptor): void {
    this.storeNormalized(capability);
  }

  private registerInventory(capability: CapabilityDescriptor): void {
    const definitionFingerprint = capabilityDefinitionFingerprint(capability);
    const existing = this.entries.get(capability.id);
    const existingFingerprint = this.fingerprints.get(capability.id);
    const canPreserveEvidenceBackedLifecycle =
      existing !== undefined &&
      existingFingerprint === definitionFingerprint &&
      !isWeakInventoryAuthority(existing.authority) &&
      (existing.evidence ?? []).some((entry) => entry.trim().length > 0) &&
      hasValidObservation(existing.observedAt);

    if (!canPreserveEvidenceBackedLifecycle || !existing) {
      this.storeNormalized(capability, definitionFingerprint);
      return;
    }

    this.storeNormalized({
      ...capability,
      state: capabilityStateOf(existing),
      available: existing.available,
      observedAt: existing.observedAt,
      authority: existing.authority,
      evidence: existing.evidence ? [...existing.evidence] : undefined,
      metadata: {
        ...(capability.metadata ?? {}),
        ...(existing.metadata ?? {}),
      },
    }, definitionFingerprint);
  }

  registerMany(capabilities: CapabilityDescriptor[]): void {
    for (const capability of capabilities) this.register(capability);
  }

  /**
   * Record an explicit runtime observation/probe against a known definition.
   * Every transition requires named authority, evidence, and a valid observation
   * time; state labels remain open-ended so providers are not forced into a
   * closed business taxonomy.
   */
  recordProbe(id: string, observation: CapabilityProbeObservation): CapabilityDescriptor {
    const current = this.entries.get(id);
    if (!current) throw new Error(`Cannot record probe for unknown capability: ${id}`);

    const state = observation.state.trim();
    const authority = observation.authority.trim();
    const evidence = unique(observation.evidence.map((entry) => entry.trim()).filter(Boolean));
    const observedAt = observation.observedAt ?? new Date().toISOString();
    if (!state) throw new Error(`Capability probe state is required for ${id}`);
    if (!authority) throw new Error(`Capability probe authority is required for ${id}`);
    if (evidence.length === 0) throw new Error(`Capability probe evidence is required for ${id}`);
    if (!hasValidObservation(observedAt)) {
      throw new Error(`Capability probe observedAt must be a valid timestamp for ${id}`);
    }

    this.register({
      ...current,
      state,
      available: state === "verified_available",
      observedAt,
      authority,
      evidence,
      metadata: {
        ...(current.metadata ?? {}),
        ...(observation.metadata ?? {}),
      },
    });
    return this.entries.get(id)!;
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

  ingestTools(tools: Array<{ name: string; description?: string }>): void {
    const observedAt = new Date().toISOString();
    for (const tool of tools) {
      this.registerInventory({
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

  ingestSkills(skills: Array<{ name: string; description?: string; enabled?: boolean }>): void {
    const observedAt = new Date().toISOString();
    for (const skill of skills) {
      const descriptor: CapabilityDescriptor = {
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
      };
      if (skill.enabled === false) {
        this.register(descriptor);
      } else {
        this.registerInventory(descriptor);
      }
    }
  }
}
