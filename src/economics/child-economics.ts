import type { AbosDatabase, ChildAbosAgent } from "../types.js";

/**
 * Economic observation supplied by a source that has stronger evidence than
 * the parent's local bookkeeping. All fields are optional because unknown
 * evidence must remain unknown rather than being coerced to zero.
 */
export interface ChildEconomicObservation {
  /** Directly observed child credit balance, in cents. */
  observedBalanceCents?: number | null;
  /** Revenue that can be causally attributed to this child, in cents. */
  attributedRevenueCents?: number | null;
  /** Explicit monetary unit of the attributed revenue, not task_cost_cent. */
  attributedRevenueUnit?: string | null;
  /** Causal source assertion; a text label alone is not provider verification. */
  attributedRevenueEvidence?: string | null;
  /** Separately observed expense in a monetary unit, never local task cost. */
  observedExpenseCents?: number | null;
  observedExpenseUnit?: string | null;
  observedExpenseEvidence?: string | null;
  /**
   * Capital exposure used as the denominator for ROI. Do not substitute
   * cumulative funding for exposure: funding is an allocation flow, not a
   * measured average capital-at-risk balance.
   */
  capitalExposureCents?: number | null;
  capitalExposureUnit?: string | null;
  evidence?: string[];
}

export type ChildProfitability =
  | "unknown"
  | "profitable"
  | "break_even"
  | "unprofitable";

export interface ChildEconomicSnapshot {
  childId: string;
  address: string;
  status: string;

  /**
   * Parent-local amount historically attributed as funding to the child.
   * This is NOT a live child balance and must never be treated as one.
   */
  trackedFundingCents: number;

  /** Direct child balance only when a real observation exists. */
  observedBalanceCents: number | null;

  /** Realized task execution cost still attributable to this address. */
  realizedTaskCostCents: number;

  /** Estimated cost of tasks currently assigned/running on this address. */
  activeCommitmentCents: number;

  completedTasks: number;
  failedTasks: number;
  activeTasks: number;

  /** Null until a real revenue attribution source exists. */
  attributedRevenueCents: number | null;
  /** Separately sourced monetary expense, not task_graph task_cost_cent. */
  observedExpenseCents: number | null;
  /** Exact unit of a calculated contribution, or null if not comparable. */
  netContributionUnit: string | null;

  /**
   * Same-unit monetary revenue minus separately observed monetary expense.
   * Not external verified profit without later provider/ledger reconciliation.
   */
  netContributionCents: number | null;

  /**
   * Net contribution / explicit capital exposure. Null until both numerator
   * and a defensible capital-exposure denominator are known.
   */
  roi: number | null;

  profitability: ChildProfitability;
  evidence: string[];
  limitations: string[];
}

interface TaskEconomicAggregate {
  realizedCostCents: number;
  activeCommitmentCents: number;
  completedTasks: number;
  failedTasks: number;
  activeTasks: number;
  /** Terminal task_cost_cent lacking positive source evidence cannot fund a P&L claim. */
  unobservedTerminalCosts: number;
}

