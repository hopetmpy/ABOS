import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { ulid } from "ulid";
import {
  appendEvidenceEvent,
  correlationIdFor,
  currentEvidenceContext,
} from "../observability/evidence.js";

export type FinancialEffectState =
  | "prepared"
  | "dispatching"
  | "pending"
  | "unknown"
  | "rejected"
  | "reconciliation_required"
  | "completed";

export type FinancialEffectResolution =
  | "settled"
  | "rejected"
  | "pending"
  | "unknown";

export interface FinancialEffectRecord {
  id: string;
  operationKey: string;
  effectKind: string;
  fingerprint: string;
  amountCents: number;
  unit: string;
  recipient: string | null;
  childId: string | null;
  provider: string;
  providerEffectId: string | null;
  providerStatus: string | null;
  state: FinancialEffectState;
  transactionId: string | null;
  policyDecisionId: string | null;
  request: Record<string, unknown>;
  evidence: string[];
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  settledAt: string | null;
  completedAt: string | null;
}

export interface PrepareFinancialEffectInput {
  operationKey: string;
  effectKind: string;
  amountCents: number;
  unit?: string;
  recipient?: string | null;
  childId?: string | null;
  provider: string;
  policyDecisionId?: string | null;
  /** Safe, non-secret metadata needed to prove semantic identity/recovery. */
  request?: Record<string, unknown>;
  evidence?: string[];
}

export interface PrepareFinancialEffectResult {
  effect: FinancialEffectRecord;
  created: boolean;
}

export interface DispatchClaim {
  effect: FinancialEffectRecord;
  dispatchAllowed: boolean;
}

export interface FinancialEffectObservation {
  resolution: FinancialEffectResolution;
  providerEffectId?: string | null;
  providerStatus?: string | null;
  evidence?: string[];
  error?: string | null;
}

export interface FinancialEffectSettlementResult {
  effect: FinancialEffectRecord;
  materialized: boolean;
}

export class FinancialEffectIdempotencyConflictError extends Error {
  constructor(operationKey: string) {
    super(
      `Financial effect idempotency conflict for operation key ${operationKey}: ` +
        "the durable key already exists with different economic semantics.",
    );
    this.name = "FinancialEffectIdempotencyConflictError";
  }
}

export class FinancialEffectReconciliationRequiredError extends Error {
  readonly operationKey: string;

  constructor(operationKey: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Financial effect ${operationKey} is externally settled but local ` +
        `materialization requires reconciliation: ${reason}`,
    );
    this.name = "FinancialEffectReconciliationRequiredError";
    this.operationKey = operationKey;
  }
}

const NON_TERMINAL_STATES: readonly FinancialEffectState[] = [
  "prepared",
  "dispatching",
  "pending",
  "unknown",
  "reconciliation_required",
];

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty`);
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("amountCents must be a non-negative safe integer");
  }
  return value;
}

