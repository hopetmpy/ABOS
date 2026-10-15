/**
 * P-030 read-only economic projection over canonical owners.
 * Credit balances, task estimates and imputed resource valuations are not
 * automatically interchangeable or business revenue.
 */
import type { AbosDatabase } from "../types.js";
import type Database from "better-sqlite3";
import { getCommittedFinancialEffectCents, listUnresolvedFinancialEffects } from "./financial-effects.js";
import { getTreasuryReserveSnapshot } from "./treasury-reserves.js";

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
  /** Pending refund is a claim, not observed available liquidity. */
  pendingRefundCreditsCents?: number | null;
  /** Valuations supplied by evidence; never mixed with spend/credits or P&L. */
  resourceInvestment?: ResourceInvestmentObservation[];
}

export interface TaskCostCalibration {
  /** Only terminal tasks with both a positive estimate and observed cost. */
  comparableSamples: number;
  /** Terminal estimates without measured actual costs are not zero-cost wins. */
  estimatesAwaitingObservedCost: number;
  estimatedTaskCostCents: number | null;
  actualTaskCostCents: number | null;
  netDeviationTaskCostCents: number | null;
  actualToEstimateRatio: number | null;
  /** Separate observed upside misses from offsetting underruns; not a reserve mandate. */
  observedOverrunTaskCostCents?: number | null;
  largestObservedOverrunTaskCostCents?: number | null;
  observedOverrunSamples?: number;
  /** Observed terminal cost exists, but no positive prior estimate is available. */
  observedActualsWithoutEstimate?: number;
  /** Invalid negative task costs are excluded and surfaced, never netted away. */
  invalidCostSamples?: number;
  authority: "local_task_graph";
  /** No cross-unit conversion into Conway credits or external P&L. */
  unit: "task_cost_cent";
}

