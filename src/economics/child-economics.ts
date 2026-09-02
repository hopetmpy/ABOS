import type { AbosDatabase, ChildAbosAgent } from "../types.js";

/**
 * Economic observation supplied by a source that has stronger evidence than
 * the parent's local bookkeeping. All fields are optional because unknown
 * evidence must remain unknown rather than being coerced to zero.
 */
export interface ChildEconomicObservation {
  /** Directly observed Conway-credit balance for the child, in cents. */
  observedBalanceCents?: number | null;
  /** Revenue that can be causally attributed to this child, in cents. */
  attributedRevenueCents?: number | null;
  /**
   * Capital exposure used as the denominator for ROI. Do not substitute
   * cumulative funding for exposure: funding is an allocation flow, not a
   * measured average capital-at-risk balance.
   */
  capitalExposureCents?: number | null;
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

  /** Realized task execution cost that remains attributable to this address. */
  realizedTaskCostCents: number;

  /** Estimated cost of tasks currently assigned/running on this address. */
  activeCommitmentCents: number;

  completedTasks: number;
  failedTasks: number;
  activeTasks: number;

  /** Null until a real revenue attribution source exists. */
  attributedRevenueCents: number | null;

  /**
   * Revenue minus realized task execution cost. Null when revenue is unknown.
   * Funding is intentionally not subtracted as an expense.
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

  const netContributionCents =
    attributedRevenueCents === null
      ? null
      : attributedRevenueCents - tasks.realizedCostCents;

  const profitability = classifyProfitability(netContributionCents);

  const roi =
    netContributionCents !== null &&
    capitalExposureCents !== null &&
    capitalExposureCents > 0
      ? netContributionCents / capitalExposureCents
      : null;

  const evidence = [
    `Parent ledger tracked funding: ${child.fundedAmountCents} cents.`,
    `Task graph realized attributable cost: ${tasks.realizedCostCents} cents.`,
    `Task graph active estimated commitment: ${tasks.activeCommitmentCents} cents.`,
    ...(observation.evidence ?? []),
  ];

  const limitations: string[] = [
    "children.funded_amount_cents is parent-local funding bookkeeping, not a live child wallet balance.",
  ];

  if (observedBalanceCents === null) {
    limitations.push(
      "Live child Conway-credit balance is unknown; no address-query balance authority is currently wired.",
    );
  }

  if (attributedRevenueCents === null) {
    limitations.push(
      "Revenue is not causally attributed per child; profitability must remain unknown.",
    );
  }

  if (capitalExposureCents === null) {
    limitations.push(
      "Capital exposure is unknown; ROI must remain unknown even when revenue is supplied.",
    );
  }

  limitations.push(
    "Task cost attribution can be incomplete when failed/replanned tasks clear assigned_to.",
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
  };
}

function normalizeOptionalCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function classifyProfitability(
  netContributionCents: number | null,
): ChildProfitability {
  if (netContributionCents === null) return "unknown";
  if (netContributionCents > 0) return "profitable";
  if (netContributionCents < 0) return "unprofitable";
  return "break_even";
}
