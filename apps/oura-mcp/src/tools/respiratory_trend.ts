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
}

/**
 * For a given day, pick the sleep period with the highest priority for the
 * respiratory-rate value:
 *   1. Drop deleted entries.
 *   2. Sort by total_sleep_duration descending (longest first).
 *   3. Return the first whose average_breath is non-null. If every period has
 *      null average_breath, return the longest non-deleted period anyway so
 *      we still emit a row (with null value) for the date.
 */
function pickRespPeriod(periods: SleepPeriod[]): SleepPeriod | undefined {
  const usable = periods.filter((p) => p.type !== "deleted");
  if (usable.length === 0) return undefined;
  const sorted = [...usable].sort(
    (a, b) => (b.total_sleep_duration ?? -1) - (a.total_sleep_duration ?? -1),
  );
  const withValue = sorted.find((p) => p.average_breath !== null);
  return withValue ?? sorted[0];
}

export function registerRespiratoryTrendTool(
  server: McpServer,
  client: OuraClient,
): void {
  server.tool(
    "oura_respiratory_trend",
    "Derived tool: fetches detailed sleep periods and returns a clean date-indexed " +
      "respiratory-rate series. One entry per date (longest non-deleted sleep period " +
      "wins; if that period has a null average_breath, the next-longest period with " +
      "a non-null value is used). Respiratory rate is often the earliest biometric " +
      "signal of viral onset, shifting before HRV/RHR.",
    {
      start_date: z
        .string()
        .optional()
        .describe(
          "Start date YYYY-MM-DD. Defaults to today minus 6 days (7-day inclusive window).",
        ),
      end_date: z
        .string()
        .optional()
        .describe("End date YYYY-MM-DD. Defaults to today."),
    },
    async ({ start_date, end_date }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      try {
        const periods = await getSleepPeriods(client, range);
        const byDay = new Map<string, SleepPeriod[]>();
        for (const p of periods) {
          const arr = byDay.get(p.day) ?? [];
          arr.push(p);
          byDay.set(p.day, arr);
        }
        const trend: RespiratoryTrendEntry[] = [];
        for (const [day, dayPeriods] of byDay) {
          const main = pickRespPeriod(dayPeriods);
          if (!main) continue;
          trend.push({
            date: day,
            average_respiratory_rate: main.average_breath,
          });
        }
        trend.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        return textContent(trend);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
