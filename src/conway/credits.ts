/**
 * Conway Credits Management
 *
 * Monitors the abos's compute credit balance and triggers
 * survival mode transitions.
 */

import type {
  ConwayClient,
  FinancialState,
  SurvivalTier,
} from "../types.js";
import { SURVIVAL_THRESHOLDS } from "../types.js";

/**
 * Check the current financial state of the abos.
 */
export async function checkFinancialState(
  conway: ConwayClient,
  usdcBalance: number,
): Promise<FinancialState> {
  const creditsCents = await conway.getCreditsBalance();

  return {
    creditsCents,
    usdcBalance,
    lastChecked: new Date().toISOString(),
  };
}

/**
 * Determine whether a successful HTTP transfer response represents an accepted
 * transfer rather than an explicit provider-side rejection.
 *
 * Conway may return forward-compatible positive/intermediate statuses such as
 * submitted or processing, so this deliberately rejects explicit negative
 * semantics instead of imposing a closed allowlist of success states.
 */
export function isCreditTransferAccepted(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  if (!normalized) return false;

  return ![
    "fail",
    "error",
    "reject",
    "declin",
    "cancel",
    "denied",
    "invalid",
  ].some((marker) => normalized.includes(marker));
}

/**
 * Determine the survival tier based on current credits.
 * Thresholds are checked in descending order: high > normal > low_compute > critical > dead.
 *
 * Zero credits = "critical" (broke but alive — can still accept funding, send distress).
 * Only negative balance (API-confirmed debt) = "dead".
 */
export function getSurvivalTier(creditsCents: number): SurvivalTier {
  if (creditsCents > SURVIVAL_THRESHOLDS.high) return "high";
  if (creditsCents > SURVIVAL_THRESHOLDS.normal) return "normal";
  if (creditsCents > SURVIVAL_THRESHOLDS.low_compute) return "low_compute";
  if (creditsCents >= 0) return "critical";
  return "dead";
}

/**
 * Format a credit amount for display.
 */
export function formatCredits(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
