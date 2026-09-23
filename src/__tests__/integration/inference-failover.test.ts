/**
 * Integration tests for the compatibility inference boundary.
 *
 * Provider selection may happen before dispatch, but a single call never
 * crosses to another provider after failure or because its client-local
 * circuit is open. Provider changes belong to a new orchestration decision.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRegistry, type ProviderConfig } from "../../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import type { ChatMessage } from "../../types.js";

const mockState = vi.hoisted(() => {
  const queue: Array<(payload: unknown) => unknown | Promise<unknown>> = [];
  const calls: unknown[] = [];

  const create = vi.fn(async (payload: unknown) => {
    calls.push(payload);
    const next = queue.shift();
    if (!next) throw new Error("No OpenAI mock response queued");
    return next(payload);
  });

  const ctor = vi.fn().mockImplementation(function MockOpenAI(this: Record<string, unknown>) {
    this.chat = { completions: { create } };
  });

  return { queue, calls, create, ctor };
});

vi.mock("openai", () => ({ default: mockState.ctor }));

const ORIGINAL_ENV = { ...process.env };
const BASE_MESSAGES: ChatMessage[] = [{ role: "user", content: "ping" }];

function makeProvider(
  id: string,
  priority: number,
  overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
  return {
    id,
    name: id,
    baseUrl: `https://${id}.example.com/v1`,
    apiKeyEnvVar: `${id.toUpperCase()}_API_KEY`,
    models: [
      {
        id: `${id}-reasoning`,
        tier: "reasoning",
        contextWindow: 128000,
        maxOutputTokens: 8192,
        costPerInputToken: 1.0,
        costPerOutputToken: 2.0,
        supportsTools: true,
        supportsVision: false,
        supportsStreaming: true,
      },
      {
        id: `${id}-fast`,
        tier: "fast",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        costPerInputToken: 0.2,
        costPerOutputToken: 0.4,
        supportsTools: true,
        supportsVision: false,
        supportsStreaming: true,
      },
      {
        id: `${id}-cheap`,
        tier: "cheap",
        contextWindow: 128000,
        maxOutputTokens: 2048,
        costPerInputToken: 0.05,
        costPerOutputToken: 0.1,
        supportsTools: true,
        supportsVision: false,
        supportsStreaming: true,
      },
    ],
    maxRequestsPerMinute: 100,
    maxTokensPerMinute: 500000,
    priority,
    enabled: true,
    ...overrides,
  };
}

function makeRegistry(providers: ProviderConfig[], preferredForReasoning?: string): ProviderRegistry {
  const primaryId = preferredForReasoning ?? providers[0]?.id ?? "alpha";
  const fallbackIds = providers.slice(1).map((provider) => provider.id);
  return new ProviderRegistry(providers, {
    reasoning: { preferredProvider: primaryId, fallbackOrder: fallbackIds },
    fast: { preferredProvider: primaryId, fallbackOrder: fallbackIds },
    cheap: { preferredProvider: primaryId, fallbackOrder: fallbackIds },
  });
}

function makeClient(registry: ProviderRegistry): UnifiedInferenceClient {
  return new UnifiedInferenceClient(registry);
}

function queueCompletion(content = "ok", promptTokens = 100, completionTokens = 20): void {
  mockState.queue.push(async () => ({
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }));
}

function queueError(status: number, message = `HTTP ${status}`): void {
  mockState.queue.push(async () => {
    const error = new Error(message) as Error & { status: number };
    error.status = status;
    throw error;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.queue.splice(0, mockState.queue.length);
  mockState.calls.splice(0, mockState.calls.length);
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ABOS_CREDITS_BALANCE;
  delete process.env.ABOS_INFERENCE_TASK_TYPE;
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.useRealTimers();
});

describe("integration/inference-failover", () => {
  describe("provider resolution", () => {
    it("uses the preferred provider for a tier on the first request", async () => {
      const registry = makeRegistry([makeProvider("alpha", 1), makeProvider("beta", 2)], "alpha");
      const client = makeClient(registry);
      queueCompletion("from-alpha");

      const result = await client.chat({ tier: "reasoning", messages: BASE_MESSAGES });

      expect(result.content).toBe("from-alpha");
      expect(result.metadata.providerId).toBe("alpha");
      expect(result.metadata.failedProviders).toEqual([]);
    });

    it("selects the first eligible provider when an earlier provider has no model for the tier", async () => {
      const alpha = makeProvider("alpha", 1, {
        models: [
          {
            id: "alpha-fast",
            tier: "fast",
            contextWindow: 64000,
            maxOutputTokens: 2048,
            costPerInputToken: 0.1,
            costPerOutputToken: 0.2,
            supportsTools: true,
            supportsVision: false,
            supportsStreaming: true,
          },
        ],
      });
      const beta = makeProvider("beta", 2);
      const registry = new ProviderRegistry([alpha, beta]);
      const client = makeClient(registry);
      queueCompletion("from-beta");

      const result = await client.chat({ tier: "reasoning", messages: BASE_MESSAGES });

      expect(result.metadata.providerId).toBe("beta");
    });

    it("returns cost fields calculated from model pricing", async () => {
      const client = makeClient(makeRegistry([makeProvider("pricing-test", 1)]));
      queueCompletion("priced", 1000, 500);

      const result = await client.chat({ tier: "reasoning", messages: BASE_MESSAGES });

      expect(result.cost.inputCostCredits).toBeCloseTo(1.0);
      expect(result.cost.outputCostCredits).toBeCloseTo(1.0);
      expect(result.cost.totalCostCredits).toBeCloseTo(2.0);
    });
  });

  describe("single-provider call boundary", () => {
    it.each([429, 503])(
      "does not cross provider boundary after primary exhausts retries on %s",
      async (status) => {
        const registry = makeRegistry([makeProvider("alpha", 1), makeProvider("beta", 2)], "alpha");
        const client = makeClient(registry);

        for (let i = 0; i < 4; i += 1) queueError(status, `alpha-${status}-${i}`);
        queueCompletion("must-not-use-beta");

        vi.useFakeTimers();
        const pending = expect(
          client.chat({ tier: "reasoning", messages: BASE_MESSAGES }),
        ).rejects.toThrow(`alpha-${status}-3`);
        await vi.runAllTimersAsync();
        await pending;
        vi.useRealTimers();

        expect(mockState.create).toHaveBeenCalledTimes(4);
        expect(mockState.queue).toHaveLength(1);
      },
    );

    it("does not cross provider boundary on a non-retryable error", async () => {
      const registry = makeRegistry([makeProvider("alpha", 1), makeProvider("beta", 2)], "alpha");
      const client = makeClient(registry);
      queueError(400, "bad-request");
      queueCompletion("must-not-use-beta");

      await expect(
        client.chat({ tier: "reasoning", messages: BASE_MESSAGES }),
      ).rejects.toThrow("bad-request");

      expect(mockState.create).toHaveBeenCalledTimes(1);
      expect(mockState.queue).toHaveLength(1);
    });

    it("reports only the selected provider final failure instead of aggregating fallback providers", async () => {
      const registry = makeRegistry([makeProvider("alpha", 1), makeProvider("beta", 2)], "alpha");
      const client = makeClient(registry);
      for (let i = 0; i < 4; i += 1) queueError(429, `alpha-${i}`);
      for (let i = 0; i < 4; i += 1) queueError(500, `beta-${i}`);

      vi.useFakeTimers();
      const pending = expect(
        client.chat({ tier: "reasoning", messages: BASE_MESSAGES }),
      ).rejects.toThrow("alpha-3");
      await vi.runAllTimersAsync();
      await pending;
      vi.useRealTimers();

      expect(mockState.create).toHaveBeenCalledTimes(4);
      expect(mockState.queue).toHaveLength(4);
    });
  });

  describe("client-local circuit breaker", () => {
    it("fails closed when the selected provider circuit is open", async () => {
      const registry = makeRegistry([makeProvider("alpha", 1), makeProvider("beta", 2)], "alpha");
      const client = makeClient(registry);

      for (let i = 0; i < 5; i += 1) {
        queueError(400, `trip-${i}`);
        await expect(
          client.chatDirect({ providerId: "alpha", modelId: "alpha-reasoning", messages: BASE_MESSAGES }),
        ).rejects.toThrow(`trip-${i}`);
      }

      queueCompletion("must-not-use-beta");
      await expect(
        client.chat({ tier: "reasoning", messages: BASE_MESSAGES }),
      ).rejects.toThrow(/Provider 'alpha' circuit is open/);

      expect(mockState.create).toHaveBeenCalledTimes(5);
      expect(mockState.queue).toHaveLength(1);
    });

    it("does not copy client circuit state into ProviderRegistry", async () => {
      const registry = makeRegistry([makeProvider("alpha", 1)]);
      const client = makeClient(registry);
      const disableSpy = vi.spyOn(registry, "disableProvider");

      for (let i = 0; i < 5; i += 1) {
        queueError(400, `fail-${i}`);
        await expect(
          client.chatDirect({ providerId: "alpha", modelId: "alpha-reasoning", messages: BASE_MESSAGES }),
        ).rejects.toThrow();
      }

      expect(disableSpy).not.toHaveBeenCalled();
      expect(registry.getProviders().find((provider) => provider.id === "alpha")?.enabled).toBe(true);
    });

    it("reopens the selected provider after cooldown without registry mutation", async () => {
      vi.useFakeTimers();
      const registry = makeRegistry([makeProvider("alpha", 1), makeProvider("beta", 2)], "alpha");
      const client = makeClient(registry);

      for (let i = 0; i < 5; i += 1) {
        queueError(400, `trip-${i}`);
        await expect(
          client.chatDirect({ providerId: "alpha", modelId: "alpha-reasoning", messages: BASE_MESSAGES }),
        ).rejects.toThrow();
      }

      expect(registry.getProviders().find((provider) => provider.id === "alpha")?.enabled).toBe(true);
      vi.advanceTimersByTime(5 * 60_000 + 1);

      queueCompletion("alpha-recovered");
      const result = await client.chat({ tier: "reasoning", messages: BASE_MESSAGES });

      expect(result.content).toBe("alpha-recovered");
      expect(result.metadata.providerId).toBe("alpha");
      vi.useRealTimers();
    });
  });

  describe("survival mode tier downgrade", () => {
    it("downgrades reasoning to fast tier when credits are in survival range", async () => {
      process.env.ABOS_CREDITS_BALANCE = "500";
      const client = makeClient(makeRegistry([makeProvider("alpha", 1)]));
      queueCompletion("survival-fast");

      const result = await client.chat({ tier: "reasoning", messages: BASE_MESSAGES });

      expect(result.metadata.modelId).toBe("alpha-fast");
      expect(result.metadata.tier).toBe("reasoning");
    });

    it("downgrades fast to cheap tier when credits are in survival range", async () => {
      process.env.ABOS_CREDITS_BALANCE = "200";
      const client = makeClient(makeRegistry([makeProvider("alpha", 1)]));
      queueCompletion("survival-cheap");

      const result = await client.chat({ tier: "fast", messages: BASE_MESSAGES });

      expect(result.metadata.modelId).toBe("alpha-cheap");
      expect(result.metadata.tier).toBe("fast");
    });

    it("does not downgrade when credits are above survival threshold", async () => {
      process.env.ABOS_CREDITS_BALANCE = "1000";
      const client = makeClient(makeRegistry([makeProvider("alpha", 1)]));
      queueCompletion("full-reasoning");

      const result = await client.chat({ tier: "reasoning", messages: BASE_MESSAGES });
      expect(result.metadata.modelId).toBe("alpha-reasoning");
    });

    it("does not downgrade when balance is absent", async () => {
      const client = makeClient(makeRegistry([makeProvider("alpha", 1)]));
      queueCompletion("normal-reasoning");

      const result = await client.chat({ tier: "reasoning", messages: BASE_MESSAGES });
      expect(result.metadata.modelId).toBe("alpha-reasoning");
    });

    it("preserves the single-provider boundary after survival tier selection", async () => {
      process.env.ABOS_CREDITS_BALANCE = "300";
      const registry = makeRegistry([makeProvider("alpha", 1), makeProvider("beta", 2)], "alpha");
      const client = makeClient(registry);

      for (let i = 0; i < 4; i += 1) queueError(429, `alpha-survival-${i}`);
      queueCompletion("must-not-use-beta");

      vi.useFakeTimers();
      const pending = expect(
        client.chat({ tier: "reasoning", messages: BASE_MESSAGES }),
      ).rejects.toThrow("alpha-survival-3");
      await vi.runAllTimersAsync();
      await pending;
      vi.useRealTimers();

      expect(mockState.create).toHaveBeenCalledTimes(4);
      expect(mockState.queue).toHaveLength(1);
    });
  });

  describe("emergency stop policy", () => {
    it("throws when credits are below emergency threshold for non-planner tasks", async () => {
      process.env.ABOS_CREDITS_BALANCE = "50";
      process.env.ABOS_INFERENCE_TASK_TYPE = "agent_turn";
      const client = makeClient(makeRegistry([makeProvider("alpha", 1)]));

      await expect(
        client.chat({ tier: "reasoning", messages: BASE_MESSAGES }),
      ).rejects.toThrow(/Emergency stop active/);
    });

    it("allows planner calls through even below emergency threshold", async () => {
      process.env.ABOS_CREDITS_BALANCE = "50";
      process.env.ABOS_INFERENCE_TASK_TYPE = "planner_step";
      const client = makeClient(makeRegistry([makeProvider("alpha", 1)]));
      queueCompletion("planner-allowed");

      const result = await client.chat({ tier: "reasoning", messages: BASE_MESSAGES });
      expect(result.content).toBe("planner-allowed");
    });
  });
});