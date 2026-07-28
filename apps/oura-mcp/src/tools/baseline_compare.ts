import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import {
  METRIC_NAMES,
  addDays,
  fetchMetricByDay,
  fetchMainSleepPeriodsByDay,
  isSleepDerivedMetric,
} from "../oura/metrics.js";
import {
  defined,
  mean,
  stddev,
  zScore,
  interpretZ,
  percentileFromZ,
} from "../oura/stats.js";
import { textContent, errorContent, todayInTz } from "./utils.js";

// #46: threshold (hours) beyond which a resolved night is flagged
// `possibly_stale` — i.e. it ended long enough ago that a more recent
// (possibly still-unsynced) night may exist and not be reflected here.
// 12h was chosen because Oura sync typically completes well within a
// morning; this is a static-analysis-derived heuristic (see comment at
// call site) and has not been validated against live sync-lag data.
export const STALE_THRESHOLD_HOURS = 12;

/**
 * Returns true when `bedtimeEndIso` (the end of the resolved sleep period)
 * is more than STALE_THRESHOLD_HOURS before `now`. Pure/testable extraction
 * of the #46 boundary check.
 */
export function isPossiblyStaleNight(bedtimeEndIso: string, now: Date): boolean {
  const endMs = Date.parse(bedtimeEndIso);
  if (isNaN(endMs)) return false;
  const hoursSinceEnd = (now.getTime() - endMs) / 3_600_000;
  return hoursSinceEnd > STALE_THRESHOLD_HOURS;
}

