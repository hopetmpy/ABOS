export type CapabilityType =
  | "tool"
  | "skill"
  | "cli"
  | "package"
  | "sdk"
  | "api"
  | "service"
  | "executor"
  | "worker"
  | "browser"
  | "cloud_resource"
  | "script"
  | "custom";

/**
 * Canonical core lifecycle labels used by ABOS runtime-truth decisions.
 *
 * The state space is intentionally open: future providers may introduce a
 * more specific state without forcing the core to pretend the universe is
 * closed. Only `verified_available` is sufficient for an execution-ready
 * claim.
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
  requirements: string[];
  permissions: string[];
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

export interface CapabilityRequest {
  requirement: string;
  preferredEnvironment?: string | null;
  requiredPermissions?: string[];
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
