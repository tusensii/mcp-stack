import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import {
  getDailyReadiness,
  getDailySleep,
  getDailyActivity,
  getSleepPeriods,
} from "../oura/endpoints.js";
import { textContent, errorContent } from "./utils.js";
import { defined, mean, stddev, zScore } from "../oura/stats.js";
import type { SleepPeriod } from "../oura/types.js";

type MetricKey =
  | "readiness"
  | "sleep_score"
  | "hrv"
  | "rhr"
  | "deep_sleep"
  | "rem_sleep"
  | "respiratory_rate"
  | "activity_score";

const ALL_METRICS: MetricKey[] = [
  "readiness",
  "sleep_score",
  "hrv",
  "rhr",
  "deep_sleep",
  "rem_sleep",
  "respiratory_rate",
  "activity_score",
];

const MIN_BASELINE_SAMPLES = 7;

export interface Anomaly {
  date: string;
  metric: string;
  value: number;
  baseline_mean: number;
  baseline_stddev: number;
  z_score: number;
  direction: "above" | "below";
}

/** Pick the canonical sleep period for a day: prefer "long_sleep" then longest total_sleep_duration. */
function pickMainSleep(periods: SleepPeriod[]): SleepPeriod | undefined {
  if (periods.length === 0) return undefined;
  const usable = periods.filter((p) => p.type !== "deleted");
  if (usable.length === 0) return undefined;
  const longSleep = usable.find((p) => p.type === "long_sleep");
  if (longSleep) return longSleep;
  return [...usable].sort(
    (a, b) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0),
  )[0];
}

/** Add N days to a YYYY-MM-DD string and return YYYY-MM-DD. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Generate inclusive date list YYYY-MM-DD strings between start and end. */
function dateList(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  while (cur <= end) {
    out.push(cur);
    cur = shiftDate(cur, 1);
  }
  return out;
}

/**
 * Pure helper: assemble a per-day metric series from already-fetched Oura data.
 * Used both by `fetchMetricSeries` (which fetches fresh) and by callers like
 * `weekly_digest` that already have the underlying arrays in hand.
 */
export function buildMetricSeries(
  readiness: ReadonlyArray<{ day: string; score: number | null }>,
  dailySleep: ReadonlyArray<{ day: string; score: number | null }>,
  activity: ReadonlyArray<{ day: string; score: number | null }>,
  sleepPeriods: ReadonlyArray<SleepPeriod>,
): Record<MetricKey, Record<string, number | null>> {
  const result: Record<MetricKey, Record<string, number | null>> = {
    readiness: {},
    sleep_score: {},
    hrv: {},
    rhr: {},
    deep_sleep: {},
    rem_sleep: {},
    respiratory_rate: {},
    activity_score: {},
  };

  for (const r of readiness) result.readiness[r.day] = r.score;
  for (const s of dailySleep) result.sleep_score[s.day] = s.score;
  for (const a of activity) result.activity_score[a.day] = a.score;

  const byDay = new Map<string, SleepPeriod[]>();
  for (const p of sleepPeriods) {
    const arr = byDay.get(p.day) ?? [];
    arr.push(p);
    byDay.set(p.day, arr);
  }
  for (const [day, periods] of byDay) {
    const main = pickMainSleep(periods);
    if (!main) continue;
    result.hrv[day] = main.average_hrv;
    result.rhr[day] = main.lowest_heart_rate;
    result.deep_sleep[day] = main.deep_sleep_duration;
    result.rem_sleep[day] = main.rem_sleep_duration;
    result.respiratory_rate[day] = main.average_breath;
  }

  return result;
}

/**
 * Build a per-day metric value map for the requested metrics over the full
 * fetch window. Skips API calls for metric families not requested.
 */
