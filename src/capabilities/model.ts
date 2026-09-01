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

export interface CapabilityDescriptor {
  id: string;
  type: CapabilityType;
  provider: string;
  description: string;
  requirements: string[];
  permissions: string[];
  environment?: string | null;
  available: boolean;
  inputs?: string[];
  outputs?: string[];
  estimatedCostCents?: number | null;
  evidence?: string[];
  metadata?: Record<string, unknown>;
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
