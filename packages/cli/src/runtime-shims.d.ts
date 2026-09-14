declare module "@abos/runtime/config.js" {
  export interface AbosCliConfig {
    name: string;
    walletAddress: string;
    creatorAddress: string;
    sandboxId: string;
    dbPath: string;
    inferenceModel: string;
    conwayApiUrl: string;
    conwayApiKey: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    socialRelayUrl?: string;
  }

  export function loadConfig(): AbosCliConfig | null;
  export function getConfigPath(): string;
  export function resolvePath(p: string): string;
}

declare module "@abos/runtime/state/database.js" {
  export interface CliToolCall {
    name: string;
    result: string;
    error?: string;
  }

  export interface CliTurn {
    id: string;
    timestamp: string;
    state: string;
    input?: string;
    inputSource?: string;
    thinking: string;
    toolCalls: CliToolCall[];
    tokenUsage: { totalTokens: number };
    costCents: number;
  }

  export interface CliHeartbeatEntry {
    enabled: boolean;
  }

  export interface CliInstalledTool {
    id: string;
    name: string;
  }

  export interface AbosCliDatabase {
    raw: any;
    getAgentState(): string;
    getTurnCount(): number;
    getInstalledTools(): CliInstalledTool[];
    getHeartbeatEntries(): CliHeartbeatEntry[];
    getRecentTurns(limit: number): CliTurn[];
    close(): void;
  }

  export function createDatabase(path: string): AbosCliDatabase;
}

declare module "@abos/runtime/agent/policy-authorization.js" {
  export type PolicyAuthorizationAction = "approve" | "revoke";

  export interface PendingPolicyAuthorization {
    id: string;
    toolName: string;
    scopeHash: string;
    reason: string;
    createdAt: string;
  }

  export interface PolicyAuthorizationChallenge {
    version: "abos.policy-authorization.v1";
    action: PolicyAuthorizationAction;
    decisionId: string;
    toolName: string;
    scopeHash: string;
    creatorAddress: string;
    expiresAt: string;
    message: string;
  }

  export function listPendingPolicyAuthorizations(db: any): PendingPolicyAuthorization[];
  export function buildPolicyAuthorizationChallenge(
    db: any,
    decisionId: string,
    action: PolicyAuthorizationAction,
    expiresAt: string,
  ): PolicyAuthorizationChallenge;
  export function applyCreatorPolicyAuthorization(
    db: any,
    params: {
      decisionId: string;
      action: PolicyAuthorizationAction;
      expiresAt: string;
      signature: string;
    },
  ): Promise<{
    decisionId: string;
    action: PolicyAuthorizationAction;
    lifecycleState: "approved" | "revoked";
    creatorAddress: string;
    expiresAt: string;
  }>;
}
