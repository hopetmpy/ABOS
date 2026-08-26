/**
 * Freshness checks for Jintel-provided snapshots whose staleness policy
 * currently lives on the consumer side.
 */

const SHORT_INTEREST_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;

export function isShortInterestFresh(dateIso: string | null | undefined): boolean {
  if (!dateIso) return false;
  const ts = Date.parse(dateIso);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= SHORT_INTEREST_MAX_AGE_MS;
}
