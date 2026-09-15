from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")

def write(rel, content):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")

def one(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f"{label}: expected one match, got {n}")
    return text.replace(old, new, 1)

# Schema v18: a correlation index, not a second domain-state ledger.
schema_path = "src/state/schema.ts"
schema = read(schema_path)
schema = one(schema, "export const SCHEMA_VERSION = 17;", "export const SCHEMA_VERSION = 18;", "schema version")
if "MIGRATION_V18_EVIDENCE_FABRIC" in schema:
    raise RuntimeError("v18 migration already present")
schema += r'''

// === Correlatable Evidence Fabric v1 (P-013) ===
// This table owns only cross-domain causal/correlation evidence. Domain state
// remains authoritative in policy/self-mod/task/economic/environment/etc.
// Event/domain/authority strings are intentionally open-ended so future
// capabilities can participate without a schema allowlist.
export const MIGRATION_V18_EVIDENCE_FABRIC = `
  CREATE TABLE IF NOT EXISTS evidence_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    correlation_id TEXT NOT NULL,
    causation_id TEXT,
    event_type TEXT NOT NULL,
    domain TEXT NOT NULL,
    authority_type TEXT NOT NULL,
    authority_id TEXT,
    goal_id TEXT,
    task_id TEXT,
    turn_id TEXT,
    tool_call_id TEXT,
    epistemic_status TEXT NOT NULL DEFAULT 'observation',
    payload_json TEXT NOT NULL DEFAULT '{}',
    provenance_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_evidence_correlation
    ON evidence_events(correlation_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_evidence_causation
    ON evidence_events(causation_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_evidence_authority
    ON evidence_events(authority_type, authority_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_evidence_turn
    ON evidence_events(turn_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_evidence_tool_call
    ON evidence_events(tool_call_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_evidence_goal_task
    ON evidence_events(goal_id, task_id, sequence);
`;
'''
write(schema_path, schema)

# Wire migration into createDatabase().
db_path = "src/state/database.ts"
db = read(db_path)
db = one(
    db,
    "  MIGRATION_V17_SELF_MOD_TRANSACTION,\n} from \"./schema.js\";",
    "  MIGRATION_V17_SELF_MOD_TRANSACTION,\n  MIGRATION_V18_EVIDENCE_FABRIC,\n} from \"./schema.js\";",
    "database migration import",
)
db = one(
    db,
    "    {\n      version: 17,\n      apply: () => db.exec(MIGRATION_V17_SELF_MOD_TRANSACTION),\n    },\n  ];",
    "    {\n      version: 17,\n      apply: () => db.exec(MIGRATION_V17_SELF_MOD_TRANSACTION),\n    },\n    {\n      version: 18,\n      apply: () => db.exec(MIGRATION_V18_EVIDENCE_FABRIC),\n    },\n  ];",
    "database migration list",
)
write(db_path, db)

