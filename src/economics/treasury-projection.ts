/**
 * P-030 read-only economic projection over canonical owners.
 * Credit balances, task estimates and imputed resource valuations are not
 * automatically interchangeable or business revenue.
 */
import type { AbosDatabase } from "../types.js";
import { getCommittedFinancialEffectCents, listUnresolvedFinancialEffects } from "./financial-effects.js";

export interface ResourceInvestmentObservation {
  allocationKey: string;
  resource: string;
  currency: string;
  amountCents: number;
  basis: "incremental_paid" | "subscription_allocated" | "imputed_resource";
  evidence: string;
}

export interface TreasuryProjectionInput {
  /** Fresh externally observed Conway credits balance, not cached bookkeeping. */
  observedCreditsCents?: number | null;
  /** Explicitly established credit reserve, or null when unmeasured. */
  reservedCreditsCents?: number | null;
  /** Obligations besides pending transfers and task estimates, null if unknown. */
  otherCommittedCreditsCents?: number | null;
  /** Explicitly valued estimated task obligations in the SAME Conway credit unit. */
  taskCommitmentCreditsCents?: number | null;
  /** Valuations supplied by evidence; never mixed with spend/credits or P&L. */
  resourceInvestment?: ResourceInvestmentObservation[];
}

export interface TreasuryProjection {
  observedCreditsCents: number | null;
  reservedCreditsCents: number | null;
  otherCommittedCreditsCents: number | null;
  taskCommitmentCreditsCents: number | null;
  pendingTransferCreditsCents: number;
  unresolvedFinancialEffects: number;
  activeTaskEstimatedCostCents: number;
  freeCreditsCents: number | null;
  projectedCreditShortfallCents: number | null;
  separatelyValuedInvestment: Record<string, number> | null;
  limitations: string[];
}

function knownCents(value: number | null | undefined, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be nonnegative integer cents`);
  return value;
}

export function getTreasuryProjection(
  db: AbosDatabase,
  input: TreasuryProjectionInput = {},
): TreasuryProjection {
  const observed = knownCents(input.observedCreditsCents, "observedCreditsCents");
  const reserved = knownCents(input.reservedCreditsCents, "reservedCreditsCents");
  const other = knownCents(input.otherCommittedCreditsCents, "otherCommittedCreditsCents");
  const tasks = db.raw.prepare(
    "SELECT COALESCE(SUM(estimated_cost_cents), 0) AS amount FROM task_graph WHERE status IN ('assigned', 'running')",
  ).get() as { amount: number };
  const activeTaskEstimatedCostCents = Math.max(0, Number(tasks?.amount ?? 0));
  const taskCredits = activeTaskEstimatedCostCents === 0
    ? 0 : knownCents(input.taskCommitmentCreditsCents, "taskCommitmentCreditsCents");
  const pending = getCommittedFinancialEffectCents(db.raw);
  const unresolved = listUnresolvedFinancialEffects(db.raw).length;

  // Financial-effect intents are measured in credit cents. Task_graph estimates
  // are not silently converted to credit commitments without an explicit
  // compatible valuation.
  const inputsComplete = [observed, reserved, other, taskCredits].every(v => v !== null);
  const obligations = inputsComplete
    ? reserved! + other! + taskCredits! + pending : null;
  const freeCreditsCents = obligations === null ? null : Math.max(0, observed! - obligations);
  const projectedCreditShortfallCents = obligations === null ? null : Math.max(0, obligations - observed!);

  const groups: Record<string, number> = {};
  const keys = new Set<string>();
  for (const item of input.resourceInvestment ?? []) {
    if (!item.allocationKey.trim() || !item.resource.trim() || !item.currency.trim() || !item.evidence.trim()) {
      throw new Error("Resource valuation requires a unique allocation, resource, currency and evidence");
    }
    if (keys.has(item.allocationKey)) throw new Error("Duplicate resource allocation must not be counted twice");
    keys.add(item.allocationKey);
    const value = knownCents(item.amountCents, "resource investment amount")!;
    const group = `${item.currency}:${item.basis}`;
    groups[group] = (groups[group] ?? 0) + value;
    if (!Number.isSafeInteger(groups[group])) throw new Error("Resource valuation total overflow");
  }
  const limitations = [
    "Credit liquidity and externally settled business P&L are different authorities.",
    "Task estimates are not converted to credit obligations without unit-compatible evidence.",
    "Resource valuations remain separate from actual invoice/ledger expense and revenue.",
  ];
  if (freeCreditsCents === null) limitations.push(
    "Free credits UNKNOWN until fresh balance, commitments, contingencies and reserves are observed.",
  );
  if (!input.resourceInvestment?.length) limitations.push(
    "Non-cash investment (time, electricity, subscriptions, compute) has not been valued from evidence.",
  );
  return {
    observedCreditsCents: observed,
    reservedCreditsCents: reserved,
    otherCommittedCreditsCents: other,
    taskCommitmentCreditsCents: taskCredits,
    pendingTransferCreditsCents: pending,
    unresolvedFinancialEffects: unresolved,
    activeTaskEstimatedCostCents,
    freeCreditsCents,
    projectedCreditShortfallCents,
    separatelyValuedInvestment: keys.size ? groups : null,
    limitations,
  };
}
