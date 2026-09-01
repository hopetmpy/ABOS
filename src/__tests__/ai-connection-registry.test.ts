import { describe, expect, it } from "vitest";
import {
  AI_CONNECTION_METHODS,
  AI_CONNECTION_PROVIDERS,
  getAiProvidersForMethod,
  isAvailableAiProvider,
} from "../setup/ai-connection-registry.js";

describe("AI connection registry", () => {
  it("keeps authentication method separate from provider", () => {
    expect(AI_CONNECTION_METHODS.map((method) => method.id)).toEqual([
      "oauth",
      "api_key",
      "local",
    ]);
  });

  it("exposes Codex as the first available OAuth provider without hard-coding OAuth to Codex", () => {
    const oauth = getAiProvidersForMethod("oauth");
    expect(oauth.map((provider) => provider.id)).toContain("codex");
    expect(oauth.find((provider) => provider.id === "codex")?.runtimeProvider).toBe("codex");
    expect(oauth.find((provider) => provider.id === "oauth-other")?.availability).toBe("future");
  });

  it("exposes current API-key providers and future extension slots", () => {
    const api = getAiProvidersForMethod("api_key");
    expect(api.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(["openai", "anthropic", "conway", "groq", "together"]),
    );
    expect(api.find((provider) => provider.id === "groq")?.availability).toBe("future");
    expect(api.find((provider) => provider.id === "together")?.availability).toBe("future");
  });

  it("keeps local/self-hosted providers in a separate connection family", () => {
    const local = getAiProvidersForMethod("local");
    expect(local.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(["ollama", "openai-compatible-local", "local-other"]),
    );
    expect(local.find((provider) => provider.id === "ollama")?.availability).toBe("available");
  });

  it("only marks implemented adapters as selectable runtime providers", () => {
    const available = AI_CONNECTION_PROVIDERS.filter(isAvailableAiProvider);
    expect(available.map((provider) => provider.id)).toEqual([
      "codex",
      "openai",
      "anthropic",
      "conway",
      "ollama",
    ]);
  });
});
