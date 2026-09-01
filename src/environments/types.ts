import type { CapabilityDescriptor } from "../capabilities/model.js";

export type EnvironmentAvailability =
  | "available"
  | "degraded"
  | "unavailable"
  | "requires_authorization"
  | "unknown";

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

export interface EnvironmentProvider {
  readonly id: string;
  inspect(): Promise<EnvironmentSnapshot>;
  /**
   * Optional provider-native argv execution. Implementations MUST avoid shell
   * interpolation. Providers without this surface can still participate in
   * planning/capability discovery through inspect().
   */
  execute?(args: string[], timeoutMs?: number): Promise<CommandResult>;
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
