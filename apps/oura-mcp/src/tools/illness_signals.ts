import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailyReadiness } from "../oura/endpoints.js";
import { addDays, fetchMetricByDay } from "../oura/metrics.js";
import { defined, mean, stddev, zScore, percentileFromZ } from "../oura/stats.js";
import { textContent, errorContent, todayInTz } from "./utils.js";

const BASELINE_WINDOW_DAYS = 30;
const FEBRILE_THRESHOLD_C = 0.8;
const ELEVATED_THRESHOLD_C = 0.3;

type TemperatureStatus = "normal" | "elevated" | "febrile" | "unknown";
type ExertionCeiling = "rest" | "zone_2_only" | "moderate" | "unrestricted";

function classifyTemperature(devC: number | null): TemperatureStatus {
  if (devC === null || !Number.isFinite(devC)) return "unknown";
  if (devC > FEBRILE_THRESHOLD_C) return "febrile";
  if (Math.abs(devC) > ELEVATED_THRESHOLD_C && devC > 0) return "elevated";
  return "normal";
}

/** Compute delta_pct vs baseline mean. Null when either operand missing or mean is 0. */
function deltaPct(current: number | null, baselineMean: number | null): number | null {
  if (current === null || baselineMean === null) return null;
  if (baselineMean === 0) return null;
  return ((current - baselineMean) / baselineMean) * 100;
}

interface MetricSnapshot {
  raw: number | null;
  baseline_mean: number | null;
  delta_pct: number | null;
}

/**
 * Fetch raw value (on target_date) and rolling baseline (BASELINE_WINDOW_DAYS
 * days ending the day before target_date) for a single metric.
 */
async function snapshotMetric(
  client: OuraClient,
  metric: "hrv" | "rhr" | "respiratory_rate",
  date: string,
): Promise<MetricSnapshot> {
  const baselineStart = addDays(date, -BASELINE_WINDOW_DAYS);
  const baselineEnd = addDays(date, -1);
  const [baseSeries, daySeries] = await Promise.all([
    fetchMetricByDay(client, metric, baselineStart, baselineEnd),
    fetchMetricByDay(client, metric, date, date),
  ]);
  const raw = daySeries.get(date) ?? null;
  const baselineValues = defined([...baseSeries.values()]);
  const baselineMean = baselineValues.length > 0 ? mean(baselineValues) : null;
  return {
    raw,
    baseline_mean: baselineMean,
    delta_pct: deltaPct(raw, baselineMean),
  };
}

function decideExertionCeiling(args: {
  tempStatus: TemperatureStatus;
  respDeltaPct: number | null;
  hrvDeltaPct: number | null;
  rhrDeltaPct: number | null;
  readiness: number | null;
}): { ceiling: ExertionCeiling; signals: string[] } {
  const signals: string[] = [];
  const { tempStatus, respDeltaPct, hrvDeltaPct, rhrDeltaPct, readiness } = args;

  // Tier 1: rest
  if (tempStatus === "febrile") signals.push("febrile_temperature");
  if (respDeltaPct !== null && respDeltaPct > 20) signals.push("respiratory_rate_+20%");

  // Tier 2: zone_2_only
  if (tempStatus === "elevated") signals.push("elevated_temperature");
  if (respDeltaPct !== null && respDeltaPct > 10 && respDeltaPct <= 20) {
    signals.push("respiratory_rate_+10%");
  }
  if (readiness !== null && readiness < 50) signals.push("readiness_below_50");

  // Tier 3: moderate
  if (hrvDeltaPct !== null && hrvDeltaPct < -25) signals.push("hrv_depressed_-25%");
  if (rhrDeltaPct !== null && rhrDeltaPct > 10) signals.push("rhr_elevated_+10%");

  let ceiling: ExertionCeiling;
  if (
    tempStatus === "febrile" ||
    (respDeltaPct !== null && respDeltaPct > 20)
  ) {
    ceiling = "rest";
  } else if (
    tempStatus === "elevated" ||
    (respDeltaPct !== null && respDeltaPct > 10) ||
    (readiness !== null && readiness < 50)
  ) {
    ceiling = "zone_2_only";
  } else if (
    (hrvDeltaPct !== null && hrvDeltaPct < -25) ||
    (rhrDeltaPct !== null && rhrDeltaPct > 10)
  ) {
    ceiling = "moderate";
  } else {
    ceiling = "unrestricted";
  }

  return { ceiling, signals };
}