# Evidence fabric core.
write("src/observability/evidence.ts", r'''/**
 * P-013 Correlatable Evidence Fabric.
 *
 * This module owns cross-domain causal/correlation evidence only. It never
 * becomes the source of truth for policy, money, tasks, self-modification,
 * environments, inference cost, or adaptive state. Those authorities are
 * referenced by type/id.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";
import { ulid } from "ulid";

export type EvidenceEpistemicStatus =
  | "observation"
  | "estimate"
  | "inference"
  | "assumption"
  | "unknown";

export interface EvidenceContext {
  correlationId: string;
  causationId?: string | null;
  goalId?: string | null;
  taskId?: string | null;
  turnId?: string | null;
  toolCallId?: string | null;
  policyDecisionId?: string | null;
}

export interface EvidenceEventInput {
  id?: string;
  correlationId: string;
  causationId?: string | null;
  eventType: string;
  domain: string;
  authorityType: string;
  authorityId?: string | null;
  goalId?: string | null;
  taskId?: string | null;
  turnId?: string | null;
  toolCallId?: string | null;
  epistemicStatus?: EvidenceEpistemicStatus | string;
  payload?: unknown;
  provenance?: unknown;
  createdAt?: string;
}

export interface EvidenceEventRecord {
  sequence: number;
  id: string;
  correlationId: string;
  causationId: string | null;
  eventType: string;
  domain: string;
  authorityType: string;
  authorityId: string | null;
  goalId: string | null;
  taskId: string | null;
  turnId: string | null;
  toolCallId: string | null;
  epistemicStatus: string;
  payload: unknown;
  provenance: unknown;
  createdAt: string;
}

const contextStorage = new AsyncLocalStorage<Readonly<EvidenceContext>>();

const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "apikey",
  "privatekey",
  "secretkey",
  "clientsecret",
  "password",
  "passphrase",
  "accesstoken",
  "refreshtoken",
  "oauthtoken",
  "bearertoken",
  "token",
  "mnemonic",
  "seed",
  "seedphrase",
]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return (
    normalized.endsWith("apikey") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("secretkey") ||
    normalized.endsWith("clientsecret") ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("refreshtoken")
  );
}

function scrubString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED:SECRET]")
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)=)[^&#\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[REDACTED:PRIVATE_KEY]",
    );
}

/**
 * Produce a JSON-safe, structurally redacted evidence value.
 *
 * This is intentionally conservative rather than claiming universal secret
 * detection. Critical producers should minimize payloads and prefer IDs/hashes.
 */
export function redactEvidenceValue(value: unknown): unknown {
  const seen = new WeakSet<object>();

  const visit = (current: unknown): unknown => {
    if (current === null || current === undefined) return current ?? null;
    if (typeof current === "string") return scrubString(current);
    if (typeof current === "number" || typeof current === "boolean") return current;
    if (typeof current === "bigint") return current.toString();
    if (typeof current === "symbol" || typeof current === "function") {
      return `[UNSERIALIZABLE:${typeof current}]`;
    }
    if (current instanceof Date) return current.toISOString();
    if (current instanceof Error) {
      return {
        name: current.name,
        message: scrubString(current.message),
        code: typeof (current as any).code === "string" ? (current as any).code : undefined,
      };
    }
    if (Array.isArray(current)) {
      if (seen.has(current)) return "[CIRCULAR]";
      seen.add(current);
      const result = current.map(visit);
      seen.delete(current);
      return result;
    }
    if (typeof current === "object") {
      const object = current as Record<string, unknown>;
      if (seen.has(object)) return "[CIRCULAR]";
      seen.add(object);
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(object)) {
        result[key] = isSensitiveKey(key) ? "[REDACTED]" : visit(child);
      }
      seen.delete(object);
      return result;
    }
    return String(current);
  };

  return visit(value);
}

function requireLabel(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty`);
  return normalized;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { parseError: true };
  }
}

function deserialize(row: any): EvidenceEventRecord {
  return {
    sequence: row.sequence,
    id: row.id,
    correlationId: row.correlation_id,
    causationId: row.causation_id ?? null,
    eventType: row.event_type,
    domain: row.domain,
    authorityType: row.authority_type,
    authorityId: row.authority_id ?? null,
    goalId: row.goal_id ?? null,
    taskId: row.task_id ?? null,
    turnId: row.turn_id ?? null,
    toolCallId: row.tool_call_id ?? null,
    epistemicStatus: row.epistemic_status,
    payload: parseJson(row.payload_json),
    provenance: parseJson(row.provenance_json),
    createdAt: row.created_at,
  };
}

export function appendEvidenceEvent(
  db: Database.Database,
  input: EvidenceEventInput,
): EvidenceEventRecord {
  const id = input.id ?? ulid();
  const correlationId = requireLabel(input.correlationId, "correlationId");
  const eventType = requireLabel(input.eventType, "eventType");
  const domain = requireLabel(input.domain, "domain");
  const authorityType = requireLabel(input.authorityType, "authorityType");
  const epistemicStatus = requireLabel(input.epistemicStatus ?? "observation", "epistemicStatus");
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error(`createdAt is not a valid timestamp: ${createdAt}`);
  }

  const payload = redactEvidenceValue(input.payload ?? {});
  const provenance = redactEvidenceValue(input.provenance ?? {});

  db.prepare(
    `INSERT INTO evidence_events (
      id, correlation_id, causation_id, event_type, domain,
      authority_type, authority_id, goal_id, task_id, turn_id, tool_call_id,
      epistemic_status, payload_json, provenance_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    correlationId,
    input.causationId ?? null,
    eventType,
    domain,
    authorityType,
    input.authorityId ?? null,
    input.goalId ?? null,
    input.taskId ?? null,
    input.turnId ?? null,
    input.toolCallId ?? null,
    epistemicStatus,
    JSON.stringify(payload),
    JSON.stringify(provenance),
    createdAt,
  );

  return getEvidenceEvent(db, id)!;
}

export function getEvidenceEvent(
  db: Database.Database,
  id: string,
): EvidenceEventRecord | undefined {
  const row = db.prepare("SELECT * FROM evidence_events WHERE id = ?").get(id) as any | undefined;
  return row ? deserialize(row) : undefined;
}

export function getEvidenceByCorrelation(
  db: Database.Database,
  correlationId: string,
): EvidenceEventRecord[] {
  const rows = db.prepare(
    `SELECT * FROM evidence_events
     WHERE correlation_id = ?
     ORDER BY sequence ASC`,
  ).all(correlationId) as any[];
  return rows.map(deserialize);
}

export function getEvidenceByAuthority(
  db: Database.Database,
  authorityType: string,
  authorityId: string,
): EvidenceEventRecord[] {
  const rows = db.prepare(
    `SELECT * FROM evidence_events
     WHERE authority_type = ? AND authority_id = ?
     ORDER BY sequence ASC`,
  ).all(authorityType, authorityId) as any[];
  return rows.map(deserialize);
}

export function latestEvidenceByAuthority(
  db: Database.Database,
  authorityType: string,
  authorityId: string,
): EvidenceEventRecord | undefined {
  const row = db.prepare(
    `SELECT * FROM evidence_events
     WHERE authority_type = ? AND authority_id = ?
     ORDER BY sequence DESC LIMIT 1`,
  ).get(authorityType, authorityId) as any | undefined;
  return row ? deserialize(row) : undefined;
}

/** Use an existing domain identity as the correlation root; no registry needed. */
export function correlationIdFor(kind: string, id: string): string {
  return `${requireLabel(kind, "correlation kind")}:${requireLabel(id, "correlation authority id")}`;
}

export function runWithEvidenceContext<T>(
  context: EvidenceContext,
  fn: () => T,
): T {
  const normalized: Readonly<EvidenceContext> = Object.freeze({
    ...context,
    correlationId: requireLabel(context.correlationId, "correlationId"),
  });
  return contextStorage.run(normalized, fn);
}

export function currentEvidenceContext(): Readonly<EvidenceContext> | undefined {
  return contextStorage.getStore();
}
''')

