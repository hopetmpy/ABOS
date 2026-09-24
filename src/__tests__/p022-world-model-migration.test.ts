import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../state/database.js";

function tempDbPath(prefix: string): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, dbPath: path.join(dir, "state.db") };
}

function schemaVersion(db: Database.Database): number {
  return (db.prepare("SELECT MAX(version) AS version FROM schema_version").get() as {
    version: number | null;
  }).version ?? 0;
}

function hasWorldBeliefTable(db: Database.Database): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'adaptive_world_beliefs'",
  ).get());
}

describe("P-022 world-model schema activation", () => {
  it("creates the world-belief table and records schema v21 on a fresh database", () => {
    const { dir, dbPath } = tempDbPath("abos-p022-fresh-");
    try {
      const database = createDatabase(dbPath);
      try {
        expect(hasWorldBeliefTable(database.raw)).toBe(true);
        expect(schemaVersion(database.raw)).toBe(21);
      } finally {
        database.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates the world-belief table before advancing an existing v20 database to v21", () => {
    const { dir, dbPath } = tempDbPath("abos-p022-v20-");
    try {
      const legacy = new Database(dbPath);
      try {
        legacy.pragma("foreign_keys = ON");
        legacy.exec(`
          CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO schema_version(version) VALUES (20);

          CREATE TABLE goals (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            strategy TEXT,
            expected_revenue_cents INTEGER DEFAULT 0,
            actual_revenue_cents INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            deadline TEXT,
            completed_at TEXT
          );
        `);
        expect(hasWorldBeliefTable(legacy)).toBe(false);
        expect(schemaVersion(legacy)).toBe(20);
      } finally {
        legacy.close();
      }

      const upgraded = createDatabase(dbPath);
      try {
        expect(hasWorldBeliefTable(upgraded.raw)).toBe(true);
        expect(schemaVersion(upgraded.raw)).toBe(21);
      } finally {
        upgraded.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