export function getChildEconomicSnapshot(
  db: AbosDatabase,
  childAddress: string,
  observation: ChildEconomicObservation = {},
): ChildEconomicSnapshot {
  const child = findChild(db, childAddress);
  if (!child) {
    throw new Error(`Child economic snapshot unavailable: no child for ${childAddress}`);
  }

  const tasks = aggregateTaskEconomics(db, child.address);
  const observedBalanceCents = normalizeOptionalCents(
    observation.observedBalanceCents,
  );
  const attributedRevenueCents = normalizeOptionalCents(
    observation.attributedRevenueCents,
  );
  const capitalExposureCents = normalizeOptionalCents(
    observation.capitalExposureCents,
  );

  // task_graph costs are LOCAL task_cost_cent even if positive. Do not
  // subtract them from attributed revenue or claim external business profit.
  const observedExpenseCents = normalizeOptionalCents(observation.observedExpenseCents);
  const revenueUnit = normalizeMonetaryUnit(observation.attributedRevenueUnit);
  const expenseUnit = normalizeMonetaryUnit(observation.observedExpenseUnit);
  const exposureUnit = normalizeMonetaryUnit(observation.capitalExposureUnit);
  const revenueEvidence = observation.attributedRevenueEvidence?.trim();
  const expenseEvidence = observation.observedExpenseEvidence?.trim();
  const comparable = attributedRevenueCents !== null && observedExpenseCents !== null &&
    revenueUnit !== null && revenueUnit === expenseUnit &&
    Boolean(revenueEvidence) && Boolean(expenseEvidence);
  const candidateNet = comparable ? attributedRevenueCents! - observedExpenseCents! : null;
  const netContributionCents = candidateNet !== null && Number.isSafeInteger(candidateNet)
    ? candidateNet : null;
  const netContributionUnit = netContributionCents === null ? null : revenueUnit;
  const profitability = classifyProfitability(netContributionCents);
  const roi = netContributionCents !== null && capitalExposureCents !== null &&
    capitalExposureCents > 0 && exposureUnit === netContributionUnit
      ? netContributionCents / capitalExposureCents : null;

  const evidence = [
    `Parent ledger tracked funding: ${child.fundedAmountCents} cents.`,
    `Task graph booked positive terminal cost: ${tasks.realizedCostCents} task_cost_cent (LOCAL, not monetary paid expense).`,
    `Task graph active estimated commitment: ${tasks.activeCommitmentCents} task_cost_cent.`,
    ...(revenueEvidence ? [`Attributed revenue source asserted: ${revenueEvidence}`] : []),
    ...(expenseEvidence ? [`Observed monetary expense source asserted: ${expenseEvidence}`] : []),
    ...(observation.evidence ?? []),
  ];

  const limitations: string[] = [
    "children.funded_amount_cents is parent-local funding bookkeeping, not a live child wallet balance.",
  ];

  if (observedBalanceCents === null) {
    limitations.push(
      "Live child credit balance is unknown; no authoritative parent-side balance observation is currently wired.",
    );
  }

  if (attributedRevenueCents === null) {
    limitations.push(
      "Revenue is not causally attributed per child; profitability must remain unknown.",
    );
  }
  if (tasks.unobservedTerminalCosts > 0) {
    limitations.push(
      `${tasks.unobservedTerminalCosts} terminal task cost(s) are unobserved/invalid: task_graph default-zero is not measured zero cost. Child net contribution and profitability remain UNKNOWN.`,
    );
  }

  if (!comparable) {
    limitations.push("Net contribution/profitability UNKNOWN: attributed revenue and independently observed expense require matching explicit monetary units and distinct source evidence; local task_cost_cent cannot be subtracted as money.");
  } else {
    limitations.push("Same-unit contribution uses caller-supplied monetary observations, not independently verified external business P&L.");
  }
  if (capitalExposureCents !== null && netContributionCents !== null &&
      exposureUnit !== netContributionUnit) {
    limitations.push("ROI UNKNOWN: capital exposure is not stated in the same monetary unit as net contribution.");
  }

  if (capitalExposureCents === null) {
    limitations.push(
      "Capital exposure is unknown; ROI must remain unknown even when revenue is supplied.",
    );
  }

  limitations.push(
    "Task cost attribution can be incomplete when failed/replanned tasks clear assigned_to; no retrospective owner is fabricated.",
  );

  return {
    childId: child.id,
    address: child.address,
    status: child.status,
    trackedFundingCents: Math.max(0, Math.floor(child.fundedAmountCents)),
    observedBalanceCents,
    realizedTaskCostCents: tasks.realizedCostCents,
    activeCommitmentCents: tasks.activeCommitmentCents,
    completedTasks: tasks.completedTasks,
    failedTasks: tasks.failedTasks,
    activeTasks: tasks.activeTasks,
    attributedRevenueCents,
    observedExpenseCents,
    netContributionUnit,
    netContributionCents,
    roi,
    profitability,
    evidence,
    limitations,
  };
}

function findChild(
  db: AbosDatabase,
  address: string,
): ChildAbosAgent | undefined {
  return db.getChildren().find((child) => child.address === address);
}

function aggregateTaskEconomics(
  db: AbosDatabase,
  address: string,
): TaskEconomicAggregate {
  const row = db.raw
    .prepare(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN status IN ('completed','failed','cancelled')
             THEN MAX(actual_cost_cents, 0)
             ELSE 0
           END
         ), 0) AS realizedCostCents,
         COALESCE(SUM(
           CASE
             WHEN status IN ('assigned','running')
             THEN MAX(estimated_cost_cents, 0)
             ELSE 0
           END
         ), 0) AS activeCommitmentCents,
         COALESCE(SUM(CASE
           WHEN status IN ('completed','failed','cancelled')
                AND (actual_cost_cents <= 0 OR actual_cost_cents IS NULL
                     OR typeof(actual_cost_cents) != 'integer')
           THEN 1 ELSE 0 END),0) AS unobservedTerminalCosts,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedTasks,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedTasks,
         SUM(CASE WHEN status IN ('assigned','running') THEN 1 ELSE 0 END) AS activeTasks
       FROM task_graph
       WHERE assigned_to = ?`,
    )
    .get(address) as {
      realizedCostCents: number;
      activeCommitmentCents: number;
      completedTasks: number;
      failedTasks: number;
      activeTasks: number;
      unobservedTerminalCosts: number;
    };

  return {
    realizedCostCents: Math.max(0, Number(row?.realizedCostCents ?? 0)),
    activeCommitmentCents: Math.max(
      0,
      Number(row?.activeCommitmentCents ?? 0),
    ),
    completedTasks: Math.max(0, Number(row?.completedTasks ?? 0)),
    failedTasks: Math.max(0, Number(row?.failedTasks ?? 0)),
    activeTasks: Math.max(0, Number(row?.activeTasks ?? 0)),
    unobservedTerminalCosts: Math.max(0, Number(row?.unobservedTerminalCosts ?? 0)),
  };
}

function normalizeOptionalCents(value: number | null | undefined): number | null {
  // External economic observations are measured integer cents or UNKNOWN.
  // Clamping negative amounts or flooring fractions to zero would invent a
  // valid balance/revenue/exposure, and could manufacture P&L or ROI.
  if (!Number.isSafeInteger(value) || value! < 0) return null;
  return value!;
}

function normalizeMonetaryUnit(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const unit = value.trim().toUpperCase();
  // A local task_cost_cent is not an external monetary currency.
  return unit === "TASK_COST_CENT" ? null : unit;
}

function classifyProfitability(
  netContributionCents: number | null,
): ChildProfitability {
  if (netContributionCents === null) return "unknown";
  if (netContributionCents > 0) return "profitable";
  if (netContributionCents < 0) return "unprofitable";
  return "break_even";
}