export function registerBaselineCompareTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_baseline_compare",
    "Compares a single day's metric value against the user's personal rolling baseline. " +
      "Returns z-score, percentile, delta vs baseline mean, and a categorical interpretation. " +
      "Baseline window excludes the comparison date itself. " +
      "When `fallback: \"latest\"`, if the requested date has no data, the tool scans " +
      "backward up to 7 days for the most recent reading and returns it (with " +
      "`actual_date_used` and `days_lag` in the response). The baseline window itself " +
      "remains anchored to the requested date. Default `fallback: \"strict\"` preserves " +
      "the no-data error behavior. " +
      "Dates: \"date\" indexes the underlying metric — for sleep-derived metrics (hrv, rhr, deep_sleep, rem_sleep, sleep_total, respiratory_rate) this is the date the sleep period started; for daily-report metrics (readiness, sleep_score, activity_score, spo2) this is the morning the score is reported on. The two conventions can refer to the same physiological night but different calendar dates. " +
      "For sleep-derived metrics, the response includes `bedtime_start`/`bedtime_end` of the sleep period the value actually came from, so you can confirm which night was matched. " +
      "If that night ended more than 12 hours before the call was made, `possibly_stale: true` is set — this usually means the most recent night hasn't synced from the ring yet and an OLDER, already-synced night was matched instead (common for morning \"how did I sleep last night\" queries near the sync boundary). " +
      "When `possibly_stale` is true, treat the result as \"most recent synced night\", not necessarily \"last night\", and consider retrying later or checking `oura_sleep_detail` directly.",
    {
      metric: z.enum(METRIC_NAMES).describe("Metric to compare against personal baseline."),
      date: z
        .string()
        .optional()
        .describe("YYYY-MM-DD. Default: today (America/Los_Angeles)."),
      baseline_window_days: z
        .number()
        .int()
        .min(7)
        .max(365)
        .optional()
        .describe("How many prior days form the baseline. Default 30."),
      fallback: z
        .enum(["strict", "latest"])
        .optional()
        .describe(
          "How to handle missing data on the requested date. " +
            "\"strict\" (default) returns current_value: null with an error. " +
            "\"latest\" scans backward up to 7 days for the most recent reading.",
        ),
    },
    async ({ metric, date, baseline_window_days, fallback }) => {
      const compareDate = date ?? todayInTz();
      const windowDays = baseline_window_days ?? 30;
      const fallbackMode = fallback ?? "strict";
      const baselineStart = addDays(compareDate, -windowDays);
      const baselineEnd = addDays(compareDate, -1);

      try {
        // Fetch baseline window + comparison day in two calls so we can
        // distinguish "no data on the day" from "no data in window".
        const baselineSeries = await fetchMetricByDay(
          client,
          metric,
          baselineStart,
          baselineEnd,
        );
        const todaySeries = await fetchMetricByDay(
          client,
          metric,
          compareDate,
          compareDate,
        );

        let currentValue = todaySeries.get(compareDate) ?? null;
        let actualDateUsed: string | null = null;
        let daysLag: number | null = null;

        // If the requested date is missing data and the caller opted in to
        // "latest" fallback, scan backward up to 7 days for the most recent
        // non-null reading. One window fetch covers the whole scan.
        if (currentValue === null && fallbackMode === "latest") {
          const FALLBACK_DAYS = 7;
          const fallbackStart = addDays(compareDate, -FALLBACK_DAYS);
          const fallbackEnd = addDays(compareDate, -1);
          const fallbackSeries = await fetchMetricByDay(
            client,
            metric,
            fallbackStart,
            fallbackEnd,
          );
          for (let i = 1; i <= FALLBACK_DAYS; i++) {
            const probeDate = addDays(compareDate, -i);
            const v = fallbackSeries.get(probeDate);
            if (v !== null && v !== undefined) {
              currentValue = v;
              actualDateUsed = probeDate;
              daysLag = i;
              break;
            }
          }
        }

        // #46: for sleep-derived metrics, resolve and expose which physical
        // night (bedtime_start/bedtime_end) the matched value actually came
        // from, and flag when that night ended long enough ago that a more
        // recent (possibly still-unsynced) night could exist. This is a
        // best-effort fix based on static analysis of the reported symptom
        // (day-keyed lookup silently matching an older, already-synced
        // night near the sync boundary) — it has NOT been verified against
        // live Oura data / an actual sync-lag window, and the 12h threshold
        // in isPossiblyStaleNight is a heuristic. Verify manually before
        // relying on `possibly_stale` in production.
        let nightBedtimeStart: string | null = null;
        let nightBedtimeEnd: string | null = null;
        let possiblyStale = false;
        if (currentValue !== null && isSleepDerivedMetric(metric)) {
          const dateUsed = actualDateUsed ?? compareDate;
          const periodsByDay = await fetchMainSleepPeriodsByDay(
            client,
            metric,
            dateUsed,
            dateUsed,
          );
          const period = periodsByDay.get(dateUsed);
          if (period) {
            nightBedtimeStart = period.bedtime_start;
            nightBedtimeEnd = period.bedtime_end;
            possiblyStale = isPossiblyStaleNight(period.bedtime_end, new Date());
          }
        }

        const baselineValues = defined([...baselineSeries.values()]);
        const nDays = baselineValues.length;

        const baselineMean = nDays > 0 ? mean(baselineValues) : null;
        const baselineStddev = nDays >= 2 ? stddev(baselineValues, baselineMean ?? undefined) : null;

        const note =
          nDays < windowDays
            ? `Baseline based on ${nDays} days; ${windowDays} requested`
            : undefined;

        if (currentValue === null) {
          const result: Record<string, unknown> = {
            metric,
            date: compareDate,
            current_value: null,
            baseline_mean: baselineMean,
            baseline_stddev: baselineStddev,
            delta_absolute: null,
            delta_pct: null,
            z_score: null,
            percentile: null,
            interpretation: null,
            baseline_window: { start: baselineStart, end: baselineEnd, n_days: nDays },
            error: "No data for date",
          };
          if (note) result.note = note;
          return textContent(result);
        }

        let z: number | null = null;
        let percentile: number | null = null;
        let interpretation: string | null = null;
        let deltaAbs: number | null = null;
        let deltaPct: number | null = null;

        if (baselineMean !== null) {
          deltaAbs = currentValue - baselineMean;
          deltaPct = baselineMean !== 0 ? (deltaAbs / baselineMean) * 100 : null;
        }
        if (baselineMean !== null && baselineStddev !== null && baselineStddev > 0) {
          z = zScore(currentValue, baselineMean, baselineStddev);
          percentile = percentileFromZ(z);
          interpretation = interpretZ(z);
        }

        const result: Record<string, unknown> = {
          metric,
          date: compareDate,
          current_value: currentValue,
          baseline_mean: baselineMean,
          baseline_stddev: baselineStddev,
          delta_absolute: deltaAbs,
          delta_pct: deltaPct,
          z_score: z,
          percentile,
          interpretation,
          baseline_window: { start: baselineStart, end: baselineEnd, n_days: nDays },
        };
        if (actualDateUsed !== null) {
          result.actual_date_used = actualDateUsed;
          result.days_lag = daysLag;
        }
        if (nightBedtimeStart !== null && nightBedtimeEnd !== null) {
          result.bedtime_start = nightBedtimeStart;
          result.bedtime_end = nightBedtimeEnd;
          result.possibly_stale = possiblyStale;
          if (possiblyStale) {
            result.stale_reason =
              "Resolved night ended more than 12h before this call — a more recent night may exist but not yet be synced from the ring. This may not be the night you meant by \"last night\".";
          }
        }
        if (note) result.note = note;
        return textContent(result);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