function uniqueEvidence(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

function safeRecordJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeStringArrayJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function rowToRecord(row: any): FinancialEffectRecord {
  return {
    id: row.id,
    operationKey: row.operation_key,
    effectKind: row.effect_kind,
    fingerprint: row.fingerprint,
    amountCents: row.amount_cents,
    unit: row.unit,
    recipient: row.recipient ?? null,
    childId: row.child_id ?? null,
    provider: row.provider,
    providerEffectId: row.provider_effect_id ?? null,
    providerStatus: row.provider_status ?? null,
    state: row.state as FinancialEffectState,
    transactionId: row.transaction_id ?? null,
    policyDecisionId: row.policy_decision_id ?? null,
    request: safeRecordJson(row.request_json || "{}"),
    evidence: safeStringArrayJson(row.evidence_json || "[]"),
    lastError: row.last_error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dispatchedAt: row.dispatched_at ?? null,
    settledAt: row.settled_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

export function financialEffectFingerprint(
  input: Omit<PrepareFinancialEffectInput, "operationKey" | "policyDecisionId" | "evidence">,
): string {
  const normalized = {
    effectKind: requireText(input.effectKind, "effectKind"),
    amountCents: normalizeAmount(input.amountCents),
    unit: requireText(input.unit ?? "credit_cent", "unit"),
    recipient: normalizeOptionalText(input.recipient),
    childId: normalizeOptionalText(input.childId),
    provider: requireText(input.provider, "provider"),
    request: canonicalValue(input.request ?? {}),
  };
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

function appendFinancialEffectEvidence(
  db: Database.Database,
  effect: FinancialEffectRecord,
  eventType: string,
  payload: Record<string, unknown>,
  epistemicStatus: "observation" | "unknown" = "observation",
): void {
  const context = currentEvidenceContext();
  appendEvidenceEvent(db, {
    correlationId:
      context?.correlationId ?? correlationIdFor("financial_effect", effect.id),
    causationId: context?.causationId ?? null,
    eventType,
    domain: "economic",
    authorityType: "financial_effect",
    authorityId: effect.id,
    goalId: context?.goalId ?? null,
    taskId: context?.taskId ?? null,
    turnId: context?.turnId ?? null,
    toolCallId: context?.toolCallId ?? null,
    epistemicStatus,
    payload: {
      operationKey: effect.operationKey,
      effectKind: effect.effectKind,
      amountCents: effect.amountCents,
      unit: effect.unit,
      recipient: effect.recipient,
      childId: effect.childId,
      provider: effect.provider,
      state: effect.state,
      ...payload,
    },
    provenance: {
      source: "financial_effects",
      policyDecisionId: effect.policyDecisionId,
    },
  });
}

export function getFinancialEffectByOperationKey(
  db: Database.Database,
  operationKey: string,
): FinancialEffectRecord | undefined {
  const row = db.prepare(
    "SELECT * FROM financial_effects WHERE operation_key = ?",
  ).get(operationKey) as any | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function getFinancialEffectById(
  db: Database.Database,
  id: string,
): FinancialEffectRecord | undefined {
  const row = db.prepare(
    "SELECT * FROM financial_effects WHERE id = ?",
  ).get(id) as any | undefined;
  return row ? rowToRecord(row) : undefined;
}

export function prepareFinancialEffect(
  db: Database.Database,
  input: PrepareFinancialEffectInput,
): PrepareFinancialEffectResult {
  const operationKey = requireText(input.operationKey, "operationKey");
  const effectKind = requireText(input.effectKind, "effectKind");
  const amountCents = normalizeAmount(input.amountCents);
  const unit = requireText(input.unit ?? "credit_cent", "unit");
  const recipient = normalizeOptionalText(input.recipient);
  const childId = normalizeOptionalText(input.childId);
  const provider = requireText(input.provider, "provider");
  const policyDecisionId = normalizeOptionalText(input.policyDecisionId);
  const request = input.request ?? {};
  const evidence = uniqueEvidence(input.evidence);
  const fingerprint = financialEffectFingerprint({
    effectKind,
    amountCents,
    unit,
    recipient,
    childId,
    provider,
    request,
  });

  const existing = getFinancialEffectByOperationKey(db, operationKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new FinancialEffectIdempotencyConflictError(operationKey);
    }
    return { effect: existing, created: false };
  }

  const id = ulid();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO financial_effects (
        id, operation_key, effect_kind, fingerprint, amount_cents, unit,
        recipient, child_id, provider, state, policy_decision_id,
        request_json, evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      operationKey,
      effectKind,
      fingerprint,
      amountCents,
      unit,
      recipient,
      childId,
      provider,
      policyDecisionId,
      JSON.stringify(canonicalValue(request)),
      JSON.stringify(evidence),
      now,
      now,
    );
    const inserted = getFinancialEffectById(db, id)!;
    appendFinancialEffectEvidence(db, inserted, "economic.financial_effect_prepared", {
      fingerprint,
    });
  })();

  return { effect: getFinancialEffectById(db, id)!, created: true };
}

/**
 * Atomically claims the one allowed external dispatch. Only a prepared effect
 * can transition to dispatching. Every later/restarted caller receives the
 * durable record but dispatchAllowed=false, preventing blind double execution.
 */
export function claimFinancialEffectDispatch(
  db: Database.Database,
  operationKey: string,
): DispatchClaim {
  const key = requireText(operationKey, "operationKey");
  let dispatchAllowed = false;

  db.transaction(() => {
    const now = new Date().toISOString();
    const result = db.prepare(
      `UPDATE financial_effects
       SET state = 'dispatching', dispatched_at = COALESCE(dispatched_at, ?),
           updated_at = ?, last_error = NULL
       WHERE operation_key = ? AND state = 'prepared'`,
    ).run(now, now, key);
    dispatchAllowed = result.changes === 1;
    if (dispatchAllowed) {
      const effect = getFinancialEffectByOperationKey(db, key)!;
      appendFinancialEffectEvidence(db, effect, "economic.financial_effect_dispatch_claimed", {});
    }
  })();

  const effect = getFinancialEffectByOperationKey(db, key);
  if (!effect) throw new Error(`Financial effect not found for operation key ${key}`);
  return { effect, dispatchAllowed };
}

export function recordFinancialEffectObservation(
  db: Database.Database,
  operationKey: string,
  observation: Exclude<FinancialEffectObservation, { resolution: "settled" }>,
): FinancialEffectRecord {
  const key = requireText(operationKey, "operationKey");
  if (observation.resolution === "settled") {
    throw new Error(
      "Settled observations must use settleFinancialEffect so accounting materialization is atomic.",
    );
  }
  const existing = getFinancialEffectByOperationKey(db, key);
  if (!existing) throw new Error(`Financial effect not found for operation key ${key}`);
  if (existing.state === "completed") return existing;

  const nextState: FinancialEffectState =
    observation.resolution === "rejected"
      ? "rejected"
      : observation.resolution === "pending"
        ? "pending"
        : "unknown";
  const now = new Date().toISOString();
  const mergedEvidence = uniqueEvidence([
    ...existing.evidence,
    ...(observation.evidence ?? []),
  ]);
  const providerEffectId =
    normalizeOptionalText(observation.providerEffectId) ?? existing.providerEffectId;
  const providerStatus =
    normalizeOptionalText(observation.providerStatus) ?? existing.providerStatus;
  const lastError = normalizeOptionalText(observation.error);

  db.transaction(() => {
    db.prepare(
      `UPDATE financial_effects
       SET state = ?, provider_effect_id = ?, provider_status = ?,
           evidence_json = ?, last_error = ?, updated_at = ?,
           completed_at = CASE WHEN ? = 'rejected' THEN ? ELSE completed_at END
       WHERE operation_key = ? AND state != 'completed'`,
    ).run(
      nextState,
      providerEffectId,
      providerStatus,
      JSON.stringify(mergedEvidence),
      lastError,
      now,
      nextState,
      now,
      key,
    );
    const updated = getFinancialEffectByOperationKey(db, key)!;
    appendFinancialEffectEvidence(
      db,
      updated,
      `economic.financial_effect_${nextState}`,
      {
        providerEffectId,
        providerStatus,
        error: lastError,
      },
      nextState === "unknown" ? "unknown" : "observation",
    );
  })();

  return getFinancialEffectByOperationKey(db, key)!;
}

/**
 * Apply a provider-observed settlement and the canonical accounting mutation in
 * one local SQLite transaction. If local materialization fails, the transaction
 * is rolled back and the durable effect is moved to reconciliation_required;
 * callers must not dispatch the external effect again.
 */
export function settleFinancialEffect(
  db: Database.Database,
  operationKey: string,
  observation: Omit<FinancialEffectObservation, "resolution"> & { resolution?: "settled" },
  materialize: (effect: FinancialEffectRecord) => string | null,
): FinancialEffectSettlementResult {
  const key = requireText(operationKey, "operationKey");
  const existing = getFinancialEffectByOperationKey(db, key);
  if (!existing) throw new Error(`Financial effect not found for operation key ${key}`);
  if (existing.state === "completed") {
    return { effect: existing, materialized: false };
  }
  if (existing.state === "rejected") {
    throw new Error(`Rejected financial effect ${key} cannot be settled without new evidence/intent`);
  }

  const providerEffectId =
    normalizeOptionalText(observation.providerEffectId) ?? existing.providerEffectId;
  const providerStatus =
    normalizeOptionalText(observation.providerStatus) ?? existing.providerStatus;
  const mergedEvidence = uniqueEvidence([
    ...existing.evidence,
    ...(observation.evidence ?? []),
  ]);
  const now = new Date().toISOString();

  try {
    let transactionId: string | null = null;
    db.transaction(() => {
      const current = getFinancialEffectByOperationKey(db, key)!;
      if (current.state === "completed") {
        transactionId = current.transactionId;
        return;
      }
      transactionId = materialize(current);
      db.prepare(
        `UPDATE financial_effects
         SET state = 'completed', provider_effect_id = ?, provider_status = ?,
             transaction_id = ?, evidence_json = ?, last_error = NULL,
             settled_at = ?, completed_at = ?, updated_at = ?
         WHERE operation_key = ?`,
      ).run(
        providerEffectId,
        providerStatus,
        transactionId,
        JSON.stringify(mergedEvidence),
        now,
        now,
        now,
        key,
      );
      const completed = getFinancialEffectByOperationKey(db, key)!;
      appendFinancialEffectEvidence(db, completed, "economic.financial_effect_completed", {
        providerEffectId,
        providerStatus,
        transactionId,
      });
    })();

    return {
      effect: getFinancialEffectByOperationKey(db, key)!,
      materialized: true,
    };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    const recoveryAt = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `UPDATE financial_effects
         SET state = 'reconciliation_required', provider_effect_id = ?,
             provider_status = ?, evidence_json = ?, last_error = ?,
             settled_at = COALESCE(settled_at, ?), updated_at = ?
         WHERE operation_key = ? AND state != 'completed'`,
      ).run(
        providerEffectId,
        providerStatus,
        JSON.stringify(mergedEvidence),
        error,
        recoveryAt,
        recoveryAt,
        key,
      );
      const recovery = getFinancialEffectByOperationKey(db, key)!;
      appendFinancialEffectEvidence(
        db,
        recovery,
        "economic.financial_effect_reconciliation_required",
        { providerEffectId, providerStatus, error },
      );
    })();
    throw new FinancialEffectReconciliationRequiredError(key, cause);
  }
}

export function listFinancialEffectsByStates(
  db: Database.Database,
  states: readonly FinancialEffectState[],
): FinancialEffectRecord[] {
  const normalized = [...new Set(states)];
  if (normalized.length === 0) return [];
  const placeholders = normalized.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT * FROM financial_effects
     WHERE state IN (${placeholders})
     ORDER BY created_at ASC, id ASC`,
  ).all(...normalized) as any[];
  return rows.map(rowToRecord);
}

export function listUnresolvedFinancialEffects(
  db: Database.Database,
): FinancialEffectRecord[] {
  return listFinancialEffectsByStates(db, NON_TERMINAL_STATES);
}

export function getCommittedFinancialEffectCents(
  db: Database.Database,
  unit = "credit_cent",
): number {
  const placeholders = NON_TERMINAL_STATES.map(() => "?").join(",");
  const row = db.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total
     FROM financial_effects
     WHERE unit = ? AND state IN (${placeholders})`,
  ).get(unit, ...NON_TERMINAL_STATES) as { total: number } | undefined;
  return Math.max(0, Number(row?.total ?? 0));
}
