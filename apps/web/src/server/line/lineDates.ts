/**
 * Dates for LINE bot entries, fixed to Asia/Taipei (UTC+8).
 *
 * LINE never sends a timezone - only `event.timestamp`, a UTC epoch
 * millisecond. Taiwan has observed no daylight saving since 1979, so a fixed
 * offset is exact (not an approximation that drifts twice a year), and it
 * sidesteps pulling in a timezone database for one constant. A per-user
 * timezone is deferred - see the plan's §14.
 */
export const LINE_UTC_OFFSET_MINUTES = 480;

/** "YYYY-MM-DD" in Taiwan time for a UTC epoch millisecond timestamp. */
export function lineDateKey(timestampMs: number): string {
  const shifted = new Date(timestampMs + LINE_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** The first day of the month a "YYYY-MM-DD" date key falls in. */
export function lineMonthStart(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}
