export const CORE_CAPABILITY_TYPES = [
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
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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
