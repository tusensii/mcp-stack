/**
 * Metric resolution shared by analytics tools (baseline_compare,
 * period_compare, correlation, intervention_analysis).
 *
 * Each `Metric` maps to an Oura endpoint + field. `fetchMetricByDay`
 * returns a `Map<YYYY-MM-DD, number | null>` covering every day in
 * `[start, end]` inclusive, with null for days where the ring has no
 * sample.
 *
 * Conventions:
 * - For sleep-derived metrics (hrv, rhr, sleep_total, deep_sleep,
 *   rem_sleep, respiratory_rate) we pull from `/sleep` and pick the
 *   longest-duration period per day as the "main" sleep, filtering out
 *   `type === "deleted"`. Naps and rest periods are excluded from the
 *   canonical value to keep one-value-per-day semantics.
 * - `rhr` uses `lowest_heart_rate` from the main sleep period — this
 *   matches Oura's standard "resting heart rate" definition (lowest
 *   during sleep).
 * - Sleep-duration metrics (sleep_total/deep_sleep/rem_sleep) are
 *   returned in SECONDS to match `oura_sleep_detail`.
 */
import type { OuraClient } from "./client.js";
import {
  getDailySleep,
  getDailyReadiness,
  getDailyActivity,
  getDailySpo2,
  getSleepPeriods,
  getEnhancedTags,
} from "./endpoints.js";
import type { SleepPeriod } from "./types.js";

// ---------------------------------------------------------------------------
// Tag overlay helper (shared by readiness / hrv_trend / respiratory_trend)
// ---------------------------------------------------------------------------

/**
 * Lightweight tag projection attached to per-date trend rows when callers
 * pass `overlay_tags`. Matches the field shape exposed by `oura_tags`: name,
 * optional comment, optional timestamp. Comment/timestamp are omitted (not
 * nulled) when Oura did not record them.
 */
export interface TagEntry {
  name: string;
  comment?: string;
  timestamp?: string;
}

/**
 * `overlay_tags` parameter accepts:
 *   - true       → attach every tag falling on each date
 *   - string[]   → attach only tags whose name matches one of the listed
 *                  names (exact, case-insensitive)
 *   - false/undef → no tags, no extra API call (handled by callers)
 */
export type OverlayTagsFilter = boolean | string[];

/**
 * Display name for a tag. Oura's enhanced_tag endpoint exposes a
 * `tag_type_code` (e.g. "tag_generic_alcohol") and an optional
 * `custom_name`. We prefer `custom_name` when set, otherwise fall back to
 * the type code. Mirrors the shape callers see from `oura_tags`.
 */
function tagDisplayName(t: { tag_type_code: string; custom_name: string | null }): string {
  return t.custom_name ?? t.tag_type_code;
}

/**
 * Fetch all tags overlapping `[start, end]` in a SINGLE paginated call and
 * return a date-keyed map. When `filter` is a string[], only tags whose
 * display name matches one of the entries (case-insensitive) are kept.
 *
 * The Oura `/enhanced_tag` endpoint filters server-side using a UTC-derived
 * comparison on `start_time`, not on the tag's `start_day` field. A tag
 * whose `start_day` falls inside `[start, end]` can still be dropped from
 * the response if its `start_time`, converted to UTC, lands on the next
 * (or previous) calendar day — e.g. an evening 2026-04-11 tag in -07:00
 * with UTC `start_time` of 2026-04-12T03:17:54Z disappears from a query
 * ending on 2026-04-12. To recover these tz-crossing tags we widen the
 * API window by one day on each side; bucketing still uses the tag's own
 * `start_day` below, so tags from the padding days bucket under their
 * own `start_day` keys and are simply never looked up by callers.
 */
export async function fetchTagsByDay(
  client: OuraClient,
  start: string,
  end: string,
  filter: OverlayTagsFilter,
): Promise<Map<string, TagEntry[]>> {
  const out = new Map<string, TagEntry[]>();
  if (filter === false) return out;
  const names =
    Array.isArray(filter)
      ? new Set(filter.map((n) => n.toLowerCase()))
      : null;
  const tags = await getEnhancedTags(client, {
    start_date: addDays(start, -1),
    end_date: addDays(end, 1),
  });
  for (const t of tags) {
    const name = tagDisplayName(t);
    if (names && !names.has(name.toLowerCase())) continue;
    const entry: TagEntry = { name };
    if (t.comment) entry.comment = t.comment;
    if (t.start_time) entry.timestamp = t.start_time;
    const list = out.get(t.start_day) ?? [];
    list.push(entry);
    out.set(t.start_day, list);
  }
  return out;
}

