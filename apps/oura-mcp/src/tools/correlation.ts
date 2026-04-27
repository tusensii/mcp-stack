import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import {
  METRIC_NAMES,
  addDays,
  eachDay,
  fetchMetricByDay,
  type Metric,
} from "../oura/metrics.js";
import { getEnhancedTags } from "../oura/endpoints.js";
import { pearson, interpretPearson } from "../oura/stats.js";
import { textContent, errorContent } from "./utils.js";

const VALID_METRICS = new Set<string>(METRIC_NAMES);

/**
 * Fetch a tag-as-binary daily series. Matches by `tag_type_code` first,
 * then falls back to `custom_name`. Spans (start_day..end_day inclusive)
 * are fanned out so multi-day tags fire 1 on every covered day.
 */
async function fetchTagSeries(
  client: OuraClient,
  tagName: string,
  start: string,
  end: string,
): Promise<Map<string, number | null>> {
  const tags = await getEnhancedTags(client, { start_date: start, end_date: end });
  const matchingDays = new Set<string>();
  for (const t of tags) {
    if (t.tag_type_code !== tagName && t.custom_name !== tagName) continue;
    const s = t.start_day;
    const e = t.end_day ?? t.start_day;
    for (const d of eachDay(s, e)) matchingDays.add(d);
  }
  const out = new Map<string, number | null>();
  for (const day of eachDay(start, end)) {
    out.set(day, matchingDays.has(day) ? 1 : 0);
  }
  return out;
}

function isTagRef(name: string): boolean {
  return name.startsWith("tag:");
}

async function fetchSeries(
  client: OuraClient,
  name: string,
  start: string,
  end: string,
): Promise<Map<string, number | null>> {
  if (isTagRef(name)) {
    return fetchTagSeries(client, name.slice(4), start, end);
  }
  if (!VALID_METRICS.has(name)) {
    throw new Error(
      `Unknown metric "${name}". Use one of: ${[...VALID_METRICS].join(", ")} or "tag:<name>".`,
    );
  }
  return fetchMetricByDay(client, name as Metric, start, end);
}

export function registerCorrelationTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_correlation",
    "Pearson correlation between two daily series over a date range. " +
      "Each input may be a metric name (readiness, sleep_score, hrv, rhr, sleep_total, " +
      "deep_sleep, rem_sleep, respiratory_rate, spo2, activity_score) or a tag (prefix " +
      "with `tag:`, matched against tag_type_code or custom_name). " +
      "Optional `lag_days` shifts B forward relative to A: tests whether A on day d " +
      "predicts B on day d+lag.",
    {
      metric_a: z
        .string()
        .describe("Metric or tag name. For tags, prefix with 'tag:' (e.g. 'tag:alcohol')."),
      metric_b: z.string().describe("Metric or tag name (same format as metric_a)."),
      date_range: z.object({
        start: z.string().describe("YYYY-MM-DD inclusive."),
        end: z.string().describe("YYYY-MM-DD inclusive."),
      }),
      lag_days: z
        .number()
        .int()
        .min(0)
        .max(7)
        .optional()
        .describe("Shift B by this many days relative to A. Default 0."),
    },
    async ({ metric_a, metric_b, date_range, lag_days }) => {
      const lag = lag_days ?? 0;
      try {
        // Extend B's fetch by `lag` days so we can pair A[d] with B[d+lag].
        const aEnd = date_range.end;
        const bEnd = lag > 0 ? addDays(date_range.end, lag) : date_range.end;
        const aSeries = await fetchSeries(client, metric_a, date_range.start, aEnd);
        const bSeries = await fetchSeries(client, metric_b, date_range.start, bEnd);

        const xs: number[] = [];
        const ys: number[] = [];
        for (const day of eachDay(date_range.start, aEnd)) {
          const a = aSeries.get(day);
          const bDay = lag > 0 ? addDays(day, lag) : day;
          const b = bSeries.get(bDay);
          if (
            a !== null &&
            a !== undefined &&
            Number.isFinite(a) &&
            b !== null &&
            b !== undefined &&
            Number.isFinite(b)
          ) {
            xs.push(a);
            ys.push(b);
          }
        }

        const n = xs.length;
        const r = n >= 2 ? pearson(xs, ys) : 0;
        const interpretation = n >= 2 ? interpretPearson(r) : "none";
        let caveat = `correlation is not causation; n=${n} may be small`;
        if (n < 30) caveat += "; n is small";
        if (n < 2) caveat += "; insufficient paired data for correlation";

        return textContent({
          metric_a,
          metric_b,
          date_range,
          lag_days: lag,
          n_days: n,
          pearson_r: r,
          interpretation,
          caveat,
        });
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
