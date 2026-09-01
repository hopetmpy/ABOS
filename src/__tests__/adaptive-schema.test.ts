import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../state/database.js";
import { SCHEMA_VERSION } from "../state/schema.js";

describe("adaptive schema migration", () => {
  it("creates the adaptive intelligence tables on a fresh ABOS database", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-adaptive-schema-"));
    const dbPath = path.join(dir, "state.db");
    const db = createDatabase(dbPath);
    try {
      expect(SCHEMA_VERSION).toBe(12);
      const names = db.raw.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'adaptive_%' ORDER BY name",
      ).all() as Array<{ name: string }>;

      expect(names.map((row) => row.name)).toEqual([
        "adaptive_assumptions",
        "adaptive_attempts",
        "adaptive_opportunities",
        "adaptive_paths",
        "adaptive_world_facts",
      ]);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
