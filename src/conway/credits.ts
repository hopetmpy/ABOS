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
 * Provider observation classification for a credit transfer.
 *
 * HTTP success is transport evidence, not settlement evidence. Intermediate or
 * future provider states remain pending/unknown until a final observation is
 * available. This prevents "not explicitly negative" from becoming money.
 */
export type CreditTransferDisposition =
  | "settled"
  | "rejected"
  | "pending"
  | "unknown";

const SETTLED_TRANSFER_STATUSES = new Set([
  "settled",
  "completed",
  "complete",
  "succeeded",
  "success",
  "confirmed",
]);

const PENDING_TRANSFER_STATUSES = new Set([
  "submitted",
  "processing",
  "pending",
  "queued",
  "accepted",
  "received",
]);

const REJECTED_TRANSFER_MARKERS = [
  "fail",
  "error",
  "reject",
  "declin",
  "cancel",
  "denied",
  "invalid",
] as const;

/**
 * Classify a provider transfer status without inventing settlement.
 *
 * Final success values must be explicit. Known intermediate states remain
 * pending. Explicit negative semantics are rejected. Empty or forward-compatible
 * states that ABOS does not understand remain unknown.
 */
export function classifyCreditTransferStatus(
  status: string | null | undefined,
): CreditTransferDisposition {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (!normalized) return "unknown";

  if (
    REJECTED_TRANSFER_MARKERS.some((marker) => normalized.includes(marker))
  ) {
    return "rejected";
  }

  if (SETTLED_TRANSFER_STATUSES.has(normalized)) return "settled";
  if (PENDING_TRANSFER_STATUSES.has(normalized)) return "pending";
  return "unknown";
}

/**
 * Backward-compatible helper for existing callers.
 *
 * "Accepted" now means final settlement, not merely a non-negative or
 * intermediate provider response. P-030 callers should prefer the richer
 * classifier and preserve pending/unknown explicitly.
 */
export function isCreditTransferAccepted(status: string): boolean {
  return classifyCreditTransferStatus(status) === "settled";
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
