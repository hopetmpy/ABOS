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
import { appendEvidenceEvent, correlationIdFor, currentEvidenceContext, getEvidenceByAuthority } from "../observability/evidence.js";
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
 * Read P-025's already materialized reviewed path, never infer its existence
 * from a caller's decisionEvidence text or a tool/policy approval alone.
 * P-023 outcomes remain separately owned by Adaptive Path Intelligence.
 */
function reviewedReservePath(
  db: Database.Database,
): { pathId: string; goalId: string } | null {
  const context = currentEvidenceContext();
  if (!context?.goalId || !context.taskId) return null;
  const row = db.prepare(
    `SELECT b.path_id AS pathId, b.goal_id AS goalId, p.status
       FROM adaptive_task_bindings b
       JOIN adaptive_paths p ON p.id = b.path_id AND p.goal_id = b.goal_id
       WHERE b.task_id = ? AND b.goal_id = ?`,
  ).get(context.taskId, context.goalId) as {
    pathId: string; goalId: string; status: string;
  } | undefined;
  if (!row || !["selected", "executing", "succeeded", "partial"].includes(row.status)) return null;
  const checkpoint = db.prepare(
    "SELECT value FROM kv WHERE key = ?",
  ).get(`orchestrator.review_feedback.${row.goalId}`) as { value: string } | undefined;
  // The primary P-025 orchestration only writes this after review approved
  // and the chosen Adaptive Path + tasks materialized in one transaction.
  if (!checkpoint?.value.split(" ; ").some(segment =>
    segment.trim() === `materialized_path=${row.pathId}`)) return null;
  return { pathId: row.pathId, goalId: row.goalId };
}

export interface TreasuryReserveLearning {
  reviewedPathLinked: number;
  reviewProvenanceUnknown: number;
  awaitingOutcome: number;
  inconclusive: number;
  confirmedStrategicOutcomes: number;
  contradictedStrategicOutcomes: number;
  /** Causal strategic observations are not actual spend/realized P&L. */
  observedReserveUseCreditsCents: null;
  unit: "credit_cent";
  limitations: string[];
}

/**
 * P-023 economic feedback projection from P-013 evidence:
 * reserve decision → verified P-025 path → later P-023 prediction resolution.
 * Neither a successful strategic path nor a reserve release establishes
 * provider settlement, actual contingency utilization or financial return.
 */
export function getTreasuryReserveLearning(db: Database.Database): TreasuryReserveLearning {
  const result: TreasuryReserveLearning = {
    reviewedPathLinked: 0,
    reviewProvenanceUnknown: 0,
    awaitingOutcome: 0,
    inconclusive: 0,
    confirmedStrategicOutcomes: 0,
    contradictedStrategicOutcomes: 0,
    observedReserveUseCreditsCents: null,
    unit: "credit_cent",
    limitations: [
      "P-023 strategic path resolution is not observed credit expenditure or business income.",
      "Actual risk utilization and provider finality remain UNKNOWN without same-unit economic settlement provenance.",
    ],
  };
  // Raw-DB orchestration embeddings may not materialize P-030's treasury
  // schema. Absence of that authority is unknown, not proof of zero reserves.
  const present = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='treasury_reserve_allocations'",
  ).get();
  if (!present) {
    result.limitations.push("Treasury reserve authority unavailable: allocation/outcome coverage UNKNOWN.");
    return result;
  }
  const current = getTreasuryReserveSnapshot(db).allocations;
  for (const allocation of current) {
    const recorded = getEvidenceByAuthority(db, "treasury_reserve", allocation.reserveKey)
      .findLast(event => {
        const payload = event.payload as Record<string, unknown> | null;
        return payload?.operationKey === allocation.operationKey;
      });
    const payload = recorded?.payload as Record<string, unknown> | null;
    const pathId = typeof payload?.reviewedStrategicPathId === "string"
      ? payload.reviewedStrategicPathId : null;
    if (!recorded || !pathId) {
      result.reviewProvenanceUnknown += 1;
      continue;
    }
    result.reviewedPathLinked += 1;
    // Only P-023 resolutions after the reserve decision may count as its
    // subsequent strategic outcome. A previously successful path is not proof.
    const events = getEvidenceByAuthority(db, "adaptive_path", pathId)
      .filter(event => event.eventType === "adaptive.prediction_resolved" &&
        event.sequence > recorded.sequence);
    const outcome = events.at(-1);
    if (!outcome) {
      // A nonterminal attempt can be classified only by the real P-023
      // comparison authority; do not upgrade it to confirmed/contradicted.
      const attempts = db.prepare(
        "SELECT id FROM adaptive_attempts WHERE path_id = ?",
      ).all(pathId) as { id: string }[];
      const comparisons = attempts.flatMap(item =>
        getEvidenceByAuthority(db, "adaptive_attempt", item.id))
        .filter(event => event.eventType === "adaptive.prediction_compared" &&
          event.sequence > recorded.sequence);
      if (comparisons.length) result.inconclusive += 1;
      else result.awaitingOutcome += 1;
      continue;
    }
    const status = (outcome.payload as Record<string, unknown> | null)?.resolution;
    if (status === "confirmed") result.confirmedStrategicOutcomes += 1;
    else if (status === "contradicted") result.contradictedStrategicOutcomes += 1;
    else result.inconclusive += 1;
  }
  return result;
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
      // Replay identity is the economic decision, not a fresh balance sample.
      // Preserve the original observation in the immutable journal, even if a
      // later retry has no provider access (or a different observed balance).
      if (prior.reserveKey !== reserveKey || prior.targetCreditsCents !== targetCreditsCents ||
          prior.decisionId !== decisionId || prior.decisionEvidence !== decisionEvidence) {
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
    const reviewedPath = reviewedReservePath(db.raw);
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
        reviewedStrategicPathId: reviewedPath?.pathId ?? null,
      },
      provenance: {
        source: "treasury_reserve_allocations",
        decisionEvidence,
        balanceEvidenceKind: balanceEvidence ? "caller_supplied" : "unavailable",
        balanceEvidence,
        economicOutcome: "internal_earmark_only",
        reviewProvenance: reviewedPath ? "materialized_p025_reviewed_path" : "unknown",
      },
    });
    return { allocation, applied: true, currentTotalCreditsCents: nextTotal };
  })();
}
