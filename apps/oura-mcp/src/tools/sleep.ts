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
import { fetchTagsByDay, type TagEntry } from "../oura/metrics.js";

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
      "Does NOT include raw stage durations — use oura_sleep_detail for that. " +
      "Dates: \"day\" is the morning the sleep score is reported on (i.e. the sleep period ending that morning).",
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
      "All duration fields are in SECONDS, not minutes. " +
      "Dates: \"day\" is the date the sleep period started (the evening you went to bed); the sleep period ends the following morning.",
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
      "Includes optimal_bedtime offsets (minutes from midnight) and recommendation label. " +
      "Dates: \"day\" is the date the recommendation applies to (the evening of that calendar day).",
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
    "Derived tool: fetches detailed sleep periods and returns a clean date-indexed HRV series " +
      "with exactly one row per date (longest sleep period per day; falls back to next-longest if the longest has null HRV). " +
      "Fields per entry: date, average_hrv (ms RMSSD), lowest_hrv (ms RMSSD), " +
      "average_heart_rate (bpm), lowest_heart_rate (bpm). " +
      "null values mean the ring did not record HRV that night. " +
      "This is the best tool for HRV trends and cardiovascular recovery analysis. " +
      "Pass `overlay_tags: true` to attach all user tags falling on each date, " +
      "or `overlay_tags: [\"sick\", \"alcohol\"]` to filter by tag name (case-insensitive). " +
      "When set, each entry gets a `tags` array of {name, comment?, timestamp?}. " +
      "Dates: \"date\" is the date the sleep period started (sourced from the underlying sleep period's `day` field), NOT the morning the score is reported on. This differs from oura_daily_readiness/oura_daily_sleep, which key on the morning-of-report date — beware of off-by-one alignment when correlating across tools.",
    {
      start_date: z.string().optional().describe("Start date YYYY-MM-DD. Defaults to today minus 6 days (7-day inclusive window)."),
      end_date: z.string().optional().describe("End date YYYY-MM-DD. Defaults to today."),
      overlay_tags: z
        .union([z.boolean(), z.array(z.string()).min(1)])
        .optional()
        .describe(
          "Attach user tags to each row. `true` = all tags; string[] = filter by tag name (case-insensitive exact match). Omit/false = no tags.",
        ),
    },
    async ({ start_date, end_date, overlay_tags }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      try {
        const periods = await getSleepPeriods(client, range);
        // Group non-deleted periods by date, sort each group by total_sleep_duration desc,
        // and pick the longest period that has a non-null average_hrv. If every period for
        // the date has null HRV, keep the longest period anyway (so the date is still represented).
        const byDate = new Map<string, typeof periods>();
        for (const p of periods) {
          if (p.type === "deleted") continue;
          const list = byDate.get(p.day) ?? [];
          list.push(p);
          byDate.set(p.day, list);
        }
        const trend: HrvTrendEntry[] = [];
        for (const [day, group] of byDate) {
          const sorted = [...group].sort(
            (a, b) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0),
          );
          const chosen = sorted.find((p) => p.average_hrv !== null) ?? sorted[0];
          if (!chosen) continue;
          const hrvItems = chosen.hrv?.items;
          const lowest_hrv = hrvItems
            ? (() => {
                const nums = hrvItems.filter((v): v is number => v !== null);
                return nums.length > 0 ? nums.reduce((min, v) => (v < min ? v : min), nums[0]!) : null;
              })()
            : null;
          trend.push({
            date: day,
            average_hrv: chosen.average_hrv,
            lowest_hrv,
            average_heart_rate: chosen.average_heart_rate,
            lowest_heart_rate: chosen.lowest_heart_rate,
          });
        }
        trend.sort((a, b) => a.date.localeCompare(b.date));
        if (overlay_tags) {
          const tagsByDay = await fetchTagsByDay(
            client,
            range.start_date,
            range.end_date,
            overlay_tags,
          );
          const withTags = trend.map((e) => ({
            ...e,
            tags: (tagsByDay.get(e.date) ?? []) as TagEntry[],
          }));
          return textContent(withTags);
        }
        return textContent(trend);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
