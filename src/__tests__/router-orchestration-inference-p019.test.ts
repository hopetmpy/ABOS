import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbosDatabase, InferenceClient } from "../types.js";
import type { InferenceRouter } from "../inference/router.js";
import { RouterBackedOrchestrationInferenceClient } from "../inference/router-orchestration-client.js";
import { createTestDb } from "./mocks.js";
import { getEvidenceByCorrelation } from "../observability/evidence.js";

function routedResult(overrides: Record<string, unknown> = {}) {
  return {
    content: "ok",
    model: "codex:gpt-5.6-sol",
    provider: "codex",
    inputTokens: 12,
    outputTokens: 8,
    costCents: 0,
    latencyMs: 25,
    finishReason: "stop",
    toolCalls: undefined,
    ...overrides,
  };
}

describe("P-019 router-backed orchestration inference", () => {
  let db: AbosDatabase;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it("uses the live explicit connection provider on every call and never owns a provider fallback list", async () => {
    let provider = "codex";
    const route = vi.fn(async (request: any, chat: any) => {
      const response = await chat(request.messages, {
        model: provider === "codex" ? "codex:gpt-5.6-sol" : "openai:gpt-5.6-sol",
        connectionProvider: request.connectionProvider,
        maxTokens: request.maxTokens,
        tools: request.tools,
      });
      return routedResult({
        content: response.message.content,
        model: provider === "codex" ? "codex:gpt-5.6-sol" : "openai:gpt-5.6-sol",
        provider,
      });
    });
    const runtimeChat = vi.fn(async (_messages: any[], options: any) => ({
      id: "runtime-turn",
      model: options.model,
      provider: options.connectionProvider,
      message: { role: "assistant", content: "routed" },
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      finishReason: "stop",
    }));
    const client = new RouterBackedOrchestrationInferenceClient({
      db: db.raw,
      router: { route } as unknown as InferenceRouter,
      runtime: { chat: runtimeChat } as unknown as InferenceClient,
      getConnectionProvider: () => provider,
      getSessionId: () => "session-p019",
    });

    await client.chat({
      tier: "reasoning",
      messages: [{ role: "user", content: "plan deeply" }],
      trace: { turnId: "turn-p019-1", taskType: "planning" },
    });
    provider = "openai";
    await client.chat({
      tier: "fast",
      messages: [{ role: "user", content: "continue" }],
      trace: { turnId: "turn-p019-2", taskType: "agent_turn" },
    });

    expect(route).toHaveBeenCalledTimes(2);
    expect(route.mock.calls[0]?.[0]).toMatchObject({
      connectionProvider: "codex",
      tier: "high",
      taskType: "planning",
    });
    expect(route.mock.calls[1]?.[0]).toMatchObject({
      connectionProvider: "openai",
      tier: "normal",
      taskType: "agent_turn",
    });
    expect(runtimeChat.mock.calls[0]?.[1]?.connectionProvider).toBe("codex");
    expect(runtimeChat.mock.calls[1]?.[1]?.connectionProvider).toBe("openai");
  });

  it("fails before dispatch when no active connection authority exists", async () => {
    const route = vi.fn();
    const runtimeChat = vi.fn();
    const client = new RouterBackedOrchestrationInferenceClient({
      db: db.raw,
      router: { route } as unknown as InferenceRouter,
      runtime: { chat: runtimeChat } as unknown as InferenceClient,
      getConnectionProvider: () => undefined,
    });

    await expect(client.chat({
      tier: "fast",
      messages: [{ role: "user", content: "work" }],
    })).rejects.toThrow("no explicit active connection provider");
    expect(route).not.toHaveBeenCalled();
    expect(runtimeChat).not.toHaveBeenCalled();
  });

  it("preserves json-object and required-tool contracts instead of silently dropping them", async () => {
    const route = vi.fn(async () => routedResult({ content: "not json" }));
    const client = new RouterBackedOrchestrationInferenceClient({
      db: db.raw,
      router: { route } as unknown as InferenceRouter,
      runtime: { chat: vi.fn() } as unknown as InferenceClient,
      getConnectionProvider: () => "codex",
    });

    await expect(client.chat({
      tier: "reasoning",
      messages: [{ role: "user", content: "return json" }],
      responseFormat: { type: "json_object" },
    })).rejects.toThrow("responseFormat=json_object");

    route.mockResolvedValueOnce(routedResult({ content: "{}", toolCalls: undefined }));
    await expect(client.chat({
      tier: "fast",
      messages: [{ role: "user", content: "call a tool" }],
      toolChoice: "required",
      tools: [{
        type: "function",
        function: {
          name: "probe",
          description: "probe",
          parameters: { type: "object", properties: {} },
        },
      }],
    })).rejects.toThrow("toolChoice=required");
  });

  it("emits orchestration routing evidence with the same goal/task/turn correlation domain", async () => {
    const client = new RouterBackedOrchestrationInferenceClient({
      db: db.raw,
      router: {
        route: vi.fn(async () => routedResult({ content: "{}" })),
      } as unknown as InferenceRouter,
      runtime: { chat: vi.fn() } as unknown as InferenceClient,
      getConnectionProvider: () => "codex",
      getDailyBudgetCents: () => 321,
    });

    await client.chat({
      tier: "cheap",
      messages: [{ role: "user", content: "summarize" }],
      responseFormat: { type: "json_object" },
      trace: {
        correlationId: "goal:goal-p019",
        turnId: "turn-p019-evidence",
        goalId: "goal-p019",
        taskId: "task-p019",
        taskType: "summarization",
      },
    });

    const events = getEvidenceByCorrelation(db.raw, "goal:goal-p019");
    const event = events.find(
      (candidate) => candidate.eventType === "inference.orchestration_route_requested",
    );
    expect(event).toBeDefined();
    expect(event).toMatchObject({
      goalId: "goal-p019",
      taskId: "task-p019",
      turnId: "turn-p019-evidence",
      domain: "inference",
      authorityType: "inference_route",
    });
    expect(event?.payload).toMatchObject({
      requestedTier: "cheap",
      mappedSurvivalTier: "low_compute",
      taskType: "summarization",
      connectionProvider: "codex",
      responseFormat: "json_object",
    });
  });
});
