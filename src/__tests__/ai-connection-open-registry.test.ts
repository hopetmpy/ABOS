import { describe, expect, it } from "vitest";
import {
  AiConnectionAdapterRegistry,
  BUILTIN_AI_CONNECTION_METHODS,
} from "../ai-connections/registry.js";
import type { AbosConfig, ModelEntry } from "../types.js";

function config(): AbosConfig {
  return {
    name: "test",
    genesisPrompt: "test",
    creatorAddress: "0x0000000000000000000000000000000000000000",
    registeredWithConway: false,
    sandboxId: "",
    conwayApiUrl: "https://api.conway.tech",
    conwayApiKey: "",
    inferenceModel: "gpt-5.2",
    maxTokensPerTurn: 4096,
    heartbeatConfigPath: "~/.abos/heartbeat.yml",
    dbPath: ":memory:",
    logLevel: "error",
    walletAddress: "0x0000000000000000000000000000000000000000",
    version: "0.3.0",
    skillsDir: "~/.abos/skills",
    maxChildren: 0,
  };
}

function model(provider: string): ModelEntry {
  const now = new Date(0).toISOString();
  return {
    modelId: `${provider}:model`,
    provider,
    displayName: "model",
    tierMinimum: "normal",
    costPer1kInput: 0,
    costPer1kOutput: 0,
    maxTokens: 4096,
    contextWindow: 0,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_completion_tokens",
    enabled: true,
    lastSeen: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe("AiConnectionAdapterRegistry", () => {
  it("ships OAuth, API key and local as built-in methods without closing the namespace", () => {
    expect(BUILTIN_AI_CONNECTION_METHODS.map((entry) => entry.id)).toEqual([
      "oauth",
      "api_key",
      "local",
    ]);

    const registry = new AiConnectionAdapterRegistry();
    registry.register({
      id: "future-provider",
      method: "future-auth-method",
      label: "Future Provider",
      description: "Test adapter",
      availability: () => "unknown",
      supportsModel: (entry) => entry.provider === "future-provider",
    });

    expect(registry.methods()).toEqual(["future-auth-method"]);
    expect(registry.get("future-provider")?.method).toBe("future-auth-method");
    expect(registry.get("future-provider")?.supportsModel?.(model("future-provider"))).toBe(true);
  });

  it("distinguishes unknown provider state from unavailable", () => {
    const registry = new AiConnectionAdapterRegistry();
    registry.register({
      id: "session-provider",
      method: "oauth",
      label: "Session Provider",
      description: "External session state",
      availability: () => "unknown",
    });
    registry.register({
      id: "missing-provider",
      method: "api_key",
      label: "Missing Provider",
      description: "No credential",
      availability: () => "unavailable",
    });

    expect(registry.get("session-provider")?.availability(config())).toBe("unknown");
    expect(registry.get("missing-provider")?.availability(config())).toBe("unavailable");
  });
});
