import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import {
  METRIC_NAMES,
  addDays,
  fetchMetricByDay,
  type Metric,
} from "../oura/metrics.js";
import { defined, mean, median, stddev } from "../oura/stats.js";
import { textContent, errorContent } from "./utils.js";

interface PeriodStats {
  mean: number | null;
  median: number | null;
  stddev: number | null;
  n: number;
}

function summarize(values: ReadonlyArray<number | null>): PeriodStats {
  const xs = defined(values);
  if (xs.length === 0) {
    return { mean: null, median: null, stddev: null, n: 0 };
  }
  const m = mean(xs);
  return {
    mean: m,
    median: median(xs),
    stddev: xs.length >= 2 ? stddev(xs, m) : null,
    n: xs.length,
  };
}

export function registerInterventionAnalysisTool(
  server: McpServer,
  client: OuraClient,
): void {
  server.tool(
    "oura_intervention_analysis",
    "Compares metric values in a window before vs after an intervention date " +
      "(e.g. dietary change, new medication, schedule shift). An exclusion window " +
      "around the intervention date is dropped to avoid washout effects. " +
      "`meaningfully_different` flag is rough: |delta| > 1 stddev of the BEFORE period.",
    {
      intervention_date: z
        .string()
        .describe("YYYY-MM-DD. The day the intervention took effect."),
      intervention_label: z
        .string()
        .describe("Free-text label describing the intervention (echoed in output)."),
      metrics: z
        .array(z.enum(METRIC_NAMES))
        .min(1)
        .max(8)
        .describe("Metrics to evaluate (1-8)."),
      window_days: z
        .number()
        .int()
        .min(7)
        .max(180)
        .optional()
        .describe("Days included before and after each side of the exclusion. Default 30."),
      exclusion_days: z
        .number()
        .int()
        .min(0)
        .max(30)
        .optional()
        .describe("Days adjacent to intervention_date to drop on each side. Default 7."),
    },
    async ({ intervention_date, intervention_label, metrics, window_days, exclusion_days }) => {
      const win = window_days ?? 30;
      const excl = exclusion_days ?? 7;

      const beforeStart = addDays(intervention_date, -excl - win);
      const beforeEnd = addDays(intervention_date, -excl - 1);
      const afterStart = addDays(intervention_date, excl);
      const afterEnd = addDays(intervention_date, excl + win - 1);

      try {
        const out: Record<string, unknown> = {};
        for (const metric of metrics as Metric[]) {
          const beforeSeries = await fetchMetricByDay(client, metric, beforeStart, beforeEnd);
          const afterSeries = await fetchMetricByDay(client, metric, afterStart, afterEnd);
          const beforeStats = summarize([...beforeSeries.values()]);
          const afterStats = summarize([...afterSeries.values()]);

          let deltaMean: number | null = null;
          let deltaPct: number | null = null;
          let meaningfullyDifferent = false;
          if (beforeStats.mean !== null && afterStats.mean !== null) {
            deltaMean = afterStats.mean - beforeStats.mean;
            deltaPct =
              beforeStats.mean !== 0 ? (deltaMean / beforeStats.mean) * 100 : null;
            if (beforeStats.stddev !== null && beforeStats.stddev > 0) {
              meaningfullyDifferent = Math.abs(deltaMean) > beforeStats.stddev;
            }
          }

          out[metric] = {
            before_mean: beforeStats.mean,
            before_median: beforeStats.median,
            before_stddev: beforeStats.stddev,
            before_n: beforeStats.n,
            after_mean: afterStats.mean,
            after_median: afterStats.median,
            after_stddev: afterStats.stddev,
            after_n: afterStats.n,
            delta_mean: deltaMean,
            delta_pct: deltaPct,
            meaningfully_different: meaningfullyDifferent,
          };
        }

        return textContent({
          intervention_date,
          intervention_label,
          exclusion_days: excl,
          window_days: win,
          before_period: { start: beforeStart, end: beforeEnd },
          after_period: { start: afterStart, end: afterEnd },
          metrics: out,
        });
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
