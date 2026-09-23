import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { MIGRATION_V6 } from "../state/schema.js";
import { ModelRegistry } from "../inference/registry.js";

let db: BetterSqlite3.Database;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(MIGRATION_V6);
});

afterEach(() => {
  db.close();
});

describe("ModelRegistry dynamic provider lifecycle", () => {
  it("does not disable models owned by a dynamically registered provider on initialize", () => {
    const registry = new ModelRegistry(db);
    registry.initialize();

    const now = new Date().toISOString();
    registry.upsert({
      modelId: "future-provider:model-x",
      provider: "future-provider",
      displayName: "Future Model X",
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
    });

    registry.initialize();

    expect(registry.get("future-provider:model-x")?.enabled).toBe(true);
  });

  it("does not let the static baseline retire a dynamically discovered sibling model from the same provider", () => {
    const registry = new ModelRegistry(db);
    registry.initialize();

    const now = new Date().toISOString();
    registry.upsert({
      modelId: "openai:future-dynamic-model",
      provider: "openai",
      displayName: "Future Dynamic OpenAI Model",
      tierMinimum: "normal",
      costPer1kInput: 7,
      costPer1kOutput: 21,
      maxTokens: 16384,
      contextWindow: 200000,
      supportsTools: true,
      supportsVision: true,
      parameterStyle: "max_completion_tokens",
      enabled: true,
      lastSeen: now,
      createdAt: now,
      updatedAt: now,
    });

    registry.initialize();

    expect(registry.get("openai:future-dynamic-model")).toMatchObject({
      provider: "openai",
      displayName: "Future Dynamic OpenAI Model",
      enabled: true,
    });
  });

  it("continues to refresh baseline-owned entries without re-enabling a user-disabled model", () => {
    const registry = new ModelRegistry(db);
    registry.initialize();
    registry.setEnabled("gpt-5.2", false);

    const before = registry.get("gpt-5.2");
    expect(before).toBeDefined();
    expect(before?.enabled).toBe(false);

    registry.initialize();

    const after = registry.get("gpt-5.2");
    expect(after).toBeDefined();
    expect(after?.displayName).toBe("GPT-5.2");
    expect(after?.provider).toBe("openai");
    expect(after?.enabled).toBe(false);
  });
});
