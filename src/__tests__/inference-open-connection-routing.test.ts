import { describe, expect, it } from "vitest";
import { createInferenceClient } from "../conway/inference.js";

describe("open runtime inference adapters", () => {
  it("routes an explicit future provider through a registered runtime adapter", async () => {
    let calls = 0;
    const client = createInferenceClient({
      apiUrl: "https://unused.invalid",
      apiKey: "unused",
      defaultModel: "future:model",
      maxTokens: 1024,
      getConnectionProvider: () => "future-provider",
      runtimeAdapters: [{
        id: "future-provider",
        isAvailable: () => true,
        chat: async (_messages, _options, modelId) => {
          calls += 1;
          return {
            id: "future-1",
            model: modelId,
            provider: "future-provider",
            message: { role: "assistant", content: "ok" },
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            finishReason: "stop",
          };
        },
      }],
    });

    const response = await client.chat([{ role: "user", content: "hello" }]);
    expect(calls).toBe(1);
    expect(response.provider).toBe("future-provider");
    expect(response.message.content).toBe("ok");
  });

  it("fails closed for an explicitly selected provider whose adapter is not loaded", async () => {
    const client = createInferenceClient({
      apiUrl: "https://unused.invalid",
      apiKey: "unused",
      defaultModel: "future:model",
      maxTokens: 1024,
      getConnectionProvider: () => "not-loaded-yet",
    });

    await expect(
      client.chat([{ role: "user", content: "hello" }]),
    ).rejects.toThrow(/no runtime adapter is loaded/);
  });

  it("does not reinterpret a registered unknown provider as Conway", async () => {
    const client = createInferenceClient({
      apiUrl: "https://unused.invalid",
      apiKey: "unused",
      defaultModel: "future:model",
      maxTokens: 1024,
      getModelProvider: () => "future-provider",
    });

    await expect(
      client.chat([{ role: "user", content: "hello" }]),
    ).rejects.toThrow(/belongs to registered provider 'future-provider'/);
  });

  it("reports a configured Codex route as unavailable when no live Codex session is enabled", async () => {
    const client = createInferenceClient({
      apiUrl: "https://unused.invalid",
      apiKey: "unused",
      defaultModel: "codex:gpt-test",
      maxTokens: 1024,
      codex: { enabled: false, includeHiddenModels: false },
      getConnectionProvider: () => "codex",
    });

    await expect(
      client.chat([{ role: "user", content: "hello" }]),
    ).rejects.toThrow(/not currently available/);
  });
});
