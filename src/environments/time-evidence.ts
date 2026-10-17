/**
 * P-031 provider-resource timing evidence. Date.parse normalizes nonexistent
 * calendar days (e.g. February 30), so it alone cannot validate externally
 * supplied procurement deadlines or supplier contract timestamps.
 *
 * This only validates a timestamp's shape/calendar. It does NOT prove
 * clock freshness, issuer authenticity, quote terms or purchase authority.
 */
export function isExplicitInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const fields = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:[0-5]\d)$/.exec(value);
  if (!fields) return false;
  const year = Number(fields[1]);
  const month = Number(fields[2]);
  const day = Number(fields[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 &&
    day >= 1 && day <= monthDays[month - 1]! &&
    Number.isFinite(Date.parse(value));
}
