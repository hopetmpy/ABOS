import { describe, expect, it } from "vitest";
import type { ModelEntry } from "../types.js";
import {
  reconcileAdapterFallbackModels,
  resolveRequestedModel,
  scopeModelsForAdapter,
} from "../setup/model-picker.js";

function model(modelId: string, provider: string): ModelEntry {
  const now = new Date(0).toISOString();
  return {
    modelId,
    provider,
    displayName: modelId,
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

describe("resolveRequestedModel", () => {
  it("resolves provider-qualified model ids exactly", () => {
    const selected = resolveRequestedModel(
      "codex:gpt-test",
      [model("codex:gpt-test", "codex"), model("gpt-test", "openai")],
    );
    expect(selected?.provider).toBe("codex");
  });

  it("resolves an unqualified suffix only when unique inside the scoped candidates", () => {
    const selected = resolveRequestedModel(
      "gpt-test",
      [model("codex:gpt-test", "codex"), model("other-model", "openai")],
    );
    expect(selected?.modelId).toBe("codex:gpt-test");
  });

  it("does not guess when an unqualified id is ambiguous", () => {
    const selected = resolveRequestedModel(
      "gpt-test",
      [model("codex:gpt-test", "codex"), model("other:gpt-test", "other")],
    );
    expect(selected).toBeUndefined();
  });

  it("returns undefined for unknown model ids", () => {
    expect(resolveRequestedModel("missing", [])).toBeUndefined();
  });
});


describe("scopeModelsForAdapter", () => {
  it("reuses adapter-native compatibility instead of a core provider allowlist", () => {
    const models = [
      model("codex:gpt-test", "codex"),
      model("gpt-test", "openai"),
      model("ollama:local", "ollama"),
    ];

    const scoped = scopeModelsForAdapter(models, {
      supportsModel: (entry) => entry.provider === "codex",
    });

    expect(scoped.map((entry) => entry.modelId)).toEqual([
      "codex:gpt-test",
    ]);
  });

  it("keeps the full model universe when compatibility is unknown", () => {
    const models = [
      model("future:a", "other"),
      model("future:b", "other"),
    ];

    expect(scopeModelsForAdapter(models, undefined)).toEqual(models);
    expect(scopeModelsForAdapter(models, {})).toEqual(models);
  });
});

describe("reconcileAdapterFallbackModels", () => {
  it("replaces only known-incompatible fallback slots with the selected compatible model", () => {
    const selected = model("codex:gpt-primary", "codex");
    const compatible = model("codex:gpt-fast", "codex");
    const incompatible = model("gpt-openai", "openai");
    const all = new Map(
      [selected, compatible, incompatible].map((entry) => [
        entry.modelId,
        entry,
      ]),
    );
    const strategy = {
      inferenceModel: selected.modelId,
      lowComputeModel: compatible.modelId,
      criticalModel: incompatible.modelId,
      maxTokensPerTurn: 4096,
      hourlyBudgetCents: 0,
      sessionBudgetCents: 0,
      perCallCeilingCents: 0,
      enableModelFallback: true,
      anthropicApiVersion: "2023-06-01",
    };

    reconcileAdapterFallbackModels(
      strategy,
      selected,
      { supportsModel: (entry) => entry.provider === "codex" },
      (id) => all.get(id),
    );

    expect(strategy.lowComputeModel).toBe("codex:gpt-fast");
    expect(strategy.criticalModel).toBe("codex:gpt-primary");
  });
});
