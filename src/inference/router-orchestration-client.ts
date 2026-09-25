import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import type {
  InferenceClient,
  InferenceTaskType,
  SurvivalTier,
} from "../types.js";
import {
  appendEvidenceEvent,
  correlationIdFor,
} from "../observability/evidence.js";
import {
  CognitiveCostController,
  type CognitiveRouteCandidate,
  type InferenceResourceEstimate,
} from "../intelligence/cognitive-cost-controller.js";
import { UnifiedInferenceClient } from "./inference-client.js";
import { ProviderRegistry } from "./provider-registry.js";
import type { InferenceRouter } from "./router.js";
import type {
  OrchestrationInferenceClient,
  OrchestrationInferenceRequest,
  OrchestrationInferenceResult,
  OrchestrationInferenceTier,
} from "./orchestration-client.js";

export interface RouterBackedOrchestrationInferenceOptions {
  db: BetterSqlite3.Database;
  router: InferenceRouter;
  runtime: InferenceClient;
  /** Resolve the current explicit runtime connection on every call. */
  getConnectionProvider: () => string | undefined;
  getSessionId?: () => string | undefined;
  getDailyBudgetCents?: () => number | undefined;
}

/**
 * Compatibility surface for planner/worker inference backed by the same
 * ModelRegistry + InferenceRouter + runtime connection authority as main turns.
 *
 * P-026 may adapt only the requested orchestration compute tier here. Provider,
 * model, manual model lock, compatibility, fallback and budgets remain owned by
 * InferenceRouter. No cognitive outcome is manufactured from a successful API
 * response; later domain validation must record quality evidence.
 */
