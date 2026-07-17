declare module "@conway/automaton/config.js" {
  export interface AutomatonCliConfig {
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

  export function loadConfig(): AutomatonCliConfig | null;
  export function resolvePath(p: string): string;
}

declare module "@conway/automaton/state/database.js" {
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

  export interface AutomatonCliDatabase {
    getAgentState(): string;
    getTurnCount(): number;
    getInstalledTools(): CliInstalledTool[];
    getHeartbeatEntries(): CliHeartbeatEntry[];
    getRecentTurns(limit: number): CliTurn[];
    raw: unknown;
    close(): void;
  }

  export function createDatabase(path: string): AutomatonCliDatabase;

  // ── Venture Governance ──
  export type VentureStatus =
    | "proposed"
    | "approved"
    | "rejected"
    | "withdrawn"
    | "completed";

  export interface VentureProposalRow {
    id: string;
    title: string;
    summary: string;
    plan: string;
    estimatedCostCents: number;
    approvedBudgetCents: number | null;
    spentCents: number;
    revenueModel: string;
    needsFromCreator: string[];
    status: VentureStatus;
    decisionNote: string | null;
    createdAt: string;
    decidedAt: string | null;
  }

  export function getVentureProposalById(
    db: unknown,
    id: string,
  ): VentureProposalRow | undefined;
  export function listVentureProposals(
    db: unknown,
    status?: VentureStatus,
  ): VentureProposalRow[];
  export function decideVentureProposal(
    db: unknown,
    id: string,
    decision: "approved" | "rejected",
    options?: { budgetCents?: number; note?: string },
  ): VentureProposalRow | undefined;

  export type CreatorRequestKind =
    | "identity_verification"
    | "account_ownership"
    | "funding"
    | "api_access"
    | "legal"
    | "other";

  export type CreatorRequestStatus = "open" | "fulfilled" | "declined";

  export interface CreatorRequestRow {
    id: string;
    ventureId: string | null;
    kind: CreatorRequestKind;
    description: string;
    status: CreatorRequestStatus;
    resolution: string | null;
    createdAt: string;
    resolvedAt: string | null;
  }

  export function listCreatorRequests(
    db: unknown,
    status?: CreatorRequestStatus,
  ): CreatorRequestRow[];
  export function resolveCreatorRequest(
    db: unknown,
    id: string,
    status: "fulfilled" | "declined",
    resolution?: string,
  ): CreatorRequestRow | undefined;

  export function insertWakeEvent(
    db: unknown,
    source: string,
    reason: string,
    payload?: object,
  ): void;
}
