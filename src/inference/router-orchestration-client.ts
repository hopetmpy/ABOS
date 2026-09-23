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
 * Extending UnifiedInferenceClient is intentionally only a type/runtime
 * compatibility bridge for older planner/orchestrator constructors. The empty
 * legacy ProviderRegistry passed to super is never consulted by this override;
 * provider/model authority remains exclusively in InferenceRouter.
 */
export class RouterBackedOrchestrationInferenceClient
  extends UnifiedInferenceClient
  implements OrchestrationInferenceClient {
  constructor(
    private readonly canonical: RouterBackedOrchestrationInferenceOptions,
  ) {
    super(new ProviderRegistry([]));
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
    const tier = mapTier(request.tier);
    const tools = request.toolChoice === "none"
      ? []
      : request.tools;

    appendEvidenceEvent(this.canonical.db, {
      correlationId,
      causationId: request.trace?.causationId ?? null,
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
        mappedSurvivalTier: tier,
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

    const result = await this.canonical.router.route(
      {
        messages: request.messages,
        taskType,
        connectionProvider,
        tier,
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
        latencyMs: result.latencyMs,
        retries: 0,
        failedProviders: [],
      },
    };
    return response;
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
