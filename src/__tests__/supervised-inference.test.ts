import { afterEach, describe, expect, it, vi } from "vitest";
import { createInferenceClient } from "../conway/inference.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("supervised local-only inference", () => {
  it("never falls through to Conway when forced Ollama fails", async () => {
    const requestedUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        requestedUrls.push(url);

        return new Response("OLLAMA_UNAVAILABLE", {
          status: 401,
        });
      }),
    );

    const client = createInferenceClient({
      apiUrl: "https://api.conway.invalid",
      apiKey: "must-not-be-used",
      defaultModel: "qwen3:8b",
      maxTokens: 128,
      ollamaBaseUrl: "http://127.0.0.1:11434",
      forceBackend: "ollama",
      getModelProvider: () => undefined,
    });

    await expect(
      client.chat([
        { role: "user", content: "local only" },
      ]),
    ).rejects.toThrow("Inference error (ollama)");

    expect(requestedUrls.length).toBeGreaterThan(0);
    expect(
      requestedUrls.every((url) =>
        url.startsWith(
          "http://127.0.0.1:11434/v1/chat/completions",
        ),
      ),
    ).toBe(true);
    expect(
      requestedUrls.some((url) => url.includes("conway")),
    ).toBe(false);
  });

  it("rejects a forced non-loopback Ollama endpoint", () => {
    expect(() =>
      createInferenceClient({
        apiUrl: "https://api.conway.invalid",
        apiKey: "unused",
        defaultModel: "qwen3:8b",
        maxTokens: 128,
        ollamaBaseUrl: "https://remote-ollama.example.com",
        forceBackend: "ollama",
      }),
    ).toThrow("HTTP loopback");
  });

  it("rejects forced Ollama without an endpoint", () => {
    expect(() =>
      createInferenceClient({
        apiUrl: "https://api.conway.invalid",
        apiKey: "unused",
        defaultModel: "qwen3:8b",
        maxTokens: 128,
        forceBackend: "ollama",
      }),
    ).toThrow("HTTP loopback");
  });
});
