/**
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

  const causationId = input.causationId == null
    ? null
    : requireLabel(input.causationId, "causationId");
  if (causationId) {
    const predecessor = db.prepare(
      "SELECT 1 FROM evidence_events WHERE id = ?",
    ).get(causationId);
    if (!predecessor) {
      throw new Error(
        `causationId must reference an existing evidence event: ${causationId}`,
      );
    }
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
    causationId,
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
