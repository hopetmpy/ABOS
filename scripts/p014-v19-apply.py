from pathlib import Path
import sys

PHASE = sys.argv[1] if len(sys.argv) > 1 else "apply"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {count}: {old!r}")
    return text.replace(old, new, 1)


if PHASE == "apply":
    # Schema v19: capability-domain durable state. This is not Evidence Fabric.
    path = "src/state/schema.ts"
    text = read(path)
    text = replace_once(text, "export const SCHEMA_VERSION = 18;", "export const SCHEMA_VERSION = 19;", path)
    if "MIGRATION_V19_CAPABILITY_LIFECYCLE" in text:
        raise SystemExit("v19 migration already exists")
    text += r'''


// === Capability Fabric durable lifecycle v1 (P-014) ===
// Domain authority for capability readiness across restart. State strings are
// intentionally open-ended; only the runtime model decides which states are
// execution-ready. Evidence Fabric remains cross-domain correlation authority.
export const MIGRATION_V19_CAPABILITY_LIFECYCLE = `
  CREATE TABLE IF NOT EXISTS capability_records (
    id TEXT PRIMARY KEY,
    definition_fingerprint TEXT NOT NULL,
    descriptor_json TEXT NOT NULL,
    state TEXT NOT NULL,
    observed_at TEXT,
    authority TEXT,
    evidence_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_capability_records_state
    ON capability_records(state, updated_at);
  CREATE INDEX IF NOT EXISTS idx_capability_records_fingerprint
    ON capability_records(definition_fingerprint);
`;
'''
    write(path, text)

    # Migration runner.
    path = "src/state/database.ts"
    text = read(path)
    text = replace_once(
        text,
        '  MIGRATION_V18_EVIDENCE_FABRIC,\n} from "./schema.js";',
        '  MIGRATION_V18_EVIDENCE_FABRIC,\n  MIGRATION_V19_CAPABILITY_LIFECYCLE,\n} from "./schema.js";',
        path,
    )
    text = replace_once(
        text,
        '''    {
      version: 18,
      apply: () => db.exec(MIGRATION_V18_EVIDENCE_FABRIC),
    },
  ];''',
        '''    {
      version: 18,
      apply: () => db.exec(MIGRATION_V18_EVIDENCE_FABRIC),
    },
    {
      version: 19,
      apply: () => db.exec(MIGRATION_V19_CAPABILITY_LIFECYCLE),
    },
  ];''',
        path,
    )
    write(path, text)

    # Durable backing store for the existing registry authority.
    store_path = Path("src/capabilities/store.ts")
    if store_path.exists():
        raise SystemExit("src/capabilities/store.ts already exists")
    store_path.write_text(r'''import { createHash } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { CapabilityDescriptor } from "./model.js";
import { capabilityStateOf } from "./model.js";

type DatabaseType = BetterSqlite3.Database;

export interface StoredCapabilityRecord {
  capability: CapabilityDescriptor;
  definitionFingerprint: string;
}

type CapabilityRecordRow = {
  id: string;
  definition_fingerprint: string;
  descriptor_json: string;
  state: string;
  observed_at: string | null;
  authority: string | null;
  evidence_json: string;
};

function canonicalStrings(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

/**
 * Fingerprint only definition/contract identity, never mutable runtime evidence.
 * A changed definition must not inherit a prior verified state by accident.
 */
export function capabilityDefinitionFingerprint(
  capability: CapabilityDescriptor,
): string {
  const canonical = {
    id: capability.id,
    type: capability.type,
    provider: capability.provider,
    description: capability.description,
    requirements: canonicalStrings(capability.requirements),
    permissions: canonicalStrings(capability.permissions),
    environment: capability.environment ?? null,
    inputs: canonicalStrings(capability.inputs),
    outputs: canonicalStrings(capability.outputs),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `Invalid persisted ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export class CapabilityStore {
  constructor(private readonly db: DatabaseType) {}

  list(): StoredCapabilityRecord[] {
    const rows = this.db.prepare(
      `SELECT id, definition_fingerprint, descriptor_json, state, observed_at, authority, evidence_json
       FROM capability_records
       ORDER BY id ASC`,
    ).all() as CapabilityRecordRow[];

    return rows.map((row) => {
      const descriptor = parseJson<CapabilityDescriptor>(
        row.descriptor_json,
        `capability descriptor ${row.id}`,
      );
      if (!descriptor || descriptor.id !== row.id) {
        throw new Error(`Persisted capability identity mismatch for ${row.id}`);
      }
      const evidence = parseJson<string[]>(
        row.evidence_json || "[]",
        `capability evidence ${row.id}`,
      );
      if (!Array.isArray(evidence) || evidence.some((entry) => typeof entry !== "string")) {
        throw new Error(`Persisted capability evidence is invalid for ${row.id}`);
      }
      return {
        definitionFingerprint: row.definition_fingerprint,
        capability: {
          ...descriptor,
          state: row.state,
          available: row.state === "verified_available",
          observedAt: row.observed_at ?? descriptor.observedAt ?? null,
          authority: row.authority ?? descriptor.authority ?? null,
          evidence,
        },
      };
    });
  }

  upsert(capability: CapabilityDescriptor, definitionFingerprint: string): void {
    const state = capabilityStateOf(capability);
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO capability_records (
         id, definition_fingerprint, descriptor_json, state, observed_at,
         authority, evidence_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         definition_fingerprint = excluded.definition_fingerprint,
         descriptor_json = excluded.descriptor_json,
         state = excluded.state,
         observed_at = excluded.observed_at,
         authority = excluded.authority,
         evidence_json = excluded.evidence_json,
         updated_at = excluded.updated_at`,
    ).run(
      capability.id,
      definitionFingerprint,
      JSON.stringify(capability),
      state,
      capability.observedAt ?? null,
      capability.authority ?? null,
      JSON.stringify(capability.evidence ?? []),
      now,
      now,
    );
  }
}
''', encoding="utf-8")

    # Extend the existing registry in-place; no parallel authority.
    write("src/capabilities/registry.ts", r'''import type {
  CapabilityDescriptor,
  CapabilityState,
} from "./model.js";
import {
  capabilityStateOf,
  isCapabilityVerifiedAvailable,
} from "./model.js";
import type { EnvironmentSnapshot } from "../environments/types.js";
import {
  CapabilityStore,
  capabilityDefinitionFingerprint,
} from "./store.js";

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function hasValidObservation(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function normalizeClaimState(capability: CapabilityDescriptor): CapabilityState {
  const requestedState = capabilityStateOf(capability);
  if (requestedState !== "verified_available") return requestedState;

  const hasEvidence = (capability.evidence ?? []).some((entry) => entry.trim().length > 0);
  if (!hasEvidence || !hasValidObservation(capability.observedAt)) {
    return "probed";
  }
  return requestedState;
}

function environmentCapabilityState(
  snapshot: EnvironmentSnapshot,
  capability: CapabilityDescriptor,
): CapabilityState {
  if (snapshot.availability === "requires_authorization") return "unauthorized";
  if (snapshot.availability === "unavailable") return "unavailable";
  if (snapshot.availability === "unknown") return "unknown";
  if (snapshot.availability === "degraded") return "degraded";
  if (snapshot.availability === "available") {
    return capability.available ? "verified_available" : "unavailable";
  }
  return "unknown";
}

function cloneCapability(
  capability: CapabilityDescriptor,
  state: CapabilityState,
): CapabilityDescriptor {
  return {
    ...capability,
    state,
    available: state === "verified_available",
    requirements: [...capability.requirements],
    permissions: [...capability.permissions],
    inputs: capability.inputs ? [...capability.inputs] : undefined,
    outputs: capability.outputs ? [...capability.outputs] : undefined,
    evidence: capability.evidence ? [...capability.evidence] : undefined,
    metadata: capability.metadata ? { ...capability.metadata } : undefined,
  };
}

function isWeakInventoryAuthority(authority: string | null | undefined): boolean {
  return authority === "runtime:tool-definition" || authority === "runtime:skill-inventory";
}

export interface CapabilityProbeObservation {
  state: CapabilityState;
  authority: string;
  evidence: string[];
  observedAt?: string;
  metadata?: Record<string, unknown>;
}

export class CapabilityRegistry {
  private readonly entries = new Map<string, CapabilityDescriptor>();
  private readonly fingerprints = new Map<string, string>();

  constructor(private readonly store?: CapabilityStore) {
    this.hydrate();
  }

  private hydrate(): void {
    if (!this.store) return;
    for (const persisted of this.store.list()) {
      const computedFingerprint = capabilityDefinitionFingerprint(persisted.capability);
      const fingerprintMatches = computedFingerprint === persisted.definitionFingerprint;
      const candidate = fingerprintMatches
        ? persisted.capability
        : {
            ...persisted.capability,
            state: "discovered_unverified",
            available: false,
            authority: "capability-store:definition-mismatch",
            evidence: unique([
              ...(persisted.capability.evidence ?? []),
              "Persisted capability definition fingerprint did not match its descriptor; runtime verification was invalidated.",
            ]),
          };
      const normalized = cloneCapability(candidate, normalizeClaimState(candidate));
      this.entries.set(normalized.id, normalized);
      this.fingerprints.set(normalized.id, computedFingerprint);

      if (
        !fingerprintMatches ||
        capabilityStateOf(normalized) !== capabilityStateOf(persisted.capability) ||
        normalized.available !== persisted.capability.available
      ) {
        this.store.upsert(normalized, computedFingerprint);
      }
    }
  }

  private storeNormalized(
    capability: CapabilityDescriptor,
    definitionFingerprint = capabilityDefinitionFingerprint(capability),
  ): void {
    const normalized = cloneCapability(capability, normalizeClaimState(capability));
    this.entries.set(normalized.id, normalized);
    this.fingerprints.set(normalized.id, definitionFingerprint);
    this.store?.upsert(normalized, definitionFingerprint);
  }

  register(capability: CapabilityDescriptor): void {
    this.storeNormalized(capability);
  }

  private registerInventory(capability: CapabilityDescriptor): void {
    const definitionFingerprint = capabilityDefinitionFingerprint(capability);
    const existing = this.entries.get(capability.id);
    const existingFingerprint = this.fingerprints.get(capability.id);
    const canPreserveEvidenceBackedLifecycle =
      existing !== undefined &&
      existingFingerprint === definitionFingerprint &&
      !isWeakInventoryAuthority(existing.authority) &&
      (existing.evidence ?? []).some((entry) => entry.trim().length > 0) &&
      hasValidObservation(existing.observedAt);

    if (!canPreserveEvidenceBackedLifecycle || !existing) {
      this.storeNormalized(capability, definitionFingerprint);
      return;
    }

    this.storeNormalized({
      ...capability,
      state: capabilityStateOf(existing),
      available: existing.available,
      observedAt: existing.observedAt,
      authority: existing.authority,
      evidence: existing.evidence ? [...existing.evidence] : undefined,
      metadata: {
        ...(capability.metadata ?? {}),
        ...(existing.metadata ?? {}),
      },
    }, definitionFingerprint);
  }

  registerMany(capabilities: CapabilityDescriptor[]): void {
    for (const capability of capabilities) this.register(capability);
  }

  /**
   * Record an explicit runtime observation/probe against a known definition.
   * Every transition requires named authority, evidence, and a valid observation
   * time; state labels remain open-ended so providers are not forced into a
   * closed business taxonomy.
   */
  recordProbe(id: string, observation: CapabilityProbeObservation): CapabilityDescriptor {
    const current = this.entries.get(id);
    if (!current) throw new Error(`Cannot record probe for unknown capability: ${id}`);

    const state = observation.state.trim();
    const authority = observation.authority.trim();
    const evidence = unique(observation.evidence.map((entry) => entry.trim()).filter(Boolean));
    const observedAt = observation.observedAt ?? new Date().toISOString();
    if (!state) throw new Error(`Capability probe state is required for ${id}`);
    if (!authority) throw new Error(`Capability probe authority is required for ${id}`);
    if (evidence.length === 0) throw new Error(`Capability probe evidence is required for ${id}`);
    if (!hasValidObservation(observedAt)) {
      throw new Error(`Capability probe observedAt must be a valid timestamp for ${id}`);
    }

    this.register({
      ...current,
      state,
      available: state === "verified_available",
      observedAt,
      authority,
      evidence,
      metadata: {
        ...(current.metadata ?? {}),
        ...(observation.metadata ?? {}),
      },
    });
    return this.entries.get(id)!;
  }

  /**
   * Project an evidence-bearing environment observation into the generic
   * capability authority. Environment lifecycle remains authoritative for the
   * environment itself; this method only derives capability truth from that
   * observation.
   */
  registerEnvironmentSnapshot(snapshot: EnvironmentSnapshot): void {
    for (const capability of snapshot.capabilities) {
      const state = environmentCapabilityState(snapshot, capability);
      this.register({
        ...capability,
        state,
        available: state === "verified_available",
        observedAt: snapshot.observedAt,
        authority: `environment:${snapshot.id}`,
        evidence: unique([
          ...(capability.evidence ?? []),
          ...snapshot.evidence,
        ]),
        metadata: {
          ...(capability.metadata ?? {}),
          environmentAvailability: snapshot.availability,
          environmentObservedAt: snapshot.observedAt,
        },
      });
    }
  }

  get(id: string): CapabilityDescriptor | undefined {
    return this.entries.get(id);
  }

  list(options?: { availableOnly?: boolean; environment?: string }): CapabilityDescriptor[] {
    return [...this.entries.values()].filter((entry) => {
      if (options?.availableOnly && !isCapabilityVerifiedAvailable(entry)) return false;
      if (options?.environment && entry.environment !== options.environment) return false;
      return true;
    });
  }

  findSupporting(requirement: string): CapabilityDescriptor[] {
    const needle = requirement.trim().toLowerCase();
    if (!needle) return [];

    return this.list({ availableOnly: true }).filter((entry) => {
      const haystack = [
        entry.id,
        entry.type,
        entry.provider,
        entry.description,
        ...entry.requirements,
        ...(entry.inputs ?? []),
        ...(entry.outputs ?? []),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }

  ingestTools(tools: Array<{ name: string; description?: string }>): void {
    const observedAt = new Date().toISOString();
    for (const tool of tools) {
      this.registerInventory({
        id: `tool:${tool.name}`,
        type: "tool",
        provider: "abos",
        description: tool.description ?? tool.name,
        requirements: [],
        permissions: [],
        available: false,
        state: "discovered_unverified",
        observedAt,
        authority: "runtime:tool-definition",
        evidence: [
          "Tool definition is registered in the current ABOS runtime; external execution readiness has not been independently verified.",
        ],
      });
    }
  }

  ingestSkills(skills: Array<{ name: string; description?: string; enabled?: boolean }>): void {
    const observedAt = new Date().toISOString();
    for (const skill of skills) {
      const descriptor: CapabilityDescriptor = {
        id: `skill:${skill.name}`,
        type: "skill",
        provider: "abos",
        description: skill.description ?? skill.name,
        requirements: [],
        permissions: [],
        available: false,
        state: skill.enabled === false ? "unavailable" : "discovered_unverified",
        observedAt,
        authority: "runtime:skill-inventory",
        evidence: [
          skill.enabled === false
            ? "Skill is disabled in the current inventory."
            : "Skill is enabled in inventory, but inventory state alone is not execution-readiness evidence.",
        ],
      };
      if (skill.enabled === false) {
        this.register(descriptor);
      } else {
        this.registerInventory(descriptor);
      }
    }
  }
}
''')

    # Runtime loop hydrates the same registry from SQLite before inventory refresh.
    path = "src/agent/loop.ts"
    text = read(path)
    text = replace_once(
        text,
        'import { CapabilityRegistry } from "../capabilities/registry.js";\n',
        'import { CapabilityRegistry } from "../capabilities/registry.js";\nimport { CapabilityStore } from "../capabilities/store.js";\n',
        path,
    )
    text = replace_once(
        text,
        '  const capabilityRegistry = new CapabilityRegistry();',
        '  const capabilityRegistry = new CapabilityRegistry(new CapabilityStore(db.raw));',
        path,
    )
    write(path, text)

    # Restart/fingerprint/probe regressions.
    test_path = Path("src/__tests__/capability-persistence.test.ts")
    if test_path.exists():
        raise SystemExit("capability-persistence.test.ts already exists")
    test_path.write_text(r'''import { afterEach, describe, expect, it } from "vitest";
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
''', encoding="utf-8")

    # Live continuity reflects source work before validation, in the worktree only.
    path = "ProjectOps/plan/P-014.md"
    text = read(path)
    text = replace_once(
        text,
        "Evidence-State: AUDIT_COMPLETE / SOURCE_UNMODIFIED",
        "Evidence-State: V19_UNIT_IMPLEMENTED / VALIDATION_IN_PROGRESS",
        path,
    )
    write(path, text)

    path = "ProjectOps/continuity/C0010.md"
    text = read(path)
    text = replace_once(
        text,
        "Classification: DECISION_READY / SOURCE_UNMODIFIED",
        "Classification: DECISION_READY / V19_UNIT_VALIDATION_IN_PROGRESS",
        path,
    )
    write(path, text)

