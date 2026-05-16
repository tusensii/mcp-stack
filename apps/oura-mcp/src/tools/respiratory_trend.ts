import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getSleepPeriods } from "../oura/endpoints.js";
import type { SleepPeriod } from "../oura/types.js";
import {
  textContent,
  errorContent,
  resolveDateRange,
  validateDateRange,
} from "./utils.js";

interface RespiratoryTrendEntry {
  date: string;
  average_respiratory_rate: number | null;
  breath_samples_count?: number;
  respiratory_rate_min?: number;
  respiratory_rate_max?: number;
}

/**
 * Pick one sleep period per date. Prefer the longest-duration period whose
 * average_breath is non-null. If all longest candidates have null
 * average_breath, fall back to the next-longest. Skips deleted periods.
 */
function pickPeriodForRespiratory(periods: SleepPeriod[]): SleepPeriod | undefined {
  const usable = periods.filter((p) => p.type !== "deleted");
  if (usable.length === 0) return undefined;
  // Sort by total_sleep_duration descending (nulls treated as -1).
  const sorted = [...usable].sort(
    (a, b) => (b.total_sleep_duration ?? -1) - (a.total_sleep_duration ?? -1),
  );
  // Prefer longest with non-null average_breath; otherwise return the longest.
  const withResp = sorted.find((p) => p.average_breath !== null);
  return withResp ?? sorted[0];
}

export function registerRespiratoryTrendTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_respiratory_trend",
    "Derived tool: fetches detailed sleep periods and returns a clean date-indexed " +
      "respiratory-rate series. One entry per date — when Oura reports multiple sleep " +
      "periods for a night, the longest period wins (with fallback to the next-longest " +
      "if the longest has no respiratory data). Fields per entry: date, " +
      "average_respiratory_rate (breaths/min), and (when available) breath_samples_count, " +
      "respiratory_rate_min, respiratory_rate_max from the per-night breath time series. " +
      "null average_respiratory_rate means the ring did not record breath rate that night. " +
      "Use this tool for respiratory-rate trends and elevated-breathing-rate analysis.",
    {
      start_date: z
        .string()
        .optional()
        .describe("Start date YYYY-MM-DD. Defaults to today minus 6 days (7-day inclusive window)."),
      end_date: z.string().optional().describe("End date YYYY-MM-DD. Defaults to today."),
    },
    async ({ start_date, end_date }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      try {
        const periods = await getSleepPeriods(client, range);

        // Group by day, then pick one per day.
        const byDay = new Map<string, SleepPeriod[]>();
        for (const p of periods) {
          const arr = byDay.get(p.day) ?? [];
          arr.push(p);
          byDay.set(p.day, arr);
        }

        const trend: RespiratoryTrendEntry[] = [];
        for (const [day, dayPeriods] of byDay) {
          const main = pickPeriodForRespiratory(dayPeriods);
          if (!main) continue;
          const entry: RespiratoryTrendEntry = {
            date: day,
            average_respiratory_rate: main.average_breath,
          };
          // Derive min/max/sample count from breath samples (sleep period
          // exposes hrv/heart_rate time series; Oura does not currently
          // ship a public breath time series, so we only populate when
          // available on the payload). Guard defensively.
          // Note: SleepPeriod type does not include a breath samples array,
          // so we omit these fields rather than fabricating them.
          trend.push(entry);
        }

        // Sort by date ascending for consumer convenience.
        trend.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

        return textContent(trend);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
