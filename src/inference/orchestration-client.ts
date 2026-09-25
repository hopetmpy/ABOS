import type BetterSqlite3 from "better-sqlite3";
import type {
  ChatMessage,
  InferenceToolCall,
  InferenceToolDefinition,
} from "../types.js";

export type OrchestrationInferenceTier = "reasoning" | "fast" | "cheap";

export interface OrchestrationInferenceTraceContext {
  correlationId?: string;
  causationId?: string | null;
  sessionId?: string;
  turnId?: string | null;
  goalId?: string | null;
  taskId?: string | null;
  taskType?: string;
}

export interface OrchestrationInferenceRequest {
  tier: OrchestrationInferenceTier;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: InferenceToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | Record<string, unknown>;
  responseFormat?: { type: "json_object" | "text" };
  stream?: boolean;
  trace?: OrchestrationInferenceTraceContext;
}

export interface OrchestrationInferenceResult {
  content: string;
  toolCalls?: InferenceToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost?: {
    totalCostCents: number;
  };
  metadata?: {
    providerId: string;
    modelId: string;
    /** Requested caller tier retained for compatibility. */
    tier: OrchestrationInferenceTier;
    /** Actual cognitive tier selected before delegating model/provider choice to InferenceRouter. */
    effectiveTier?: OrchestrationInferenceTier;
    cognitiveDecisionId?: string;
    latencyMs: number;
    retries?: number;
    failedProviders?: string[];
  };
}

/**
 * Minimal inference contract used by planners, orchestrators, and worker
 * harnesses. Runtime implementations may be legacy or router-backed, but
 * callers do not own provider/model selection authority.
 */
export interface OrchestrationInferenceClient {
  chat(
    params: OrchestrationInferenceRequest,
  ): Promise<OrchestrationInferenceResult>;
  /** Legacy clients bind evidence late; canonical router-backed clients already own a DB. */
  bindEvidenceDatabase?(db: BetterSqlite3.Database): void;
}