export interface TreasuryProjection {
  historicalTaskCostCalibration: TaskCostCalibration;
  observedCreditsCents: number | null;
  reservedCreditsCents: number | null;
  reserveSource: "durable" | "caller_supplied" | "unknown";
  otherCommittedCreditsCents: number | null;
  taskCommitmentCreditsCents: number | null;
  pendingTransferCreditsCents: number;
  pendingRefundCreditsCents: number | null;
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

/** Canonical read-only comparison from the task_graph SQLite owner. */
export function getTaskCostCalibration(db: Database.Database): TaskCostCalibration {
  // 0 is the schema default for actual cost and is not enough to establish
  // realized zero spending. Exclude those tasks from measured comparisons.
  const history = db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN estimated_cost_cents > 0 AND actual_cost_cents > 0 THEN 1 ELSE 0 END),0) AS comparable,
       COALESCE(SUM(CASE WHEN estimated_cost_cents > 0 AND actual_cost_cents = 0 THEN 1 ELSE 0 END),0) AS unobserved,
       COALESCE(SUM(CASE WHEN estimated_cost_cents > 0 AND actual_cost_cents > 0 THEN estimated_cost_cents ELSE 0 END),0) AS estimate,
       COALESCE(SUM(CASE WHEN estimated_cost_cents > 0 AND actual_cost_cents > 0 THEN actual_cost_cents ELSE 0 END),0) AS actual,
       COALESCE(SUM(CASE WHEN estimated_cost_cents > 0 AND actual_cost_cents > estimated_cost_cents
         THEN actual_cost_cents - estimated_cost_cents ELSE 0 END),0) AS overruns,
       COALESCE(MAX(CASE WHEN estimated_cost_cents > 0 AND actual_cost_cents > estimated_cost_cents
         THEN actual_cost_cents - estimated_cost_cents ELSE 0 END),0) AS largest_overrun,
       COALESCE(SUM(CASE WHEN estimated_cost_cents > 0 AND actual_cost_cents > estimated_cost_cents
         THEN 1 ELSE 0 END),0) AS overrun_samples,
       COALESCE(SUM(CASE WHEN estimated_cost_cents = 0 AND actual_cost_cents > 0
         THEN 1 ELSE 0 END),0) AS missing_estimate,
       COALESCE(SUM(CASE WHEN estimated_cost_cents < 0 OR actual_cost_cents < 0
         THEN 1 ELSE 0 END),0) AS invalid
     FROM task_graph
     WHERE status IN ('completed','failed','cancelled')`,
  ).get() as {
    comparable: number; unobserved: number; estimate: number; actual: number;
    overruns: number; largest_overrun: number; overrun_samples: number;
    missing_estimate: number; invalid: number;
  };
  const comparable = Number(history.comparable);
  const estimated = Number(history.estimate);
  const realized = Number(history.actual);
  const verifiedTotals = comparable > 0 && Number.isSafeInteger(estimated) &&
    Number.isSafeInteger(realized) && estimated > 0;
  const historicalTaskCostCalibration: TaskCostCalibration = {
    comparableSamples: comparable,
    estimatesAwaitingObservedCost: Number(history.unobserved),
    estimatedTaskCostCents: verifiedTotals ? estimated : null,
    actualTaskCostCents: verifiedTotals ? realized : null,
    netDeviationTaskCostCents: verifiedTotals ? realized - estimated : null,
    actualToEstimateRatio: verifiedTotals ? realized / estimated : null,
    observedOverrunTaskCostCents:
      verifiedTotals && Number.isSafeInteger(history.overruns) ? history.overruns : null,
    largestObservedOverrunTaskCostCents:
      verifiedTotals && Number.isSafeInteger(history.largest_overrun) ? history.largest_overrun : null,
    observedOverrunSamples:
      verifiedTotals && Number.isSafeInteger(history.overrun_samples) ? history.overrun_samples : 0,
    observedActualsWithoutEstimate: Number(history.missing_estimate),
    invalidCostSamples: Number(history.invalid),
    authority: "local_task_graph",
    unit: "task_cost_cent",
  };
  return historicalTaskCostCalibration;
}

/**
 * Read-only P-023/P-025 planning feedback from observed task outcomes.
 * Source is task_graph's estimate→actual comparison; there is no implicit
 * conversion into Conway credits, USDC, provider payments or realized P&L.
 */
export function describeTaskCostLearning(history: TaskCostCalibration): string | null {
  const signals: string[] = [];
  if (history.comparableSamples > 0 && history.actualToEstimateRatio !== null) {
    signals.push(
      `${history.comparableSamples} comparable terminal tasks, ` +
      `observed/estimated cost ratio=${history.actualToEstimateRatio.toFixed(3)}, ` +
      `net deviation=${history.netDeviationTaskCostCents} task_cost_cent`,
    );
    if (history.largestObservedOverrunTaskCostCents !== null &&
        history.largestObservedOverrunTaskCostCents !== undefined) {
      signals.push(
        `gross overruns=${history.observedOverrunTaskCostCents ?? "UNKNOWN"} ` +
        `task_cost_cent across ${history.observedOverrunSamples ?? "UNKNOWN"} samples; ` +
        `largest observed individual downside=${history.largestObservedOverrunTaskCostCents} task_cost_cent`,
      );
    }
  }
  if (history.estimatesAwaitingObservedCost > 0) {
    signals.push(`${history.estimatesAwaitingObservedCost} terminal estimates have no observed actual; never treat zero defaults as savings`);
  }
  if ((history.observedActualsWithoutEstimate ?? 0) > 0) {
    signals.push(`${history.observedActualsWithoutEstimate} actuals have no positive baseline; cannot calibrate those predictions`);
  }
  if ((history.invalidCostSamples ?? 0) > 0) {
    signals.push(`${history.invalidCostSamples} invalid negative samples excluded from calibration`);
  }
  if (!signals.length) return null;
  return (
    "Observed P-030 economic prediction→outcome feedback (task_graph authority, local task_cost_cent ONLY): " +
    signals.join("; ") + ". " +
    "Use these measurements to challenge future cost estimates, investigate causes of misses, compare alternatives and build context-sensitive contingencies. " +
    "They are not a mandated reserve or spending cap and cannot be added to Conway credits, USDC, verified invoices or business profit without independent same-unit evidence."
  );
}

export function getTreasuryProjection(
  db: AbosDatabase,
  input: TreasuryProjectionInput = {},
): TreasuryProjection {
  const observed = knownCents(input.observedCreditsCents, "observedCreditsCents");
  const statedReserve = knownCents(input.reservedCreditsCents, "reservedCreditsCents");
  const durableReserves = getTreasuryReserveSnapshot(db.raw);
  // Once durable reserves exist, caller input is never allowed to bypass them.
  // A supplied amount may confirm the owner, but may not replace it.
  if (durableReserves.initialized && statedReserve !== null &&
      statedReserve !== durableReserves.totalCreditsCents) {
    throw new Error("Caller reserve conflicts with durable treasury reserve authority");
  }
  const reserved = durableReserves.initialized
    ? durableReserves.totalCreditsCents : statedReserve;
  const reserveSource = durableReserves.initialized ? "durable" as const
    : statedReserve !== null ? "caller_supplied" as const : "unknown" as const;
  const other = knownCents(input.otherCommittedCreditsCents, "otherCommittedCreditsCents");
  const pendingRefund = knownCents(input.pendingRefundCreditsCents, "pendingRefundCreditsCents");
  const tasks = db.raw.prepare(
    `SELECT COALESCE(SUM(estimated_cost_cents), 0) AS amount,
            COALESCE(SUM(CASE WHEN estimated_cost_cents < 0 THEN 1 ELSE 0 END), 0) AS invalid_count
       FROM task_graph WHERE status IN ('assigned', 'running')`,
  ).get() as { amount: number; invalid_count: number };
  const activeTaskEstimatedCostCents = Number(tasks?.amount ?? 0);
  // Reject corrupt individual rows even when positive task estimates happen
  // to mask them in SQL SUM. This local unit is not a Conway credit balance.
  if (Number(tasks?.invalid_count ?? 0) > 0 ||
      !Number.isSafeInteger(activeTaskEstimatedCostCents) || activeTaskEstimatedCostCents < 0) {
    throw new Error("Active task estimates require exact nonnegative local task-cost cents");
  }
  const historicalTaskCostCalibration = getTaskCostCalibration(db.raw);
  const taskCredits = activeTaskEstimatedCostCents === 0
    ? 0 : knownCents(input.taskCommitmentCreditsCents, "taskCommitmentCreditsCents");
  const pending = getCommittedFinancialEffectCents(db.raw);
  const unresolved = listUnresolvedFinancialEffects(db.raw).length;

  // Financial-effect intents are measured in credit cents. Task_graph estimates
  // are not silently converted to credit commitments without an explicit
  // compatible valuation.
  const inputsComplete = [observed, reserved, other, taskCredits].every(v => v !== null);
  const obligations = inputsComplete
    ? [reserved!, other!, taskCredits!, pending].reduce((total, amount) => {
      if (!Number.isSafeInteger(amount) || amount < 0 ||
          !Number.isSafeInteger(total + amount)) {
        throw new Error("Treasury obligations exceed exact nonnegative safe integer credit accounting");
      }
      return total + amount;
    }, 0)
    : null;
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
    "A caller-supplied reserve is not a persisted internal allocation; durable treasury records govern once initialized.",
    "Task estimates are not converted to credit obligations without unit-compatible evidence.",
    "Resource valuations remain separate from actual invoice/ledger expense and revenue.",
    "Task estimate→actual history is local task-cost evidence, not automatically Conway credit spending, verified invoices or cash P&L.",
  ];
  if (historicalTaskCostCalibration.estimatesAwaitingObservedCost > 0) limitations.push(
    "Some terminal task estimates have no observed actual cost; missing measurements must not be treated as zero deviations.",
  );
  if (historicalTaskCostCalibration.observedActualsWithoutEstimate) limitations.push(
    "Some terminal task costs are observed without a positive prior estimate; do not infer prediction accuracy for them.",
  );
  if (historicalTaskCostCalibration.invalidCostSamples) limitations.push(
    "Some terminal task-cost observations contain invalid negative values; exclude them from financial calibration.",
  );
  if (freeCreditsCents === null) limitations.push(
    "Free credits UNKNOWN until fresh balance, commitments, contingencies and reserves are observed.",
  );
  if (pendingRefund !== null && pendingRefund > 0) limitations.push(
    "Pending refund is NOT liquid capital. It is excluded until confirmed in an observed provider balance.",
  );
  if (!input.resourceInvestment?.length) limitations.push(
    "Non-cash investment (time, electricity, subscriptions, compute) has not been valued from evidence.",
  );
  return {
    historicalTaskCostCalibration,
    observedCreditsCents: observed,
    reservedCreditsCents: reserved,
    reserveSource,
    otherCommittedCreditsCents: other,
    taskCommitmentCreditsCents: taskCredits,
    pendingTransferCreditsCents: pending,
    pendingRefundCreditsCents: pendingRefund,
    unresolvedFinancialEffects: unresolved,
    activeTaskEstimatedCostCents,
    freeCreditsCents,
    projectedCreditShortfallCents,
    separatelyValuedInvestment: keys.size ? groups : null,
    limitations,
  };
}
