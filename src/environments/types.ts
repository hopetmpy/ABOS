import type { CapabilityDescriptor } from "../capabilities/model.js";

export type EnvironmentAvailability =
  | "available"
  | "degraded"
  | "unavailable"
  | "requires_authorization"
  | "unknown";

/**
 * Common operations ABOS understands today. This is documentation/discovery,
 * not an allowlist: providers may expose any additional operation string.
 */
export const CORE_ENVIRONMENT_OPERATIONS = [
  "inspect",
  "can_satisfy",
  "estimate",
  "prepare",
  "provision",
  "bootstrap",
  "execute",
  "health",
  "collect",
  "resize",
  "suspend",
  "resume",
  "destroy",
  "recover",
  "reconcile",
] as const;

export type CoreEnvironmentOperation =
  (typeof CORE_ENVIRONMENT_OPERATIONS)[number];

/** Open by design: future providers can declare operations unknown to this runtime. */
export type EnvironmentOperation = string;

export type EnvironmentResourceStatus =
  | "requested"
  | "preparing"
  | "provisioning"
  | "ready"
  | "bootstrapping"
  | "running"
  | "degraded"
  | "suspended"
  | "recovering"
  | "terminating"
  | "terminated"
  | "failed"
  | "unknown";

export const CORE_RETENTION_POLICIES = [
  "ephemeral",
  "until_goal_complete",
  "persistent",
  "manual_retention",
] as const;

export type CoreEnvironmentRetentionPolicy =
  (typeof CORE_RETENTION_POLICIES)[number];

/** Open by design so future lifecycle policies do not require an orchestrator rewrite. */
export type EnvironmentRetentionPolicy = string;

export interface EnvironmentSnapshot {
  id: string;
  label: string;
  availability: EnvironmentAvailability;
  capabilities: CapabilityDescriptor[];
  evidence: string[];
  costModel?: string | null;
  constraints: string[];
  metadata?: Record<string, unknown>;
  observedAt: string;
}

export interface EnvironmentRequirements {
  requiredCapabilities: string[];
  requiredOperations?: EnvironmentOperation[];
  preferredEnvironment?: string | null;
  /**
   * Contextual exclusions for this specific path/attempt. This is not a global
   * provider denylist; mobility uses it to avoid repeating an equivalent failed
   * environment until material conditions change.
   */
  excludedEnvironmentIds?: string[];
  requiredPermissions?: string[];
  maxEstimatedCostCents?: number | null;
  expectedDurationMs?: number | null;
  region?: string | null;
  goalId?: string | null;
  pathId?: string | null;
  taskId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EnvironmentSatisfaction {
  /**
   * true = provider says it can satisfy the request;
   * false = provider has evidence it cannot;
   * null = unknown, which must never be interpreted as impossible.
   */
  satisfiable: boolean | null;
  capabilityFit?: number | null;
  missingCapabilities?: string[];
  constraints?: string[];
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export const CORE_ENVIRONMENT_COST_COVERAGE = [
  "complete",
  "partial",
  "unknown",
] as const;

export type CoreEnvironmentCostCoverage =
  (typeof CORE_ENVIRONMENT_COST_COVERAGE)[number];

/** Open by design so providers can describe richer future estimate coverage. */
export type EnvironmentCostEstimateCoverage = string;

export interface EnvironmentEstimate {
  estimatedCostCents?: number | null;
  /**
   * Whether estimatedCostCents covers the cost authority relevant to an
   * explicit budget. "partial" evidence remains useful for ranking/telemetry
   * but must not be treated as a proven total cost ceiling.
   */
  costCoverage?: EnvironmentCostEstimateCoverage;
  startupLatencyMs?: number | null;
  expectedExecutionMs?: number | null;
  reliability?: number | null;
  reusableResourceCount?: number | null;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentPreparationResult {
  ready: boolean;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentProvisionRequest extends EnvironmentRequirements {
  resourceId: string;
  resourceType: string;
  retentionPolicy: EnvironmentRetentionPolicy;
  /** Selector estimate captured before provisioning; provider evidence may refine it. */
  selectionEstimateCents?: number | null;
  selectionEvidence?: string[];
}

export interface EnvironmentProvisionResult {
  externalId?: string | null;
  type?: string;
  status?: EnvironmentResourceStatus;
  region?: string | null;
  capabilities?: string[];
  estimatedCostCents?: number | null;
  actualCostCents?: number;
  credentialsReference?: string | null;
  providerState?: string | null;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentMutationResult {
  status?: EnvironmentResourceStatus;
  providerState?: string | null;
  actualCostCents?: number;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentHealthResult {
  healthy: boolean | null;
  status?: EnvironmentResourceStatus;
  providerState?: string | null;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentCollectionResult {
  artifacts: string[];
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentResource {
  id: string;
  provider: string;
  externalId: string | null;
  type: string;
  goalId: string | null;
  pathId: string | null;
  taskId: string | null;
  status: EnvironmentResourceStatus;
  region: string | null;
  capabilities: string[];
  estimatedCostCents: number | null;
  actualCostCents: number;
  /** Reference only. Raw credentials/secrets must never be persisted here. */
  credentialsReference: string | null;
  retentionPolicy: EnvironmentRetentionPolicy;
  providerState: string | null;
  evidence: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastHealthCheck: string | null;
}

export interface EnvironmentReconcileResult {
  resource: EnvironmentResource;
  actualExists: boolean | null;
  action: string;
  evidence?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvironmentProvider {
  readonly id: string;

  /**
   * Additional provider-native operations. Intentionally open-ended:
   * central orchestration must not require provider names or a fixed global list.
   */
  readonly operations?: readonly EnvironmentOperation[];

  inspect(): Promise<EnvironmentSnapshot>;
  canSatisfy?(
    requirements: EnvironmentRequirements,
    snapshot?: EnvironmentSnapshot,
  ): Promise<EnvironmentSatisfaction>;
  estimate?(
    requirements: EnvironmentRequirements,
    snapshot?: EnvironmentSnapshot,
  ): Promise<EnvironmentEstimate>;
  prepare?(
    requirements: EnvironmentRequirements,
  ): Promise<EnvironmentPreparationResult>;
  provision?(
    request: EnvironmentProvisionRequest,
  ): Promise<EnvironmentProvisionResult>;
  bootstrap?(
    resource: EnvironmentResource,
    requirements: EnvironmentRequirements,
  ): Promise<EnvironmentMutationResult>;

  /**
   * Provider-native argv execution. Existing behavior is preserved.
   * Implementations MUST avoid shell interpolation.
   */
  execute?(args: string[], timeoutMs?: number): Promise<CommandResult>;

  health?(resource: EnvironmentResource): Promise<EnvironmentHealthResult>;
  collect?(resource: EnvironmentResource): Promise<EnvironmentCollectionResult>;
  resize?(
    resource: EnvironmentResource,
    changes: Record<string, unknown>,
  ): Promise<EnvironmentMutationResult>;
  suspend?(resource: EnvironmentResource): Promise<EnvironmentMutationResult>;
  resume?(resource: EnvironmentResource): Promise<EnvironmentMutationResult>;
  destroy?(resource: EnvironmentResource): Promise<EnvironmentMutationResult>;
  recover?(resource: EnvironmentResource): Promise<EnvironmentMutationResult>;
  reconcile?(
    resource: EnvironmentResource,
  ): Promise<EnvironmentReconcileResult>;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type EnvironmentCommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<CommandResult>;
