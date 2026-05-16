import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailyReadiness } from "../oura/endpoints.js";
import { addDays, fetchMetricByDay } from "../oura/metrics.js";
import {
  defined,
  mean,
  stddev,
  zScore,
  percentileFromZ,
} from "../oura/stats.js";
import { textContent, errorContent, todayInTz } from "./utils.js";

type TempStatus = "normal" | "elevated" | "febrile";
type ExertionCeiling = "rest" | "zone_2_only" | "moderate" | "unrestricted";

interface MetricVsBaseline {
  value: number | null;
  baseline_mean: number | null;
  delta_pct: number | null;
}

/**
 * Resolve the most recent date <= target with a non-null value in `series`.
 * Returns null when nothing in series is present.
 */
function resolveLatest(
  series: Map<string, number | null>,
  target: string,
): { date: string; value: number } | null {
  const sortedDays = [...series.keys()].sort();
  for (let i = sortedDays.length - 1; i >= 0; i--) {
    const day = sortedDays[i] as string;
    if (day > target) continue;
    const v = series.get(day);
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      return { date: day, value: v };
    }
  }
  return null;
}

/**
 * Compute baseline mean over a window ending the day BEFORE refDate, looking
 * back `windowDays` days. Excludes refDate itself.
 */
async function rawWithBaseline(
  client: OuraClient,
  metric: "hrv" | "rhr" | "respiratory_rate",
  refDate: string,
  baselineWindowDays: number,
  fallback: "strict" | "latest",
): Promise<MetricVsBaseline> {
  const baselineStart = addDays(refDate, -baselineWindowDays);
  const baselineEnd = addDays(refDate, -1);

  const baselineSeries = await fetchMetricByDay(client, metric, baselineStart, baselineEnd);
  const todaySeries = await fetchMetricByDay(client, metric, refDate, refDate);

  let value: number | null = todaySeries.get(refDate) ?? null;
  if (value === null && fallback === "latest") {
    // Fall back to the most recent baseline day with data.
    const latest = resolveLatest(baselineSeries, refDate);
    if (latest) value = latest.value;
  }

  const baselineVals = defined([...baselineSeries.values()]);
  const baselineMean = baselineVals.length > 0 ? mean(baselineVals) : null;
  let deltaPct: number | null = null;
  if (value !== null && baselineMean !== null && baselineMean !== 0) {
    deltaPct = ((value - baselineMean) / baselineMean) * 100;
  }
  return { value, baseline_mean: baselineMean, delta_pct: deltaPct };
}

function classifyTemp(dev: number | null): TempStatus | null {
  if (dev === null) return null;
  const abs = Math.abs(dev);
  if (dev > 0.8) return "febrile";
  if (dev > 0.3) return "elevated";
  if (abs <= 0.3) return "normal";
  // dev <= -0.3 (cold deviation) — treat as normal status (no illness signal).
  return "normal";
}

function decideExertionCeiling(
  tempStatus: TempStatus | null,
  respDeltaPct: number | null,
  hrvDeltaPct: number | null,
  rhrDeltaPct: number | null,
  readinessScore: number | null,
): { ceiling: ExertionCeiling; signals: string[] } {
  const signals: string[] = [];

  if (tempStatus === "febrile") signals.push("temperature_febrile");
  if (respDeltaPct !== null && respDeltaPct > 20) signals.push("respiratory_rate_high_+20pct");
  const restTrigger = tempStatus === "febrile" || (respDeltaPct !== null && respDeltaPct > 20);

  if (tempStatus === "elevated") signals.push("temperature_elevated");
  if (respDeltaPct !== null && respDeltaPct > 10 && respDeltaPct <= 20) {
    signals.push("respiratory_rate_high_+10pct");
  }
  if (readinessScore !== null && readinessScore < 50) signals.push("readiness_low");
  const zone2Trigger =
    tempStatus === "elevated" ||
    (respDeltaPct !== null && respDeltaPct > 10) ||
    (readinessScore !== null && readinessScore < 50);

  if (hrvDeltaPct !== null && hrvDeltaPct < -25) signals.push("hrv_drop_-25pct");
  if (rhrDeltaPct !== null && rhrDeltaPct > 10) signals.push("rhr_high_+10pct");
  const moderateTrigger =
    (hrvDeltaPct !== null && hrvDeltaPct < -25) ||
    (rhrDeltaPct !== null && rhrDeltaPct > 10);

  let ceiling: ExertionCeiling;
  if (restTrigger) ceiling = "rest";
  else if (zone2Trigger) ceiling = "zone_2_only";
  else if (moderateTrigger) ceiling = "moderate";
  else ceiling = "unrestricted";

  return { ceiling, signals };
}

