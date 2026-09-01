/**
 * Codex control-plane types.
 *
 * These mirror only the stable fields ABOS consumes from the Codex app-server.
 * Unknown upstream fields are intentionally tolerated so protocol evolution does
 * not force ABOS to hard-code the complete Codex schema.
 */

export interface CodexReasoningEffortOption {
  reasoningEffort: string;
  description: string;
}

export interface CodexServiceTier {
  id: string;
  name: string;
  description: string;
}

export interface CodexModelDescriptor {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: CodexReasoningEffortOption[];
  inputModalities?: string[];
  serviceTiers?: CodexServiceTier[];
  defaultServiceTier?: string | null;
  supportsPersonality?: boolean;
  modelSpecialty?: string | null;
  multiAgentVersion?: string | null;
  upgrade?: string | null;
  [key: string]: unknown;
}

export interface CodexModelListResponse {
  data: CodexModelDescriptor[];
  nextCursor?: string | null;
}

export interface CodexAccountInfo {
  type?: string;
  email?: string;
  planType?: string;
  [key: string]: unknown;
}

export interface CodexAccountReadResponse {
  account: CodexAccountInfo | null;
  requiresOpenaiAuth?: boolean;
  [key: string]: unknown;
}

export interface CodexDeviceCodeLoginResponse {
  type: "chatgptDeviceCode";
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

export interface CodexLoginCompletedNotification {
  loginId: string;
  success: boolean;
  error?: string | null;
}

export interface CodexCatalogSnapshot {
  schemaVersion: 1;
  refreshedAt: string;
  includeHidden: boolean;
  models: CodexModelDescriptor[];
}
