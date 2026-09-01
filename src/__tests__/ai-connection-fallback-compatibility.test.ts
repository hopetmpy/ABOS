import { describe, expect, it } from "vitest";
import {
  reconcileAdapterFallbackModels,
} from "../setup/model-picker.js";
import type {
  ModelEntry,
  ModelStrategyConfig,
} from "../types.js";

function model(id: string, provider: string): ModelEntry {
  const now = new Date(0).toISOString();
  return {
    modelId: id,
    provider,
    displayName: id,
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

function strategy(): ModelStrategyConfig {
  return {
    inferenceModel: "codex:gpt-main",
    lowComputeModel: "ollama:small",
    criticalModel: "codex:gpt-small",
    maxTokensPerTurn: 4096,
    hourlyBudgetCents: 0,
    sessionBudgetCents: 0,
    perCallCeilingCents: 0,
    enableModelFallback: true,
    anthropicApiVersion: "2023-06-01",
  };
}

describe("explicit AI connection fallback reconciliation", () => {
  it("replaces only fallback models that the selected adapter cannot execute", () => {
    const s = strategy();
    const entries = new Map([
      ["codex:gpt-main", model("codex:gpt-main", "codex")],
      ["codex:gpt-small", model("codex:gpt-small", "codex")],
      ["ollama:small", model("ollama:small", "ollama")],
    ]);

    reconcileAdapterFallbackModels(
      s,
      entries.get("codex:gpt-main")!,
      { supportsModel: (entry) => entry.provider === "codex" },
      (id) => entries.get(id),
    );

    expect(s.lowComputeModel).toBe("codex:gpt-main");
    expect(s.criticalModel).toBe("codex:gpt-small");
  });

  it("preserves broad proxy-compatible fallbacks when the adapter accepts them", () => {
    const s = strategy();
    const entries = new Map([
      ["gpt-main", model("gpt-main", "openai")],
      ["ollama:small", model("ollama:small", "ollama")],
      ["codex:gpt-small", model("codex:gpt-small", "codex")],
    ]);

    reconcileAdapterFallbackModels(
      s,
      entries.get("gpt-main")!,
      { supportsModel: () => true },
      (id) => entries.get(id),
    );

    expect(s.lowComputeModel).toBe("ollama:small");
    expect(s.criticalModel).toBe("codex:gpt-small");
  });
});
