import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import {
  getDailySleep,
  getSleepPeriods,
  getSleepTime,
} from "../oura/endpoints.js";
import {
  resolveDateRange,
  validateDateRange,
  textContent,
  errorContent,
} from "./utils.js";
import type { HrvTrendEntry } from "../oura/types.js";

const dateRangeSchema = {
  start_date: z
    .string()
    .optional()
    .describe("Start date YYYY-MM-DD. Defaults to today minus 6 days, 7-day inclusive window (America/Los_Angeles)."),
  end_date: z
    .string()
    .optional()
    .describe("End date YYYY-MM-DD. Defaults to today (America/Los_Angeles)."),
  max_pages: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max pagination pages (default 5, each page ~25 records)."),
};

export function registerSleepTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_daily_sleep",
    "Returns daily sleep scores and contributor breakdown for a date range. " +
      "Score is 0-100. Contributor values are 0-100. " +
      "Does NOT include raw stage durations — use oura_sleep_detail for that.",
    dateRangeSchema,
    async ({ start_date, end_date, max_pages }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      try {
        const data = await getDailySleep(client, range, max_pages);
        return textContent(data);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );

  server.tool(
    "oura_sleep_detail",
    "Returns detailed per-period sleep data including stage durations (seconds), " +
      "average and lowest heart rate (bpm), average HRV (ms RMSSD), sleep latency (seconds), " +
      "efficiency (0-100), and bedtime start/end. " +
      "All duration fields are in SECONDS, not minutes.",
    dateRangeSchema,
    async ({ start_date, end_date, max_pages }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      try {
        const data = await getSleepPeriods(client, range, max_pages);
        return textContent(data);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );

  server.tool(
    "oura_sleep_time_recommendation",
    "Returns Oura's recommended sleep time window and status for each day. " +
      "Includes optimal_bedtime offsets (minutes from midnight) and recommendation label.",
    {
      start_date: z.string().optional().describe("Start date YYYY-MM-DD. Defaults to today minus 6 days (7-day inclusive window)."),
      end_date: z.string().optional().describe("End date YYYY-MM-DD. Defaults to today."),
    },
    async ({ start_date, end_date }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      try {
        const data = await getSleepTime(client, range);
        return textContent(data);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );

  server.tool(
    "oura_hrv_trend",
    "Derived tool: fetches detailed sleep periods and returns a clean date-indexed HRV series. " +
      "Fields per entry: date, average_hrv (ms RMSSD), lowest_hrv (ms RMSSD), " +
      "average_heart_rate (bpm), lowest_heart_rate (bpm). " +
      "null values mean the ring did not record HRV that night. " +
      "This is the best tool for HRV trends and cardiovascular recovery analysis.",
    {
      start_date: z.string().optional().describe("Start date YYYY-MM-DD. Defaults to today minus 6 days (7-day inclusive window)."),
      end_date: z.string().optional().describe("End date YYYY-MM-DD. Defaults to today."),
    },
    async ({ start_date, end_date }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      try {
        const periods = await getSleepPeriods(client, range);
        const trend: HrvTrendEntry[] = periods
          .filter((p) => p.type !== "deleted")
          .map((p) => ({
            date: p.day,
            average_hrv: p.average_hrv,
            lowest_hrv: p.hrv?.items
              ? (() => {
                  const nums = p.hrv.items.filter((v): v is number => v !== null);
                  return nums.length > 0 ? nums.reduce((min, v) => (v < min ? v : min), nums[0]) : null;
                })()
              : null,
            average_heart_rate: p.average_heart_rate,
            lowest_heart_rate: p.lowest_heart_rate,
          }));
        return textContent(trend);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
