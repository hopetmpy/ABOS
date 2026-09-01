import { describe, expect, it } from "vitest";
import type { ModelEntry } from "../types.js";
import { resolveRequestedModel } from "../setup/model-picker.js";

function model(modelId: string, provider: ModelEntry["provider"]): ModelEntry {
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
  it("resolves a provider-qualified Codex id exactly", () => {
    const selected = resolveRequestedModel(
      [model("codex:gpt-test", "codex"), model("gpt-test", "openai")],
      "codex:gpt-test",
    );
    expect(selected.provider).toBe("codex");
  });

  it("resolves a bare Codex model when it is unique", () => {
    const selected = resolveRequestedModel(
      [model("codex:gpt-test", "codex"), model("other-model", "openai")],
      "gpt-test",
    );
    expect(selected.modelId).toBe("codex:gpt-test");
  });

  it("rejects a bare id that is ambiguous across providers", () => {
    expect(() =>
      resolveRequestedModel(
        [model("codex:gpt-test", "codex"), model("gpt-test", "openai")],
        "gpt-test",
      ),
    ).toThrow(/ambiguous across providers/);
  });

  it("rejects unknown model ids", () => {
    expect(() => resolveRequestedModel([], "missing")).toThrow(/Unknown model/);
  });
});
