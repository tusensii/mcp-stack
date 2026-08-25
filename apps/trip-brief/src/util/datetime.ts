/**
 * Timezone-aware, deterministic date/time formatting.
 *
 * Every formatter here pins an explicit `timeZone` and locale, so rendering
 * the same data twice produces byte-identical output regardless of where the
 * build runs (#103's determinism requirement, and the reason CI output
 * matches a laptop's).
 */

const LOCALE = "en-US";

/** Noon UTC on an ISO date — safely inside the same calendar day everywhere in North America. */
function isoDateToInstant(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00Z`);
}

export function formatTime(date: Date | null, timeZone: string): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatWeekday(isoDate: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    weekday: "long",
  }).format(isoDateToInstant(isoDate));
}

export function formatShortWeekday(isoDate: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    weekday: "short",
  }).format(isoDateToInstant(isoDate));
}

/** "Friday, August 21" — the itinerary day heading. */
export function formatDayHeading(isoDate: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(isoDateToInstant(isoDate));
}

/** "Aug 21" — compact enough for table headers. */
export function formatShortDate(isoDate: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(isoDateToInstant(isoDate));
}

/** "August 21–23, 2026" for the report header. */
export function formatDateRange(start: string, end: string, timeZone: string): string {
  const startFmt = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    month: "long",
    day: "numeric",
  }).format(isoDateToInstant(start));
  if (start === end) {
    const year = new Intl.DateTimeFormat(LOCALE, { timeZone, year: "numeric" }).format(
      isoDateToInstant(start),
    );
    return `${startFmt}, ${year}`;
  }
  const endInstant = isoDateToInstant(end);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const endFmt = new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    ...(sameMonth ? { day: "numeric" } : { month: "long", day: "numeric" }),
  }).format(endInstant);
  const year = new Intl.DateTimeFormat(LOCALE, { timeZone, year: "numeric" }).format(
    endInstant,
  );
  return `${startFmt}–${endFmt}, ${year}`;
}

/** "August 24, 2026 at 3:05 PM PDT" — the report's last line. */
export function formatTimestamp(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
    .format(date)
    .replace(",", ",");
}

/** Inclusive list of ISO dates from start to end. */
export function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const endMs = Date.parse(`${end}T12:00:00Z`);
  let cursor = Date.parse(`${start}T12:00:00Z`);
  // Guard against a config that somehow slipped a reversed range past the schema.
  let guard = 0;
  while (cursor <= endMs && guard++ < 366) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return out;
}

/** The ISO date portion of an instant, as observed in `timeZone`. */
export function isoDateIn(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts; // en-CA yields YYYY-MM-DD
}
