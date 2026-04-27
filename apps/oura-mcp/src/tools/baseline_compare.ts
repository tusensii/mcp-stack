import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import {
  METRIC_NAMES,
  addDays,
  fetchMetricByDay,
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

export function registerBaselineCompareTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_baseline_compare",
    "Compares a single day's metric value against the user's personal rolling baseline. " +
      "Returns z-score, percentile, delta vs baseline mean, and a categorical interpretation. " +
      "Baseline window excludes the comparison date itself.",
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
    },
    async ({ metric, date, baseline_window_days }) => {
      const compareDate = date ?? todayInTz();
      const windowDays = baseline_window_days ?? 30;
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

        const currentValue = todaySeries.get(compareDate) ?? null;
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
        if (note) result.note = note;
        return textContent(result);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