export function registerIllnessSignalsTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_illness_signals",
    "Composite illness/recovery signal report for a single day. Aggregates body " +
      "temperature deviation, respiratory rate, HRV, RHR, and readiness score (each " +
      "compared to a 30-day rolling baseline that excludes the target date itself) " +
      "and emits a recommended exertion ceiling. " +
      "Temperature thresholds: |dev| <= 0.3°C => normal; dev > 0.3°C => elevated; " +
      "dev > 0.8°C => febrile. " +
      "Exertion ceiling rules: " +
      "(1) febrile temperature OR respiratory rate >+20% vs baseline => rest; " +
      "(2) elevated temperature OR respiratory rate >+10% OR readiness_score < 50 => zone_2_only; " +
      "(3) HRV < -25% vs baseline OR RHR > +10% vs baseline => moderate; " +
      "(4) otherwise => unrestricted. " +
      "fallback='latest' (default) reuses the most recent prior day with data when the target date is missing; fallback='strict' returns nulls for missing data. " +
      "Dates: \"date\" is interpreted against each underlying metric's native convention — body temperature deviation and readiness score use the morning-of-report date; HRV, RHR, and respiratory rate are sourced from the sleep period whose `day` matches that date (sleep-period-start convention). Pick whichever date aligns with how you mentally label the night in question; off-by-one across conventions is possible.",
    {
      date: z
        .string()
        .optional()
        .describe("YYYY-MM-DD target date. Default: today (America/Los_Angeles)."),
      fallback: z
        .enum(["strict", "latest"])
        .optional()
        .describe(
          "How to handle a target date with no data. 'latest' (default) reuses the most recent baseline-window day with data; 'strict' reports nulls.",
        ),
      baseline_window_days: z
        .number()
        .int()
        .min(7)
        .max(180)
        .optional()
        .describe("Rolling baseline length, excluding the target date. Default 30."),
    },
    async ({ date, fallback, baseline_window_days }) => {
      const target = date ?? todayInTz();
      const fb: "strict" | "latest" = fallback ?? "latest";
      const windowDays = baseline_window_days ?? 30;

      try {
        // Pull daily readiness across baseline + target to get temperature_deviation,
        // readiness score, and 30d readiness percentile.
        const baselineStart = addDays(target, -windowDays);
        const baselineEnd = addDays(target, -1);
        const readinessAll = await getDailyReadiness(client, {
          start_date: baselineStart,
          end_date: target,
        });

        // Build per-day maps for readiness score + temperature_deviation.
        const scoreByDay = new Map<string, number | null>();
        const tempDevByDay = new Map<string, number | null>();
        for (const r of readinessAll) {
          scoreByDay.set(r.day, r.score);
          tempDevByDay.set(r.day, r.temperature_deviation);
        }

        // Resolve target-day values, with optional fallback.
        let targetReadiness = scoreByDay.get(target) ?? null;
        let resolvedDate = target;
        if (targetReadiness === null && fb === "latest") {
          const latest = resolveLatest(scoreByDay, target);
          if (latest) {
            targetReadiness = latest.value;
            resolvedDate = latest.date;
          }
        }
        let tempDev = tempDevByDay.get(resolvedDate) ?? null;
        if (tempDev === null && fb === "latest") {
          const latest = resolveLatest(tempDevByDay, target);
          if (latest) tempDev = latest.value;
        }

        // 30d readiness percentile: z-score of target's score against baseline scores.
        const baselineScores: number[] = [];
        for (const [day, val] of scoreByDay) {
          if (day >= target) continue;
          if (val !== null && Number.isFinite(val)) baselineScores.push(val);
        }
        let readinessPercentile30d: number | null = null;
        if (targetReadiness !== null && baselineScores.length >= 2) {
          const mu = mean(baselineScores);
          const sigma = stddev(baselineScores, mu);
          if (sigma > 0) {
            readinessPercentile30d = percentileFromZ(zScore(targetReadiness, mu, sigma));
          }
        }

        // Raw + baseline for HRV / RHR / respiratory rate.
        const [resp, hrv, rhr] = await Promise.all([
          rawWithBaseline(client, "respiratory_rate", target, windowDays, fb),
          rawWithBaseline(client, "hrv", target, windowDays, fb),
          rawWithBaseline(client, "rhr", target, windowDays, fb),
        ]);

        const tempStatus = classifyTemp(tempDev);
        const { ceiling, signals } = decideExertionCeiling(
          tempStatus,
          resp.delta_pct,
          hrv.delta_pct,
          rhr.delta_pct,
          targetReadiness,
        );

        const result: Record<string, unknown> = {
          date: target,
          resolved_date: resolvedDate !== target ? resolvedDate : undefined,
          fallback: fb,
          body_temperature_deviation_c: tempDev,
          temperature_status: tempStatus,
          respiratory_rate: {
            value: resp.value,
            baseline_mean: resp.baseline_mean,
            delta_pct: resp.delta_pct,
          },
          hrv_ms: {
            value: hrv.value,
            baseline_mean: hrv.baseline_mean,
            delta_pct: hrv.delta_pct,
          },
          rhr_bpm: {
            value: rhr.value,
            baseline_mean: rhr.baseline_mean,
            delta_pct: rhr.delta_pct,
          },
          readiness_score: targetReadiness,
          readiness_percentile_30d: readinessPercentile30d,
          exertion_ceiling: ceiling,
          signals_triggered: signals,
          baseline_window_days: windowDays,
        };
        // Strip undefined resolved_date for cleanliness when no fallback used.
        if (result["resolved_date"] === undefined) delete result["resolved_date"];

        return textContent(result);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