export class RouterBackedOrchestrationInferenceClient
  extends UnifiedInferenceClient
  implements OrchestrationInferenceClient {
  private readonly cognitive: CognitiveCostController;

  constructor(
    private readonly canonical: RouterBackedOrchestrationInferenceOptions,
  ) {
    super(new ProviderRegistry([]));
    this.cognitive = new CognitiveCostController(canonical.db);
  }

  override bindEvidenceDatabase(_db: BetterSqlite3.Database): void {
    // Canonical InferenceRouter was constructed with its durable DB already.
  }

  override async chat(params: any): Promise<any> {
    const request = params as OrchestrationInferenceRequest;
    const connectionProvider = this.canonical.getConnectionProvider();
    if (!connectionProvider) {
      throw new Error(
        "Orchestration inference has no explicit active connection provider. Reconfigure an AI connection before planning or worker inference.",
      );
    }

    const turnId = request.trace?.turnId || ulid();
    const correlationId =
      request.trace?.correlationId || correlationIdFor("turn", turnId);
    const taskType = normalizeTaskType(request.trace?.taskType);
    const taskClass = `orchestration:${taskType}`;
    const tools = request.toolChoice === "none"
      ? []
      : request.tools;

    const tierByRoute = new Map<string, OrchestrationInferenceTier>();
    const selector = (this.canonical.router as any).selectModel;
    const candidates = orchestrationTiers().map((candidateTier) => {
      const mappedTier = mapTier(candidateTier);
      const routeId = cognitiveRouteId(taskType, candidateTier);
      tierByRoute.set(routeId, candidateTier);
      const model = typeof selector === "function"
        ? selector.call(
            this.canonical.router,
            mappedTier,
            taskType,
            connectionProvider,
          )
        : undefined;
      const estimate = safeInferenceEstimate(
        this.cognitive,
        taskType,
        mappedTier,
      );
      const availability = typeof selector === "function"
        ? model
          ? "available"
          : "unavailable"
        : candidateTier === request.tier
          ? "available"
          : "unknown";
      return {
        id: routeId,
        kind: "inference",
        availability,
        expectedCostCents: estimate.averageCostCents,
        expectedLatencyMs: estimate.averageLatencyMs,
        expectedContextTokens: estimate.averageTokens,
        qualityFallback:
          candidateTier === "reasoning" && request.tier !== "reasoning",
        evidence: [
          typeof selector !== "function"
            ? "The injected compatibility router does not expose selectModel(); challenger availability remains UNKNOWN and the requested baseline tier is preserved."
            : model
              ? `InferenceRouter currently resolves ${mappedTier}/${taskType} to model ${model.modelId}.`
              : `InferenceRouter currently has no model for ${mappedTier}/${taskType} on connection ${connectionProvider}.`,
          estimate.sampleCount > 0
            ? `Existing inference ledger estimate uses ${estimate.sampleCount} observed calls.`
            : "No historical inference resource sample exists for this tier/task type; resource cost remains UNKNOWN.",
        ],
        metadata: {
          orchestrationTier: candidateTier,
          mappedSurvivalTier: mappedTier,
          taskType,
          connectionProvider,
          currentlyResolvedModel: model?.modelId ?? null,
        },
      } satisfies CognitiveRouteCandidate;
    });

    const baselineRouteId = cognitiveRouteId(taskType, request.tier);
    const decision = this.cognitive.decide({
      taskClass,
      candidates,
      baselineRouteId,
      correlationId,
      causationId: request.trace?.causationId ?? null,
      goalId: request.trace?.goalId ?? null,
      taskId: request.trace?.taskId ?? null,
      turnId,
    });
    const effectiveTier =
      decision.action === "execute"
        ? tierByRoute.get(decision.selectedRouteId) ?? request.tier
        : request.tier;
    const mappedTier = mapTier(effectiveTier);

    const routeRequested = appendEvidenceEvent(this.canonical.db, {
      correlationId,
      causationId: decision.evidenceEventId,
      eventType: "inference.orchestration_route_requested",
      domain: "inference",
      authorityType: "inference_route",
      authorityId: turnId,
      goalId: request.trace?.goalId ?? null,
      taskId: request.trace?.taskId ?? null,
      turnId,
      epistemicStatus: "observation",
      payload: {
        requestedTier: request.tier,
        effectiveTier,
        mappedSurvivalTier: mappedTier,
        cognitiveDecisionId: decision.id,
        taskType,
        connectionProvider,
        responseFormat: request.responseFormat?.type ?? null,
        toolChoice: typeof request.toolChoice === "string"
          ? request.toolChoice
          : request.toolChoice
            ? "named"
            : "auto",
      },
      provenance: { source: "RouterBackedOrchestrationInferenceClient" },
    });

    let result;
    try {
      result = await this.canonical.router.route(
        {
          messages: request.messages,
          taskType,
          connectionProvider,
          tier: mappedTier,
          sessionId:
            request.trace?.sessionId ||
            this.canonical.getSessionId?.() ||
            "orchestration",
          turnId,
          maxTokens: request.maxTokens,
          tools,
          dailyBudgetCents: this.canonical.getDailyBudgetCents?.(),
        },
        (messages, routeOptions) =>
          this.canonical.runtime.chat(messages, {
            model: routeOptions.model,
            connectionProvider: routeOptions.connectionProvider,
            maxTokens: routeOptions.maxTokens,
            temperature: request.temperature,
            tools: routeOptions.tools,
            signal: routeOptions.signal,
          }),
      );
    } catch (error) {
      this.cognitive.recordExecution(decision.id, {
        evidence: [
          `Inference route failed before a quality-validating domain outcome: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
        metadata: {
          requestedTier: request.tier,
          effectiveTier,
          mappedSurvivalTier: mappedTier,
          routeRequestedEvidenceId: routeRequested.id,
          executionOutcome: "error",
        },
      });
      throw error;
    }

    this.cognitive.recordExecution(decision.id, {
      actualCostCents: result.costCents,
      latencyMs: result.latencyMs,
      contextTokens: result.inputTokens + result.outputTokens,
      evidence: [
        `InferenceRouter executed provider=${result.provider} model=${result.model}.`,
      ],
      metadata: {
        requestedTier: request.tier,
        effectiveTier,
        mappedSurvivalTier: mappedTier,
        routeRequestedEvidenceId: routeRequested.id,
        provider: result.provider,
        model: result.model,
        finishReason: result.finishReason,
      },
    });

    if (request.responseFormat?.type === "json_object") {
      assertJsonObject(result.content);
    }
    if (
      request.toolChoice === "required" &&
      (!Array.isArray(result.toolCalls) || result.toolCalls.length === 0)
    ) {
      throw new Error(
        "Inference completed without a tool call while toolChoice=required.",
      );
    }

    const response: OrchestrationInferenceResult = {
      content: result.content,
      toolCalls: result.toolCalls as OrchestrationInferenceResult["toolCalls"],
      usage: {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.inputTokens + result.outputTokens,
      },
      cost: {
        totalCostCents: result.costCents,
      },
      metadata: {
        providerId: result.provider,
        modelId: result.model,
        tier: request.tier,
        effectiveTier,
        cognitiveDecisionId: decision.id,
        latencyMs: result.latencyMs,
        retries: 0,
        failedProviders: [],
      },
    };
    return response;
  }
}

function orchestrationTiers(): OrchestrationInferenceTier[] {
  return ["reasoning", "fast", "cheap"];
}

function cognitiveRouteId(
  taskType: InferenceTaskType,
  tier: OrchestrationInferenceTier,
): string {
  return `inference:${taskType}:${tier}`;
}

function safeInferenceEstimate(
  controller: CognitiveCostController,
  taskType: InferenceTaskType,
  tier: SurvivalTier,
): InferenceResourceEstimate {
  try {
    return controller.estimateInferenceResources(taskType, tier);
  } catch {
    // Compatibility/raw test embeddings may not expose the inference ledger.
    // Preserve UNKNOWN rather than inventing zero cost.
    return {
      sampleCount: 0,
      averageCostCents: null,
      averageLatencyMs: null,
      averageTokens: null,
    };
  }
}

function mapTier(tier: OrchestrationInferenceTier): SurvivalTier {
  switch (tier) {
    case "reasoning":
      return "high";
    case "cheap":
      return "low_compute";
    case "fast":
    default:
      return "normal";
  }
}

function normalizeTaskType(value: string | undefined): InferenceTaskType {
  switch (value) {
    case "planning":
    case "heartbeat_triage":
    case "safety_check":
    case "summarization":
    case "agent_turn":
      return value;
    default:
      return "agent_turn";
  }
}

function assertJsonObject(content: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Inference response did not satisfy responseFormat=json_object: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "Inference response did not satisfy responseFormat=json_object: top-level value is not an object.",
    );
  }
}