export function registerIllnessSignalsTool(
  server: McpServer,
  client: OuraClient,
): void {
  server.tool(
    "oura_illness_signals",
    "Composite illness/exertion-readiness assessment for a single date. " +
      "Synthesizes body-temperature deviation, respiratory rate, HRV, RHR, and " +
      "readiness score (all vs 30-day personal baseline) into a single " +
      "exertion-ceiling recommendation. " +
      "Temperature classification: |dev| <= 0.3C = normal, dev > 0.3C = elevated, " +
      "dev > 0.8C = febrile. " +
      "Exertion ceiling decision: " +
      "rest = febrile temp OR respiratory_rate +20% vs baseline; " +
      "zone_2_only = elevated temp OR respiratory_rate +10% OR readiness < 50; " +
      "moderate = HRV depressed >25% below baseline OR RHR elevated >10% above baseline; " +
      "otherwise unrestricted. " +
      "`signals_triggered` lists which signals contributed so the caller can audit.",
    {
      date: z
        .string()
        .optional()
        .describe("YYYY-MM-DD. Default: today (America/Los_Angeles)."),
      fallback: z
        .enum(["strict", "latest"])
        .optional()
        .describe(
          "When the requested date has no readiness data: 'strict' returns an error; " +
            "'latest' (default) falls back to the most recent date in the 30-day baseline " +
            "window that does have readiness data.",
        ),
    },
    async ({ date, fallback }) => {
      const requestedDate = date ?? todayInTz();
      const fallbackMode = fallback ?? "latest";

      try {
        // Step 1: fetch readiness across the baseline window + target date.
        const readinessStart = addDays(requestedDate, -BASELINE_WINDOW_DAYS);
        const readinessRows = await getDailyReadiness(client, {
          start_date: readinessStart,
          end_date: requestedDate,
        });

        const readinessByDay = new Map<string, (typeof readinessRows)[number]>();
        for (const r of readinessRows) readinessByDay.set(r.day, r);

        let effectiveDate = requestedDate;
        if (!readinessByDay.has(requestedDate)) {
          if (fallbackMode === "strict") {
            return errorContent(`No readiness data for ${requestedDate}`);
          }
          // latest fallback: walk backwards through baseline window
          const candidates = [...readinessByDay.keys()]
            .filter((d) => d <= requestedDate)
            .sort();
          const latest = candidates[candidates.length - 1];
          if (!latest) {
            return errorContent(
              `No readiness data available in the ${BASELINE_WINDOW_DAYS}-day window ending ${requestedDate}`,
            );
          }
          effectiveDate = latest;
        }

        const todayReadiness = readinessByDay.get(effectiveDate);
        const tempDev = todayReadiness?.temperature_deviation ?? null;
        const readinessScore = todayReadiness?.score ?? null;

        // 30-day readiness percentile (excluding the effective date itself).
        const readinessBaselineValues = defined(
          [...readinessByDay.entries()]
            .filter(([d]) => d !== effectiveDate)
            .map(([, r]) => r.score),
        );
        let readinessPercentile30d: number | null = null;
        if (
          readinessScore !== null &&
          readinessBaselineValues.length >= 2
        ) {
          const mu = mean(readinessBaselineValues);
          const sigma = stddev(readinessBaselineValues, mu);
          if (sigma > 0) {
            readinessPercentile30d = percentileFromZ(
              zScore(readinessScore, mu, sigma),
            );
          }
        }

        // Step 2: fetch raw + baseline for resp/hrv/rhr (anchored on effectiveDate).
        const [resp, hrv, rhr] = await Promise.all([
          snapshotMetric(client, "respiratory_rate", effectiveDate),
          snapshotMetric(client, "hrv", effectiveDate),
          snapshotMetric(client, "rhr", effectiveDate),
        ]);

        const tempStatus = classifyTemperature(tempDev);
        const { ceiling, signals } = decideExertionCeiling({
          tempStatus,
          respDeltaPct: resp.delta_pct,
          hrvDeltaPct: hrv.delta_pct,
          rhrDeltaPct: rhr.delta_pct,
          readiness: readinessScore,
        });

        const result: Record<string, unknown> = {
          date: effectiveDate,
          requested_date: requestedDate,
          body_temperature_deviation_c: tempDev,
          temperature_status: tempStatus,
          respiratory_rate: {
            raw: resp.raw,
            baseline_mean: resp.baseline_mean,
            delta_pct: resp.delta_pct,
          },
          hrv_ms: {
            raw: hrv.raw,
            baseline_mean: hrv.baseline_mean,
            delta_pct: hrv.delta_pct,
          },
          rhr_bpm: {
            raw: rhr.raw,
            baseline_mean: rhr.baseline_mean,
            delta_pct: rhr.delta_pct,
          },
          readiness_score: readinessScore,
          readiness_percentile_30d: readinessPercentile30d,
          exertion_ceiling: ceiling,
          signals_triggered: signals,
        };
        if (effectiveDate !== requestedDate) {
          result.fallback_applied = `Used ${effectiveDate} (no data for ${requestedDate})`;
        }
        return textContent(result);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
