/**
 * Inference Router
 *
 * Routes inference requests through the model registry using
 * tier-based selection, budget enforcement, and provider-specific
 * message transformation.
 */

import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import type {
  InferenceRequest,
  InferenceResult,
  ModelEntry,
  SurvivalTier,
  InferenceTaskType,
  ModelProvider,
  ChatMessage,
  ModelPreference,
} from "../types.js";
import { ModelRegistry } from "./registry.js";
import { InferenceBudgetTracker } from "./budget.js";
import { DEFAULT_ROUTING_MATRIX, TASK_TIMEOUTS } from "./types.js";

type Database = BetterSqlite3.Database;

export interface InferenceRouterOptions {
  /**
   * Return false only when a connection adapter is known to be incompatible
   * with the model. Undefined preserves open-world semantics: unknown is not
   * treated as impossible.
   */
  supportsConnectionModel?: (
    connectionProvider: string,
    model: ModelEntry,
  ) => boolean | undefined;
}

export class InferenceRouter {
  private db: Database;
  private registry: ModelRegistry;
  private budget: InferenceBudgetTracker;
  private readonly options: InferenceRouterOptions;

  constructor(
    db: Database,
    registry: ModelRegistry,
    budget: InferenceBudgetTracker,
    options: InferenceRouterOptions = {},
  ) {
    this.db = db;
    this.registry = registry;
    this.budget = budget;
    this.options = options;
  }

  /**
   * Route an inference request: discover ordered candidates, enforce budget,
   * call inference, record cost, and optionally continue along a different
   * compatible model path when the selected model fails.
   */
  async route(
    request: InferenceRequest,
    inferenceChat: (messages: any[], options: any) => Promise<any>,
  ): Promise<InferenceResult> {
    const {
      messages,
      taskType,
      tier,
      sessionId,
      turnId,
      tools,
      connectionProvider,
    } = request;

    const fallbackEnabled = this.budget.config.enableModelFallback;
    const candidates = this.collectCandidateModels(
      tier,
      taskType,
      connectionProvider,
      Array.isArray(tools) && tools.length > 0,
      fallbackEnabled,
    );

    if (candidates.length === 0) {
      return {
        content: "",
        model: "none",
        provider: connectionProvider || "other",
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        latencyMs: 0,
        finishReason: "error",
        toolCalls: undefined,
      };
    }

    const preference = this.getPreference(tier, taskType);
    const timeout = TASK_TIMEOUTS[taskType] || 120_000;
    const estimatedTokens = messages.reduce(
      (sum, message) => sum + (message.content?.length || 0) / 4,
      0,
    );

    let lastError: unknown;
    let lastBudgetFailure:
      | { model: ModelEntry; reason: string }
      | undefined;

    for (const model of candidates) {
      const estimatedCostCents = Math.ceil(
        (estimatedTokens / 1000) * model.costPer1kInput / 100 +
        (request.maxTokens || 1000) / 1000 * model.costPer1kOutput / 100,
      );

      const budgetCheck = this.budget.checkBudget(
        estimatedCostCents,
        model.modelId,
      );
      if (!budgetCheck.allowed) {
        lastBudgetFailure = {
          model,
          reason: budgetCheck.reason || "budget limit exceeded",
        };
        if (fallbackEnabled) continue;
        return this.buildBudgetExceededResult(
          model,
          connectionProvider,
          `Budget exceeded: ${lastBudgetFailure.reason}`,
        );
      }

      if (sessionId && this.budget.config.sessionBudgetCents > 0) {
        const sessionCost = this.budget.getSessionCost(sessionId);
        if (
          sessionCost + estimatedCostCents >
          this.budget.config.sessionBudgetCents
        ) {
          const reason =
            `Session budget exceeded: ${sessionCost}c spent + ` +
            `${estimatedCostCents}c estimated > ` +
            `${this.budget.config.sessionBudgetCents}c limit`;
          lastBudgetFailure = { model, reason };
          if (fallbackEnabled) continue;
          return this.buildBudgetExceededResult(
            model,
            connectionProvider,
            reason,
          );
        }
      }

      const expectedProvider = connectionProvider || model.provider;
      const transformedMessages = this.transformMessagesForProvider(
        messages,
        expectedProvider,
      );
      const maxTokens =
        request.maxTokens || preference?.maxTokens || model.maxTokens;
      const inferenceOptions: any = {
        model: model.modelId,
        maxTokens,
        tools,
        connectionProvider,
      };

      const startTime = Date.now();
      let response: any;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        inferenceOptions.signal = controller.signal;
        response = await inferenceChat(
          transformedMessages,
          inferenceOptions,
        );
      } catch (error: any) {
        const latencyMs = Date.now() - startTime;

        // The task deadline is authoritative. Once it expires, trying another
        // model would silently multiply the requested task timeout.
        if (controller.signal.aborted && error?.name === "AbortError") {
          return {
            content: `Inference timeout after ${timeout}ms`,
            model: model.modelId,
            provider: connectionProvider || model.provider,
            inputTokens: 0,
            outputTokens: 0,
            costCents: 0,
            latencyMs,
            finishReason: "timeout",
          };
        }

        lastError = error;
        if (fallbackEnabled) continue;
        throw error;
      } finally {
        clearTimeout(timer);
      }

      const latencyMs = Date.now() - startTime;
      const actualProvider = response.provider || expectedProvider;
      const inputTokens = response.usage?.promptTokens || 0;
      const outputTokens = response.usage?.completionTokens || 0;
      const actualCostCents = Math.ceil(
        (inputTokens / 1000) * model.costPer1kInput / 100 +
        (outputTokens / 1000) * model.costPer1kOutput / 100,
      );

      this.budget.recordCost({
        sessionId,
        turnId: turnId || null,
        model: model.modelId,
        provider: actualProvider,
        inputTokens,
        outputTokens,
        costCents: actualCostCents,
        latencyMs,
        tier,
        taskType,
        cacheHit: false,
      });

      return {
        content: response.message?.content || "",
        model: model.modelId,
        provider: actualProvider,
        inputTokens,
        outputTokens,
        costCents: actualCostCents,
        latencyMs,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason || "stop",
      };
    }

