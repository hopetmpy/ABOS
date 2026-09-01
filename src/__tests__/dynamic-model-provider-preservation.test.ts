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

  it("still manages removed models from providers owned by the static baseline", () => {
    const registry = new ModelRegistry(db);
    registry.initialize();

    const now = new Date().toISOString();
    registry.upsert({
      modelId: "removed-openai-baseline-model",
      provider: "openai",
      displayName: "Removed baseline model",
      tierMinimum: "normal",
      costPer1kInput: 1,
      costPer1kOutput: 1,
      maxTokens: 4096,
      contextWindow: 4096,
      supportsTools: true,
      supportsVision: false,
      parameterStyle: "max_tokens",
      enabled: true,
      lastSeen: now,
      createdAt: now,
      updatedAt: now,
    });

    registry.initialize();

    expect(registry.get("removed-openai-baseline-model")?.enabled).toBe(false);
  });
});
