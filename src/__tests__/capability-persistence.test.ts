import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../state/database.js";
import { CapabilityRegistry } from "../capabilities/registry.js";
import { CapabilityStore } from "../capabilities/store.js";
import { capabilityStateOf } from "../capabilities/model.js";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "abos-capability-"));
  tempDirs.push(dir);
  return join(dir, "state.db");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("P-014 durable Capability Fabric", () => {
  it("migrates fresh databases to schema v19 capability authority", () => {
    const db = createDatabase(tempDbPath());
    try {
      const version = db.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
      const table = db.raw.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'capability_records'",
      ).get() as { name: string } | undefined;
      expect(version.version).toBe(19);
      expect(table?.name).toBe("capability_records");
    } finally {
      db.close();
    }
  });

  it("persists verified lifecycle across restart and weak inventory refresh", () => {
    const dbPath = tempDbPath();
    const first = createDatabase(dbPath);
    try {
      const registry = new CapabilityRegistry(new CapabilityStore(first.raw));
      registry.ingestTools([{ name: "exec", description: "Execute a local command" }]);
      const verified = registry.recordProbe("tool:exec", {
        state: "verified_available",
        authority: "probe:exec-version",
        evidence: ["exec probe completed successfully"],
        observedAt: "2026-09-19T00:00:00.000Z",
      });
      expect(verified.available).toBe(true);
    } finally {
      first.close();
    }

    const second = createDatabase(dbPath);
    try {
      const registry = new CapabilityRegistry(new CapabilityStore(second.raw));
      expect(capabilityStateOf(registry.get("tool:exec")!)).toBe("verified_available");
      expect(registry.get("tool:exec")?.authority).toBe("probe:exec-version");

      registry.ingestTools([{ name: "exec", description: "Execute a local command" }]);
      expect(capabilityStateOf(registry.get("tool:exec")!)).toBe("verified_available");
      expect(registry.findSupporting("execute").map((entry) => entry.id)).toContain("tool:exec");
    } finally {
      second.close();
    }
  });

  it("invalidates verification when the capability definition fingerprint changes", () => {
    const dbPath = tempDbPath();
    const db = createDatabase(dbPath);
    try {
      const registry = new CapabilityRegistry(new CapabilityStore(db.raw));
      registry.ingestTools([{ name: "exec", description: "Execute a local command" }]);
      registry.recordProbe("tool:exec", {
        state: "verified_available",
        authority: "probe:exec-version",
        evidence: ["exec probe completed successfully"],
        observedAt: "2026-09-19T00:01:00.000Z",
      });

      registry.ingestTools([{ name: "exec", description: "Execute a changed command contract" }]);
      const changed = registry.get("tool:exec")!;
      expect(changed.available).toBe(false);
      expect(capabilityStateOf(changed)).toBe("discovered_unverified");
      expect(changed.authority).toBe("runtime:tool-definition");
    } finally {
      db.close();
    }

    const reopened = createDatabase(dbPath);
    try {
      const registry = new CapabilityRegistry(new CapabilityStore(reopened.raw));
      expect(capabilityStateOf(registry.get("tool:exec")!)).toBe("discovered_unverified");
      expect(registry.findSupporting("changed")).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it("requires explicit authority, evidence, and valid time for probe transitions", () => {
    const db = createDatabase(tempDbPath());
    try {
      const registry = new CapabilityRegistry(new CapabilityStore(db.raw));
      registry.ingestTools([{ name: "exec" }]);

      expect(() => registry.recordProbe("tool:exec", {
        state: "verified_available",
        authority: "",
        evidence: ["ok"],
      })).toThrow(/authority is required/);
      expect(() => registry.recordProbe("tool:exec", {
        state: "verified_available",
        authority: "probe:test",
        evidence: [],
      })).toThrow(/evidence is required/);
      expect(() => registry.recordProbe("tool:exec", {
        state: "verified_available",
        authority: "probe:test",
        evidence: ["ok"],
        observedAt: "not-a-date",
      })).toThrow(/valid timestamp/);

      expect(capabilityStateOf(registry.get("tool:exec")!)).toBe("discovered_unverified");
    } finally {
      db.close();
    }
  });
});