elif PHASE == "finalize":
    path = "ProjectOps/plan/P-014.md"
    text = read(path)
    text = replace_once(
        text,
        "Evidence-State: V19_UNIT_IMPLEMENTED / VALIDATION_IN_PROGRESS",
        "Evidence-State: V19_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING",
        path,
    )
    text += """

## Unidad source v19 — validación interna

- schema v19 `capability_records`: IMPLEMENTADO;
- `CapabilityStore` durable backing del registry existente: IMPLEMENTADO;
- hydration + persistence + definition fingerprint invalidation: IMPLEMENTADO;
- explicit evidence-backed `recordProbe()`: IMPLEMENTADO;
- runtime loop conectado al store: IMPLEMENTADO;
- restart/no-fake-readiness regressions: PASS en el aplicador;
- targeted capability tests: PASS;
- typecheck: PASS;
- build: PASS;
- full test suite: PASS;
- security-focused suite: PASS;
- ProjectOps verifier + `git diff --check`: PASS;
- estado: SOURCE_GREEN / exact ordinary CI+ProjectOps gate pendiente.
"""
    write(path, text)

    path = "ProjectOps/continuity/C0010.md"
    text = read(path)
    text = replace_once(
        text,
        "Classification: DECISION_READY / V19_UNIT_VALIDATION_IN_PROGRESS",
        "Classification: V19_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING",
        path,
    )
    text += """

### Checkpoint — primera unidad source v19

Implementado sin crear segunda authority:

- migration/schema v19 para estado durable de capability;
- `CapabilityStore` como backing SQLite del `CapabilityRegistry` existente;
- hydration/restart de lifecycle;
- fingerprint estructural que invalida evidencia cuando cambia la definición;
- `recordProbe()` exige authority + evidence + observedAt válido;
- reingesta débil de tool/skill inventory no promueve readiness y sólo conserva evidencia fuerte si el fingerprint coincide;
- environment snapshots continúan como authority upstream y persisten su proyección;
- runtime loop instancia el registry con el store durable;
- MCP runtime, acquisition pipeline y environment selection permanecen fuera de esta unidad.

Validación interna del aplicador: targeted tests, typecheck, build, full suite, security-focused suite, ProjectOps verifier y `git diff --check` PASS. Falta gate ordinario exact-head antes de ampliar la unidad.
"""
    write(path, text)

    path = "ProjectOps/CONTINUITY.md"
    text = read(path)
    text = replace_once(
        text,
        "Active-Intervention: P014_CAPABILITY_FABRIC — DECISION_READY / SOURCE_UNMODIFIED",
        "Active-Intervention: P014_CAPABILITY_FABRIC — V19_UNIT_SOURCE_GREEN / EXACT_GATE_PENDING",
        path,
    )
    write(path, text)
else:
    raise SystemExit(f"unknown phase: {PHASE}")