export async function fetchMetricSeries(
  client: OuraClient,
  metrics: MetricKey[],
  fetchStart: string,
  fetchEnd: string,
): Promise<Record<MetricKey, Record<string, number | null>>> {
  const params = { start_date: fetchStart, end_date: fetchEnd };
  const need = new Set(metrics);

  const needsReadiness = need.has("readiness");
  const needsSleepScore = need.has("sleep_score");
  const needsActivity = need.has("activity_score");
  const needsSleepPeriod =
    need.has("hrv") ||
    need.has("rhr") ||
    need.has("deep_sleep") ||
    need.has("rem_sleep") ||
    need.has("respiratory_rate");

  const [readiness, dailySleep, activity, sleepPeriods] = await Promise.all([
    needsReadiness ? getDailyReadiness(client, params, 20) : Promise.resolve([]),
    needsSleepScore ? getDailySleep(client, params, 20) : Promise.resolve([]),
    needsActivity ? getDailyActivity(client, params, 20) : Promise.resolve([]),
    needsSleepPeriod ? getSleepPeriods(client, params, 20) : Promise.resolve([]),
  ]);

  return buildMetricSeries(readiness, dailySleep, activity, sleepPeriods);
}

/**
 * Pure anomaly detection: scan each (date, metric) pair against a rolling
 * baseline. Returns sorted anomaly list. Exported for re-use by weekly_digest.
 */
export function detectAnomalies(
  series: Record<MetricKey, Record<string, number | null>>,
  metrics: MetricKey[],
  scanDates: string[],
  baselineWindowDays: number,
  zThreshold: number,
): Anomaly[] {
  const out: Anomaly[] = [];

  for (const date of scanDates) {
    for (const metric of metrics) {
      const vMap = series[metric];
      const value = vMap[date];
      if (value === null || value === undefined || !Number.isFinite(value)) continue;

      const baselineStart = shiftDate(date, -baselineWindowDays);
      const baselineEnd = shiftDate(date, -1);
      const baselineDates = dateList(baselineStart, baselineEnd);
      const rawBaseline = baselineDates.map((d) => vMap[d] ?? null);
      const baseline = defined(rawBaseline);
      if (baseline.length < MIN_BASELINE_SAMPLES) continue;

      const mu = mean(baseline);
      const sigma = stddev(baseline, mu);
      if (sigma === 0) continue;

      const z = zScore(value, mu, sigma);
      if (Math.abs(z) > zThreshold) {
        out.push({
          date,
          metric,
          value,
          baseline_mean: Math.round(mu * 100) / 100,
          baseline_stddev: Math.round(sigma * 100) / 100,
          z_score: Math.round(z * 100) / 100,
          direction: z > 0 ? "above" : "below",
        });
      }
    }
  }

  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return Math.abs(b.z_score) - Math.abs(a.z_score);
  });

  return out;
}

export function registerAnomalyDetectTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_anomaly_detect",
    "Flags days where a metric deviates from its rolling baseline by more than " +
      "z_threshold standard deviations. Scans each day in date_range against the " +
      "preceding baseline_window_days for each metric. Skips metrics with fewer than " +
      "7 valid baseline samples. Use this to surface unusual readings worth investigating.",
    {
      date_range: z.object({ start: z.string(), end: z.string() }),
      baseline_window_days: z
        .number()
        .int()
        .min(7)
        .max(180)
        .optional()
        .describe("Default 30. Rolling baseline window before each scanned day."),
      z_threshold: z.number().positive().optional().describe("Default 2.0."),
      metrics: z
        .array(
          z.enum([
            "readiness",
            "sleep_score",
            "hrv",
            "rhr",
            "deep_sleep",
            "rem_sleep",
            "respiratory_rate",
            "activity_score",
          ]),
        )
        .optional()
        .describe("Default: all major metrics."),
    },
    async ({ date_range, baseline_window_days, z_threshold, metrics }) => {
      const baselineWindow = baseline_window_days ?? 30;
      const threshold = z_threshold ?? 2.0;
      const selectedMetrics = (metrics ?? ALL_METRICS) as MetricKey[];

      const fetchStart = shiftDate(date_range.start, -baselineWindow);
      const fetchEnd = date_range.end;

      try {
        const series = await fetchMetricSeries(
          client,
          selectedMetrics,
          fetchStart,
          fetchEnd,
        );
        const scanDates = dateList(date_range.start, date_range.end);
        const anomalies = detectAnomalies(
          series,
          selectedMetrics,
          scanDates,
          baselineWindow,
          threshold,
        );

        const summary = `${anomalies.length} anomal${
          anomalies.length === 1 ? "y" : "ies"
        } detected across ${scanDates.length} day${scanDates.length === 1 ? "" : "s"}`;

        return textContent({
          date_range,
          baseline_window_days: baselineWindow,
          z_threshold: threshold,
          anomalies,
          summary,
        });
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
