/**
 * P-030 internal credit reserve authority.
 *
 * Reserve rows are local earmarks, not provider transfers, expenses, wallet
 * balances or verified settlements. This append-only journal is intentionally
 * separate from financial_effects (external dispatch/reconciliation) and from
 * transactions (settled accounting). Every change is idempotent across restart.
 */
import type { AbosDatabase } from "../types.js";
import type Database from "better-sqlite3";
import { appendEvidenceEvent, correlationIdFor, currentEvidenceContext } from "../observability/evidence.js";
import { getTreasuryProjection } from "./treasury-projection.js";

export interface TreasuryReserveAllocation {
  operationKey: string;
  reserveKey: string;
  targetCreditsCents: number;
  decisionId: string;
  decisionEvidence: string;
  observedCreditsCents: number | null;
  balanceEvidence: string | null;
  sequence: number;
  createdAt: string;
}

export interface TreasuryReserveSnapshot {
  initialized: boolean;
  totalCreditsCents: number;
  allocations: TreasuryReserveAllocation[];
}

export interface SetTreasuryReserveInput {
  /** Stable key for this exact decision, distinct from the reserve's identity. */
  operationKey: string;
  reserveKey: string;
  /** Absolute target for this reserve, zero means an explicit release. */
  targetCreditsCents: number;
  /** Correlates to existing P-025/Policy decision; does not grant authority. */
  decisionId: string;
  decisionEvidence: string;
  /** Externally observed Conway credit amount supplied by caller, never local P&L. */
  observedCreditsCents?: number | null;
  /** Provenance for the supplied credit observation; NOT provider authentication. */
  balanceEvidence?: string | null;
  otherCommittedCreditsCents?: number | null;
  /** Needed if task_graph contains active tasks; do not convert task_cost_cent. */
  taskCommitmentCreditsCents?: number | null;
}

export interface SetTreasuryReserveResult {
  allocation: TreasuryReserveAllocation;
  applied: boolean;
  currentTotalCreditsCents: number;
}

function requireText(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(label + " is required");
  return value.trim();
}

function amount(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label + " must be exact nonnegative credit cents");
  return value;
}

function toAllocation(row: any): TreasuryReserveAllocation {
  return {
    sequence: row.sequence,
    operationKey: row.operation_key,
    reserveKey: row.reserve_key,
    targetCreditsCents: row.target_credit_cents,
    decisionId: row.decision_id,
    decisionEvidence: row.decision_evidence,
    observedCreditsCents: row.observed_credit_cents,
    balanceEvidence: row.balance_evidence,
    createdAt: row.created_at,
  };
}

/** Latest event per reserve is authoritative. History remains immutable. */
export function getTreasuryReserveSnapshot(db: Database.Database): TreasuryReserveSnapshot {
  const rows = db.prepare(
    `SELECT e.* FROM treasury_reserve_allocations e
       JOIN (SELECT reserve_key, MAX(sequence) AS last_seq
               FROM treasury_reserve_allocations GROUP BY reserve_key) latest
         ON e.reserve_key = latest.reserve_key AND e.sequence = latest.last_seq
       ORDER BY e.reserve_key`,
  ).all() as any[];
  const allocations = rows.map(toAllocation);
  let totalCreditsCents = 0;
  for (const item of allocations) {
    if (!Number.isSafeInteger(item.targetCreditsCents) || item.targetCreditsCents < 0 ||
        !Number.isSafeInteger(totalCreditsCents + item.targetCreditsCents)) {
      throw new Error("Treasury reserve total exceeds exact safe credit accounting");
    }
    totalCreditsCents += item.targetCreditsCents;
  }
  return { initialized: allocations.length > 0, totalCreditsCents, allocations };
}

/**
 * Set a durable internal reserve to a new absolute target, including zero.
 * Positive increases need an observed credit-unit balance and complete
 * same-unit obligations; reductions can occur even during observation outages.
 * This function never sends provider requests or writes settled transactions.
 */
