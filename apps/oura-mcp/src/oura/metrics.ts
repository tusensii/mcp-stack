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
} from "./endpoints.js";
import type { SleepPeriod } from "./types.js";

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

/**
 * Pick the longest-duration sleep period per day, ignoring deleted entries.
 * Returns Map<day, SleepPeriod>.
 */
function mainSleepPerDay(periods: SleepPeriod[]): Map<string, SleepPeriod> {
  const byDay = new Map<string, SleepPeriod>();
  for (const p of periods) {
    if (p.type === "deleted") continue;
    const existing = byDay.get(p.day);
    const existingDur = existing?.total_sleep_duration ?? -1;
    const candidateDur = p.total_sleep_duration ?? -1;
    if (!existing || candidateDur > existingDur) byDay.set(p.day, p);
  }
  return byDay;
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
      const periods = await getSleepPeriods(client, range);
      const main = mainSleepPerDay(periods);
      const source = new Map<string, number | null>();
      for (const [day, p] of main) {
        let v: number | null;
        switch (metric) {
          case "hrv":
            v = p.average_hrv;
            break;
          case "rhr":
            v = p.lowest_heart_rate;
            break;
          case "sleep_total":
            v = p.total_sleep_duration;
            break;
          case "deep_sleep":
            v = p.deep_sleep_duration;
            break;
          case "rem_sleep":
            v = p.rem_sleep_duration;
            break;
          case "respiratory_rate":
            v = p.average_breath;
            break;
        }
        source.set(day, v);
      }
      return buildSeries(start, end, source);
    }
  }
}
