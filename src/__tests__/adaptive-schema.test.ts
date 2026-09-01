import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDatabase } from "../state/database.js";
import { SCHEMA_VERSION } from "../state/schema.js";

describe("adaptive + environment schema migration", () => {
  it("creates adaptive intelligence and environment lifecycle tables on a fresh ABOS database", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-adaptive-schema-"));
    const dbPath = path.join(dir, "state.db");
    const db = createDatabase(dbPath);
    try {
      expect(SCHEMA_VERSION).toBe(13);

      const adaptiveNames = db.raw.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'adaptive_%' ORDER BY name",
      ).all() as Array<{ name: string }>;

      expect(adaptiveNames.map((row) => row.name)).toEqual([
        "adaptive_assumptions",
        "adaptive_attempts",
        "adaptive_evidence",
        "adaptive_opportunities",
        "adaptive_paths",
        "adaptive_task_bindings",
        "adaptive_world_facts",
      ]);

      const environmentNames = db.raw.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'environment_%' ORDER BY name",
      ).all() as Array<{ name: string }>;

      expect(environmentNames.map((row) => row.name)).toEqual([
        "environment_resource_events",
        "environment_resources",
      ]);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
