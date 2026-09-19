import { createHash } from "node:crypto";
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
    provides: canonicalStrings(capability.provides),
    permissions: canonicalStrings(capability.permissions),
    effects: canonicalStrings(capability.effects),
    dependencies: canonicalStrings(capability.dependencies),
    version: capability.version?.trim() || null,
    compatibility: canonicalStrings(capability.compatibility),
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
