import { describe, expect, it } from "vitest";
import type { ModelEntry } from "../types.js";
import { resolveRequestedModel } from "../setup/model-picker.js";

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
