// Default timezone assumed when user doesn't specify
const DEFAULT_TZ = "America/Los_Angeles";

/**
 * Returns today's date in user's local timezone as YYYY-MM-DD.
 */
export function todayInTz(tz = DEFAULT_TZ): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: tz });
}

/**
 * Returns a date N days before today in user's local timezone.
 */
export function daysAgoInTz(n: number, tz = DEFAULT_TZ): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

/**
 * Fills in default start/end dates (last 7 days) when omitted.
 */
export function resolveDateRange(
  start_date?: string,
  end_date?: string,
): { start_date: string; end_date: string } {
  const end = end_date ?? todayInTz();
  const start = start_date ?? daysAgoInTz(6); // 6 days ago + today = 7 days inclusive
  return { start_date: start, end_date: end };
}

/**
 * Validates a date range. Returns an error string if invalid, undefined if OK.
 * Cap: 90 days maximum window.
 */
export function validateDateRange(start_date: string, end_date: string): string | undefined {
  const start = new Date(start_date);
  const end = new Date(end_date);

  if (isNaN(start.getTime())) return `Invalid start_date: ${start_date}`;
  if (isNaN(end.getTime())) return `Invalid end_date: ${end_date}`;
  if (start > end) return `start_date must be before end_date`;

  const diffDays = (end.getTime() - start.getTime()) / 86_400_000;
  if (diffDays > 90) {
    return `Date range exceeds 90-day cap (got ${Math.round(diffDays)} days). Narrow the window.`;
  }

  return undefined;
}

/**
 * Validates a datetime range for heartrate queries.
 * Returns error string if invalid or exceeds 24h without explicit max_pages override.
 */
export function validateDatetimeRange(
  start_datetime: string,
  end_datetime: string,
  maxPagesExplicit: boolean,
): string | undefined {
  const start = new Date(start_datetime);
  const end = new Date(end_datetime);

  if (isNaN(start.getTime())) return `Invalid start_datetime: ${start_datetime}`;
  if (isNaN(end.getTime())) return `Invalid end_datetime: ${end_datetime}`;
  if (start >= end) return `start_datetime must be before end_datetime`;

  const diffHours = (end.getTime() - start.getTime()) / 3_600_000;
  if (diffHours > 24 && !maxPagesExplicit) {
    return `Heart rate window exceeds 24 hours (${Math.round(diffHours)}h). Set max_pages explicitly to allow larger windows.`;
  }

  return undefined;
}

export { textContent, errorContent } from "@mcp-stack/mcp-core";
