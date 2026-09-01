import { describe, expect, it } from "vitest";
import { resolveInferenceBackend } from "../conway/inference.js";

describe("explicit inference connection routing", () => {
  const keys = {
    openaiApiKey: "sk-test",
    anthropicApiKey: "sk-ant-test",
    ollamaBaseUrl: "http://localhost:11434",
    codexEnabled: true,
    getModelProvider: (_modelId: string) => "openai",
  };

  it("lets a Conway connection carry an OpenAI-owned model without heuristic override", () => {
    expect(resolveInferenceBackend("gpt-5.2", keys, "conway")).toBe("conway");
  });

  it("uses the explicitly selected OpenAI API-key route", () => {
    expect(resolveInferenceBackend("gpt-5.2", keys, "openai")).toBe("openai");
  });

  it("uses the explicitly selected OAuth/Codex route", () => {
    expect(resolveInferenceBackend("codex:gpt-test", keys, "codex")).toBe("codex");
  });

  it("uses the explicitly selected local route", () => {
    expect(resolveInferenceBackend("llama3.2", keys, "ollama")).toBe("ollama");
  });

  it("fails closed instead of silently changing providers when a selected credential is missing", () => {
    expect(() =>
      resolveInferenceBackend(
        "gpt-5.2",
        { ...keys, openaiApiKey: undefined },
        "openai",
      ),
    ).toThrow(/no key is configured/);

    expect(() =>
      resolveInferenceBackend(
        "codex:gpt-test",
        { ...keys, codexEnabled: false },
        "codex",
      ),
    ).toThrow(/not connected/);
  });

  it("preserves legacy registry/heuristic routing when no explicit connection is selected", () => {
    expect(resolveInferenceBackend("gpt-5.2", keys)).toBe("openai");
  });
});