export const METRIC_NAMES = [
  "readiness",
  "sleep_score",
  "hrv",
  "rhr",
  "sleep_total",
  "deep_sleep",
  "rem_sleep",
  "respiratory_rate",
  "spo2",
  "activity_score",
] as const;

export type Metric = (typeof METRIC_NAMES)[number];

/** Iterate every YYYY-MM-DD between start and end inclusive (UTC-safe). */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return out;
  for (let t = s.getTime(); t <= e.getTime(); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Add `n` days to a YYYY-MM-DD date and return the new YYYY-MM-DD (UTC-safe). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Build a Map of YYYY-MM-DD → value for every day in [start, end]. */
function buildSeries(
  start: string,
  end: string,
  source: Map<string, number | null>,
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const day of eachDay(start, end)) {
    out.set(day, source.has(day) ? (source.get(day) ?? null) : null);
  }
  return out;
}

export async function fetchMetricByDay(
  client: OuraClient,
  metric: Metric,
  start: string,
  end: string,
): Promise<Map<string, number | null>> {
  const range = { start_date: start, end_date: end };

  switch (metric) {
    case "readiness": {
      const data = await getDailyReadiness(client, range);
      const source = new Map<string, number | null>();
      for (const r of data) source.set(r.day, r.score);
      return buildSeries(start, end, source);
    }
    case "sleep_score": {
      const data = await getDailySleep(client, range);
      const source = new Map<string, number | null>();
      for (const r of data) source.set(r.day, r.score);
      return buildSeries(start, end, source);
    }
    case "activity_score": {
      const data = await getDailyActivity(client, range);
      const source = new Map<string, number | null>();
      for (const r of data) source.set(r.day, r.score);
      return buildSeries(start, end, source);
    }
    case "spo2": {
      const data = await getDailySpo2(client, range);
      const source = new Map<string, number | null>();
      for (const r of data) {
        source.set(r.day, r.spo2_percentage?.average ?? null);
      }
      return buildSeries(start, end, source);
    }
    case "hrv":
    case "rhr":
    case "sleep_total":
    case "deep_sleep":
    case "rem_sleep":
    case "respiratory_rate": {
      // Oura's /sleep endpoint filters by `bedtime_start` (or similar), not
      // by the `day` field we key on. A sleep period with `day = D` can have
      // `bedtime_start` on D-1 (evening) and so be excluded from a tight
      // `start=end=D` query. Pad the API window by one day on each side so
      // single-day callers like baseline_compare see the same periods that
      // wider-window callers (hrv_trend, daily_readiness) see. We then
      // restrict the returned series back to [start, end] via buildSeries.
      const paddedRange = {
        start_date: addDays(start, -1),
        end_date: addDays(end, 1),
      };
      const periods = await getSleepPeriods(client, paddedRange);

      // Group periods by p.day and, for the requested metric, pick the
      // longest-duration period whose value for that metric is non-null
      // (falling back to the longest period overall if every value is
      // null). Mirrors oura_hrv_trend's PR #10 dedup logic so cross-tool
      // results agree on dates with multiple sleep periods (main + nap).
      const valueFor = (p: SleepPeriod): number | null => {
        switch (metric) {
          case "hrv":
            return p.average_hrv;
          case "rhr":
            return p.lowest_heart_rate;
          case "sleep_total":
            return p.total_sleep_duration;
          case "deep_sleep":
            return p.deep_sleep_duration;
          case "rem_sleep":
            return p.rem_sleep_duration;
          case "respiratory_rate":
            return p.average_breath;
        }
      };
      const byDay = new Map<string, SleepPeriod[]>();
      for (const p of periods) {
        if (p.type === "deleted") continue;
        const list = byDay.get(p.day) ?? [];
        list.push(p);
        byDay.set(p.day, list);
      }
      const source = new Map<string, number | null>();
      for (const [day, group] of byDay) {
        const sorted = [...group].sort(
          (a, b) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0),
        );
        const chosen = sorted.find((p) => valueFor(p) !== null) ?? sorted[0];
        if (!chosen) continue;
        source.set(day, valueFor(chosen));
      }
      return buildSeries(start, end, source);
    }
  }
}