    if (lastError) throw lastError;

    if (lastBudgetFailure) {
      return this.buildBudgetExceededResult(
        lastBudgetFailure.model,
        connectionProvider,
        `Budget exceeded: ${lastBudgetFailure.reason}`,
      );
    }

    return {
      content: "",
      model: "none",
      provider: connectionProvider || "other",
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      latencyMs: 0,
      finishReason: "error",
      toolCalls: undefined,
    };
  }

  /**
   * Select the best model for a given tier and task type.
   *
   * Priority for agent_turn:
   *   1. Explicit active model when compatible with the current survival tier
   *      (externally-funded/free models stay eligible at every tier)
   *   2. Tier-specific configured fallback
   *   3. Static routing-matrix candidate
   *
   * Specialized/background task types continue to use the routing matrix first.
   */
  selectModel(
    tier: SurvivalTier,
    taskType: InferenceTaskType,
    connectionProvider?: string,
  ): ModelEntry | null {
    const TIER_ORDER: Record<string, number> = {
      dead: 0, critical: 1, low_compute: 2, normal: 3, high: 4,
    };

    const tierRank = TIER_ORDER[tier] ?? 0;

    // 1. Try routing-matrix candidates
    // An explicitly selected active model is authoritative for the main agent
    // turn. Static routing remains the fallback and continues to govern
    // background/specialized task types.
    if (taskType === "agent_turn") {
      const configured = this.selectConfiguredAgentModel(
        tier,
        connectionProvider,
      );
      if (configured) return configured;
    }

    const preference = this.getPreference(tier, taskType);
    if (preference && preference.candidates.length > 0) {
      for (const candidateId of preference.candidates) {
        const entry = this.registry.get(candidateId);
        if (
          entry &&
          entry.enabled &&
          this.isConnectionCompatible(connectionProvider, entry)
        ) {
          return entry;
        }
      }
    }

    // 2. Fall back to user-configured models.
    //    This handles local/Ollama setups where routing-matrix models are absent.
    const strategy = this.budget.config;
    const fallbackIds: (string | undefined)[] =
      tier === "critical" || tier === "dead"
        ? [strategy.criticalModel, strategy.inferenceModel, strategy.lowComputeModel]
        : [strategy.inferenceModel, strategy.lowComputeModel, strategy.criticalModel];

    for (const modelId of fallbackIds) {
      if (!modelId) continue;
      const entry = this.registry.get(modelId);
      if (!entry || !entry.enabled) continue;
      const isFree = entry.costPer1kInput === 0 && entry.costPer1kOutput === 0;
      const tierOk = tierRank >= (TIER_ORDER[entry.tierMinimum] ?? 0);
      if (
        (isFree || tierOk) &&
        this.isConnectionCompatible(connectionProvider, entry)
      ) {
        return entry;
      }
    }

    return null;
  }

  private selectConfiguredAgentModel(
    tier: SurvivalTier,
    connectionProvider?: string,
  ): ModelEntry | null {
    const TIER_ORDER: Record<string, number> = {
      dead: 0, critical: 1, low_compute: 2, normal: 3, high: 4,
    };
    const tierRank = TIER_ORDER[tier] ?? 0;
    const strategy = this.budget.config;

    // The explicitly selected model remains authoritative at every survival
    // tier when its cost is external to ABOS (Codex subscription, Ollama, etc.).
    // A paid model still yields to the survival fallbacks when its tier minimum
    // is above the current tier.
    const active = this.registry.get(strategy.inferenceModel);
    if (
      active?.enabled &&
      active.costPer1kInput === 0 &&
      active.costPer1kOutput === 0 &&
      this.isConnectionCompatible(connectionProvider, active)
    ) {
      return active;
    }

    const candidateIds =
      tier === "high" || tier === "normal"
        ? [strategy.inferenceModel]
        : tier === "low_compute"
          ? [strategy.lowComputeModel, strategy.inferenceModel]
          : [strategy.criticalModel, strategy.lowComputeModel, strategy.inferenceModel];

    const seen = new Set<string>();
    for (const modelId of candidateIds) {
      if (!modelId || seen.has(modelId)) continue;
      seen.add(modelId);

      const entry = this.registry.get(modelId);
      if (!entry || !entry.enabled) continue;

      const isExternallyFunded = entry.costPer1kInput === 0 && entry.costPer1kOutput === 0;
      const tierOk = tierRank >= (TIER_ORDER[entry.tierMinimum] ?? 0);
      if (
        (isExternallyFunded || tierOk) &&
        this.isConnectionCompatible(connectionProvider, entry)
      ) {
        return entry;
      }
    }

    return null;
  }

  private collectCandidateModels(
    tier: SurvivalTier,
    taskType: InferenceTaskType,
    connectionProvider: string | undefined,
    requiresTools: boolean,
    includeFallbacks: boolean,
  ): ModelEntry[] {
    const candidates: ModelEntry[] = [];
    const seen = new Set<string>();

    const add = (
      entry: ModelEntry | undefined,
      enforceTierEligibility: boolean,
    ) => {
      if (!entry || !entry.enabled || seen.has(entry.modelId)) return;
      if (requiresTools && !entry.supportsTools) return;
      if (!this.isConnectionCompatible(connectionProvider, entry)) return;
      if (
        enforceTierEligibility &&
        !this.isTierEligible(tier, entry)
      ) {
        return;
      }
      seen.add(entry.modelId);
      candidates.push(entry);
    };

    const primary = this.selectModel(
      tier,
      taskType,
      connectionProvider,
    );
    add(primary || undefined, false);

    if (!includeFallbacks) return candidates;

    // Existing configured and routing preferences remain first-class hints.
    // They establish order, but do not form a closed universe of possibilities.
    const preference = this.getPreference(tier, taskType);
    for (const modelId of preference?.candidates || []) {
      add(this.registry.get(modelId), false);
    }

    const strategy = this.budget.config;
    const configuredIds =
      tier === "critical" || tier === "dead"
        ? [
            strategy.criticalModel,
            strategy.lowComputeModel,
            strategy.inferenceModel,
          ]
        : [
            strategy.inferenceModel,
            strategy.lowComputeModel,
            strategy.criticalModel,
          ];

    for (const modelId of configuredIds) {
      if (modelId) add(this.registry.get(modelId), true);
    }

    // Open discovery: append every enabled registry model that is actually
    // executable for the current tier/capability/known connection contract.
    // No hard-coded provider/model ceiling is introduced.
    for (const model of this.registry.getAll()) {
      add(model, true);
    }

    return candidates;
  }

  private isTierEligible(
    tier: SurvivalTier,
    model: ModelEntry,
  ): boolean {
    const TIER_ORDER: Record<string, number> = {
      dead: 0,
      critical: 1,
      low_compute: 2,
      normal: 3,
      high: 4,
    };
    const externallyFunded =
      model.costPer1kInput === 0 && model.costPer1kOutput === 0;
    if (externallyFunded) return true;
    return (
      (TIER_ORDER[tier] ?? 0) >=
      (TIER_ORDER[model.tierMinimum] ?? 0)
    );
  }

  private isConnectionCompatible(
    connectionProvider: string | undefined,
    model: ModelEntry,
  ): boolean {
    if (!connectionProvider) return true;
    const knownCompatibility =
      this.options.supportsConnectionModel?.(
        connectionProvider,
        model,
      );
    // Open-world rule: only a known false excludes a model.
    return knownCompatibility !== false;
  }

  private buildBudgetExceededResult(
    model: ModelEntry,
    connectionProvider: string | undefined,
    content: string,
  ): InferenceResult {
    return {
      content,
      model: model.modelId,
      provider: connectionProvider || model.provider,
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      latencyMs: 0,
      finishReason: "budget_exceeded",
      toolCalls: undefined,
    };
  }

  /**
   * Transform messages for a specific provider.
   * Handles Anthropic's alternating-role requirement.
   */
  transformMessagesForProvider(messages: ChatMessage[], provider: ModelProvider): ChatMessage[] {
    if (messages.length === 0) {
      throw new Error("Cannot route inference with empty message array");
    }

    if (provider === "anthropic") {
      return this.fixAnthropicMessages(messages);
    }

    // For OpenAI/Conway, merge consecutive same-role messages
    return this.mergeConsecutiveSameRole(messages);
  }

  /**
   * Fix messages for Anthropic's API requirements:
   * 1. Extract system messages
   * 2. Merge consecutive same-role messages
   * 3. Merge consecutive tool messages into a single user message
   *    with multiple tool_result content blocks
   */
  private fixAnthropicMessages(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];

    for (const msg of messages) {
      // System messages are handled separately by the Anthropic client
      if (msg.role === "system") {
        result.push(msg);
        continue;
      }

      // Tool messages become user messages with tool_result content
      if (msg.role === "tool") {
        const last = result[result.length - 1];
        // If previous message was also a tool (now a user), merge into it
        if (last && last.role === "user" && (last as any)._toolResultMerged) {
          // Append to the merged content
          last.content = last.content + "\n[tool_result:" + (msg.tool_call_id || "unknown") + "] " + msg.content;
          continue;
        }
        // Otherwise create a new user message
        const userMsg: ChatMessage & { _toolResultMerged?: boolean } = {
          role: "user",
          content: "[tool_result:" + (msg.tool_call_id || "unknown") + "] " + msg.content,
          _toolResultMerged: true,
        };
        result.push(userMsg);
        continue;
      }

      // For user/assistant: merge with previous if same role
      const last = result[result.length - 1];
      if (last && last.role === msg.role) {
        last.content = (last.content || "") + "\n" + (msg.content || "");
        if (msg.tool_calls) {
          last.tool_calls = [...(last.tool_calls || []), ...msg.tool_calls];
        }
        continue;
      }

      result.push({ ...msg });
    }

    // Clean up internal markers
    for (const msg of result) {
      delete (msg as any)._toolResultMerged;
    }

    return result;
  }

  /**
   * Merge consecutive messages with the same role.
   */
  private mergeConsecutiveSameRole(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];

    for (const msg of messages) {
      const last = result[result.length - 1];
      if (last && last.role === msg.role && msg.role !== "system" && msg.role !== "tool") {
        last.content = (last.content || "") + "\n" + (msg.content || "");
        if (msg.tool_calls) {
          last.tool_calls = [...(last.tool_calls || []), ...msg.tool_calls];
        }
        continue;
      }
      result.push({ ...msg });
    }

    return result;
  }

  private getPreference(tier: SurvivalTier, taskType: InferenceTaskType): ModelPreference | undefined {
    return DEFAULT_ROUTING_MATRIX[tier]?.[taskType];
  }
}
