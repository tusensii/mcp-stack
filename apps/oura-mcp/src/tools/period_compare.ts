import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import {
  METRIC_NAMES,
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

export function registerPeriodCompareTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_period_compare",
    "Side-by-side comparison of two arbitrary date ranges across one or more metrics. " +
      "Returns mean/median/stddev for each period plus delta_mean (b-a), delta_pct, " +
      "and a rough `meaningfully_different` flag (|delta| > 1 stddev of period A — " +
      "intentionally crude, treat as a heuristic rather than statistical inference).",
    {
      metrics: z
        .array(z.enum(METRIC_NAMES))
        .min(1)
        .max(8)
        .describe("Metrics to compare (1-8)."),
      period_a: z
        .object({
          start: z.string().describe("YYYY-MM-DD start of period A."),
          end: z.string().describe("YYYY-MM-DD end of period A (inclusive)."),
          label: z.string().optional(),
        })
        .describe("First period."),
      period_b: z
        .object({
          start: z.string().describe("YYYY-MM-DD start of period B."),
          end: z.string().describe("YYYY-MM-DD end of period B (inclusive)."),
          label: z.string().optional(),
        })
        .describe("Second period."),
    },
    async ({ metrics, period_a, period_b }) => {
      try {
        const out: Record<string, unknown> = {};
        for (const metric of metrics as Metric[]) {
          const aSeries = await fetchMetricByDay(client, metric, period_a.start, period_a.end);
          const bSeries = await fetchMetricByDay(client, metric, period_b.start, period_b.end);
          const aStats = summarize([...aSeries.values()]);
          const bStats = summarize([...bSeries.values()]);

          let deltaMean: number | null = null;
          let deltaPct: number | null = null;
          let meaningfullyDifferent = false;
          if (aStats.mean !== null && bStats.mean !== null) {
            deltaMean = bStats.mean - aStats.mean;
            deltaPct = aStats.mean !== 0 ? (deltaMean / aStats.mean) * 100 : null;
            if (aStats.stddev !== null && aStats.stddev > 0) {
              meaningfullyDifferent = Math.abs(deltaMean) > aStats.stddev;
            }
          }

          out[metric] = {
            a_mean: aStats.mean,
            a_median: aStats.median,
            a_stddev: aStats.stddev,
            a_n: aStats.n,
            b_mean: bStats.mean,
            b_median: bStats.median,
            b_stddev: bStats.stddev,
            b_n: bStats.n,
            delta_mean: deltaMean,
            delta_pct: deltaPct,
            meaningfully_different: meaningfullyDifferent,
          };
        }

        return textContent({
          period_a: {
            start: period_a.start,
            end: period_a.end,
            label: period_a.label ?? null,
          },
          period_b: {
            start: period_b.start,
            end: period_b.end,
            label: period_b.label ?? null,
          },
          metrics: out,
        });
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