# Focused tests for the new authority only.
write("src/__tests__/p013-evidence-fabric.test.ts", r'''import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../state/database.js";
import {
  MIGRATION_V18_EVIDENCE_FABRIC,
  SCHEMA_VERSION,
} from "../state/schema.js";
import {
  appendEvidenceEvent,
  correlationIdFor,
  currentEvidenceContext,
  getEvidenceByAuthority,
  getEvidenceByCorrelation,
  redactEvidenceValue,
  runWithEvidenceContext,
} from "../observability/evidence.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abos-p013-evidence-"));
  tempDirs.push(dir);
  return path.join(dir, "state.db");
}

describe("P-013 evidence fabric core", () => {
  it("creates schema v18 independently from the compactable memory event stream", () => {
    expect(SCHEMA_VERSION).toBe(18);
    const db = new Database(":memory:");
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);

    const columns = db.prepare("PRAGMA table_info(evidence_events)").all() as Array<{ name: string }>;
    const names = columns.map((column) => column.name);
    expect(names).toContain("correlation_id");
    expect(names).toContain("causation_id");
    expect(names).toContain("authority_type");
    expect(names).not.toContain("compacted_to");
    db.close();
  });

  it("applies v18 on a fresh canonical database", () => {
    const database = createDatabase(tempDbPath());
    const version = database.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(18);
    expect(
      database.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='evidence_events'").get(),
    ).toBeTruthy();
    database.raw.close();
  });

  it("appends an ordered causal chain without becoming domain state", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    const correlationId = correlationIdFor("turn", "turn-1");

    const first = appendEvidenceEvent(db, {
      correlationId,
      eventType: "policy.evaluated",
      domain: "policy",
      authorityType: "policy_decision",
      authorityId: "policy-1",
      turnId: "turn-1",
      toolCallId: "tool-1",
      payload: { action: "allow", argsHash: "abc" },
    });
    const second = appendEvidenceEvent(db, {
      correlationId,
      causationId: first.id,
      eventType: "self_mod.proposed",
      domain: "self_mod",
      authorityType: "self_mod_transaction",
      authorityId: "tx-1",
      turnId: "turn-1",
      toolCallId: "tool-1",
      payload: { status: "proposed" },
    });

    const chain = getEvidenceByCorrelation(db, correlationId);
    expect(chain.map((event) => event.id)).toEqual([first.id, second.id]);
    expect(chain[1].causationId).toBe(first.id);
    expect(getEvidenceByAuthority(db, "self_mod_transaction", "tx-1")).toHaveLength(1);
    db.close();
  });

  it("redacts structured secrets while preserving non-secret accounting fields", () => {
    const redacted = redactEvidenceValue({
      apiKey: "sk-super-secret-value-123456789",
      tokenCount: 321,
      nested: {
        authorization: "Bearer top.secret.token",
        url: "https://example.test/?access_token=secret-value&ok=1",
        message: "Authorization: Bearer another.secret.value",
      },
    }) as any;

    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.tokenCount).toBe(321);
    expect(redacted.nested.authorization).toBe("[REDACTED]");
    expect(redacted.nested.url).toContain("access_token=[REDACTED]");
    expect(redacted.nested.url).not.toContain("secret-value");
    expect(redacted.nested.message).toContain("Bearer [REDACTED]");
  });

  it("redacts payload before durable insertion", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    const event = appendEvidenceEvent(db, {
      correlationId: "turn:t1",
      eventType: "tool.observed",
      domain: "tool",
      authorityType: "tool_call",
      authorityId: "c1",
      payload: { password: "never-store-me", result: "ok" },
      provenance: { access_token: "never-store-this-either", producer: "test" },
    });

    expect(event.payload).toEqual({ password: "[REDACTED]", result: "ok" });
    expect(event.provenance).toEqual({ access_token: "[REDACTED]", producer: "test" });
    const raw = db.prepare("SELECT payload_json, provenance_json FROM evidence_events WHERE id = ?").get(event.id) as any;
    expect(raw.payload_json).not.toContain("never-store-me");
    expect(raw.provenance_json).not.toContain("never-store-this-either");
    db.close();
  });

  it("propagates correlation context across async work but does not treat process memory as durable authority", async () => {
    expect(currentEvidenceContext()).toBeUndefined();
    await runWithEvidenceContext(
      { correlationId: "turn:turn-7", turnId: "turn-7", toolCallId: "tool-7" },
      async () => {
        await Promise.resolve();
        expect(currentEvidenceContext()).toMatchObject({
          correlationId: "turn:turn-7",
          turnId: "turn-7",
          toolCallId: "tool-7",
        });
      },
    );
    expect(currentEvidenceContext()).toBeUndefined();
  });

  it("rejects empty correlation and event identity labels", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V18_EVIDENCE_FABRIC);
    expect(() => appendEvidenceEvent(db, {
      correlationId: " ",
      eventType: "x",
      domain: "test",
      authorityType: "test",
    })).toThrow(/correlationId cannot be empty/);
    expect(() => appendEvidenceEvent(db, {
      correlationId: "test:1",
      eventType: " ",
      domain: "test",
      authorityType: "test",
    })).toThrow(/eventType cannot be empty/);
    db.close();
  });
});
''')

print("P013_CORE_APPLY: PASS")