export function setTreasuryReserve(
  db: AbosDatabase,
  input: SetTreasuryReserveInput,
): SetTreasuryReserveResult {
  const operationKey = requireText(input.operationKey, "operationKey");
  const reserveKey = requireText(input.reserveKey, "reserveKey");
  const decisionId = requireText(input.decisionId, "decisionId");
  const decisionEvidence = requireText(input.decisionEvidence, "decisionEvidence");
  const targetCreditsCents = amount(input.targetCreditsCents, "targetCreditsCents");
  if (targetCreditsCents === null) throw new Error("targetCreditsCents is required");
  const observedCreditsCents = amount(input.observedCreditsCents, "observedCreditsCents");
  const balanceEvidence = input.balanceEvidence?.trim() || null;
  const otherCommittedCreditsCents = amount(input.otherCommittedCreditsCents, "otherCommittedCreditsCents");
  const taskCommitmentCreditsCents = amount(input.taskCommitmentCreditsCents, "taskCommitmentCreditsCents");

  return db.raw.transaction((): SetTreasuryReserveResult => {
    const existing = db.raw.prepare(
      "SELECT * FROM treasury_reserve_allocations WHERE operation_key = ?",
    ).get(operationKey) as any | undefined;
    if (existing) {
      const prior = toAllocation(existing);
      if (prior.reserveKey !== reserveKey || prior.targetCreditsCents !== targetCreditsCents ||
          prior.decisionId !== decisionId || prior.decisionEvidence !== decisionEvidence ||
          prior.observedCreditsCents !== observedCreditsCents ||
          prior.balanceEvidence !== balanceEvidence) {
        throw new Error("Treasury reserve operation key conflicts with an earlier decision");
      }
      return {
        allocation: prior, applied: false,
        currentTotalCreditsCents: getTreasuryReserveSnapshot(db.raw).totalCreditsCents,
      };
    }

    const snapshot = getTreasuryReserveSnapshot(db.raw);
    const prior = snapshot.allocations.find(x => x.reserveKey === reserveKey)?.targetCreditsCents ?? 0;
    const nextTotal = snapshot.totalCreditsCents - prior + targetCreditsCents;
    if (!Number.isSafeInteger(nextTotal) || nextTotal < 0) {
      throw new Error("Treasury reserve total exceeds exact safe credit accounting");
    }
    const increasing = targetCreditsCents > prior;
    if (increasing && (observedCreditsCents === null || !balanceEvidence ||
        otherCommittedCreditsCents === null)) {
      throw new Error("Increasing reserve requires observed credit balance, provenance and known other commitments");
    }
    const now = new Date().toISOString();
    db.raw.prepare(
      `INSERT INTO treasury_reserve_allocations
        (operation_key, reserve_key, target_credit_cents, decision_id,
         decision_evidence, observed_credit_cents, balance_evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(operationKey, reserveKey, targetCreditsCents, decisionId,
      decisionEvidence, observedCreditsCents, balanceEvidence, now);

    if (increasing) {
      // Evaluate the NEW durable state, not a caller's stale reserve estimate.
      // An insufficient or unknown compatible obligation cannot fund an increase.
      const projection = getTreasuryProjection(db, {
        observedCreditsCents, otherCommittedCreditsCents,
        taskCommitmentCreditsCents,
      });
      if (projection.projectedCreditShortfallCents === null ||
          projection.projectedCreditShortfallCents > 0) {
        throw new Error("Cannot earmark credits against unknown or insufficient free liquidity");
      }
    }

    const row = db.raw.prepare(
      "SELECT * FROM treasury_reserve_allocations WHERE operation_key = ?",
    ).get(operationKey) as any;
    const allocation = toAllocation(row);
    const context = currentEvidenceContext();
    appendEvidenceEvent(db.raw, {
      correlationId: context?.correlationId ?? correlationIdFor("treasury_reserve", reserveKey),
      causationId: context?.causationId ?? null,
      eventType: increasing ? "treasury.reserve_increased" :
        targetCreditsCents < prior ? "treasury.reserve_reduced" : "treasury.reserve_maintained",
      domain: "economic",
      authorityType: "treasury_reserve",
      authorityId: reserveKey,
      goalId: context?.goalId ?? null,
      taskId: context?.taskId ?? null,
      turnId: context?.turnId ?? null,
      toolCallId: context?.toolCallId ?? null,
      epistemicStatus: "observation",
      payload: {
        operationKey, priorCreditsCents: prior, targetCreditsCents,
        totalReservedCreditsCents: nextTotal, unit: "credit_cent",
        decisionId, observedCreditsCents,
      },
      provenance: {
        source: "treasury_reserve_allocations",
        decisionEvidence,
        balanceEvidenceKind: balanceEvidence ? "caller_supplied" : "unavailable",
        balanceEvidence,
        economicOutcome: "internal_earmark_only",
      },
    });
    return { allocation, applied: true, currentTotalCreditsCents: nextTotal };
  })();
}
