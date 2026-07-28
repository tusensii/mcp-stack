import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailyActivity } from "../oura/endpoints.js";
import type { DailyActivity } from "../oura/types.js";
import { resolveDateRange, validateDateRange, textContent, errorContent } from "./utils.js";

// Bulky per-sample fields stripped from DailyActivity when include_time_series
// is false (#47): `met` is a ~700-sample per-minute array, `class_5_min` is a
// per-5-min activity-class string. Both are meaningful for deep-dive analysis
// but dominate response size for the common "how active was day X" question.
const ACTIVITY_TIME_SERIES_FIELDS = ["met", "class_5_min"] as const;

/**
 * Returns a copy of the DailyActivity with the bulky per-sample fields
 * removed, keeping all scalar/summary fields (score, contributors, steps,
 * calories, per-intensity MET minutes, time breakdowns).
 */
export function stripActivityTimeSeries(
  d: DailyActivity,
): Omit<DailyActivity, (typeof ACTIVITY_TIME_SERIES_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...d };
  for (const f of ACTIVITY_TIME_SERIES_FIELDS) {
    delete copy[f];
  }
  return copy as Omit<DailyActivity, (typeof ACTIVITY_TIME_SERIES_FIELDS)[number]>;
}

export function registerActivityTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_daily_activity",
    "Returns daily activity scores (0-100), step count, active calories, total calories, " +
      "MET minutes by intensity, and time breakdowns. " +
      "All time fields (high_activity_time, sedentary_time, etc.) are in SECONDS. " +
      "Dates: \"day\" is the calendar day the activity occurred. " +
      "By default, the response strips bulky per-sample fields (`met` per-minute array, " +
      "`class_5_min` per-5-min activity-class string) to keep payloads small; all scalar/summary " +
      "fields (score, contributors, steps, calories, MET minutes, time breakdowns) are always included. " +
      "Set `include_time_series: true` to get the raw payload including `met` and `class_5_min`.",
    {
      start_date: z.string().optional().describe("Start date YYYY-MM-DD. Defaults to today minus 6 days (7-day inclusive window)."),
      end_date: z.string().optional().describe("End date YYYY-MM-DD. Defaults to today."),
      max_pages: z.number().int().min(1).max(20).optional().describe("Max pagination pages (default 5)."),
      include_time_series: z
        .boolean()
        .optional()
        .describe(
          "If true, return the raw payload including the bulky `met` (per-minute array) and `class_5_min` (per-5-min string) fields. Default false (stripped).",
        ),
    },
    async ({ start_date, end_date, max_pages, include_time_series }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      try {
        const data = await getDailyActivity(client, range, max_pages);
        const out = include_time_series ? data : data.map(stripActivityTimeSeries);
        return textContent(out);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
