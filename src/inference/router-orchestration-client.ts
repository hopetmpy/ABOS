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
 * It deliberately has no provider registry or cross-provider failover policy.
 */
export class RouterBackedOrchestrationInferenceClient
  implements OrchestrationInferenceClient {
  constructor(
    private readonly options: RouterBackedOrchestrationInferenceOptions,
  ) {}

  async chat(
    params: OrchestrationInferenceRequest,
  ): Promise<OrchestrationInferenceResult> {
    const connectionProvider = this.options.getConnectionProvider();
    if (!connectionProvider) {
      throw new Error(
        "Orchestration inference has no explicit active connection provider. Reconfigure an AI connection before planning or worker inference.",
      );
    }

    const turnId = params.trace?.turnId || ulid();
    const correlationId =
      params.trace?.correlationId || correlationIdFor("turn", turnId);
    const taskType = normalizeTaskType(params.trace?.taskType);
    const tier = mapTier(params.tier);
    const tools = params.toolChoice === "none"
      ? []
      : params.tools;

    appendEvidenceEvent(this.options.db, {
      correlationId,
      causationId: params.trace?.causationId ?? null,
      eventType: "inference.orchestration_route_requested",
      domain: "inference",
      authorityType: "inference_route",
      authorityId: turnId,
      goalId: params.trace?.goalId ?? null,
      taskId: params.trace?.taskId ?? null,
      turnId,
      epistemicStatus: "observation",
      payload: {
        requestedTier: params.tier,
        mappedSurvivalTier: tier,
        taskType,
        connectionProvider,
        responseFormat: params.responseFormat?.type ?? null,
        toolChoice: typeof params.toolChoice === "string"
          ? params.toolChoice
          : params.toolChoice
            ? "named"
            : "auto",
      },
      provenance: { source: "RouterBackedOrchestrationInferenceClient" },
    });

    const result = await this.options.router.route(
      {
        messages: params.messages,
        taskType,
        connectionProvider,
        tier,
        sessionId:
          params.trace?.sessionId ||
          this.options.getSessionId?.() ||
          "orchestration",
        turnId,
        maxTokens: params.maxTokens,
        tools,
        dailyBudgetCents: this.options.getDailyBudgetCents?.(),
      },
      (messages, routeOptions) =>
        this.options.runtime.chat(messages, {
          model: routeOptions.model,
          connectionProvider: routeOptions.connectionProvider,
          maxTokens: routeOptions.maxTokens,
          temperature: params.temperature,
          tools: routeOptions.tools,
          signal: routeOptions.signal,
        }),
    );

    if (params.responseFormat?.type === "json_object") {
      assertJsonObject(result.content);
    }
    if (
      params.toolChoice === "required" &&
      (!Array.isArray(result.toolCalls) || result.toolCalls.length === 0)
    ) {
      throw new Error(
        "Inference completed without a tool call while toolChoice=required.",
      );
    }

    return {
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
        tier: params.tier,
        latencyMs: result.latencyMs,
        retries: 0,
        failedProviders: [],
      },
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
