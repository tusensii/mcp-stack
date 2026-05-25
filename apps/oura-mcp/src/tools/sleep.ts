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
import type { HrvTrendEntry, SleepPeriod } from "../oura/types.js";
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

// Fields stripped from SleepPeriod records when include_time_series is false.
const TIME_SERIES_FIELDS = [
  "heart_rate",
  "hrv",
  "sleep_phase_30_sec",
  "sleep_phase_5_min",
  "app_sleep_phase_5_min",
  "movement_30_sec",
] as const;

/**
 * Returns a copy of the SleepPeriod with the time-series arrays/strings removed.
 * Used by oura_sleep_detail and oura_naps to trim response size.
 */
export function stripTimeSeries(p: SleepPeriod): Omit<SleepPeriod, (typeof TIME_SERIES_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...p };
  for (const f of TIME_SERIES_FIELDS) {
    delete copy[f];
  }
  return copy as Omit<SleepPeriod, (typeof TIME_SERIES_FIELDS)[number]>;
}

/**
 * Adds N days to a YYYY-MM-DD date string. N may be negative.
 * Computed in UTC; the input is interpreted as a calendar date, not a moment.
 */
export function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Filters sleep periods whose `day` field falls within [start, end] inclusive.
 * Used to post-filter after widening the upstream /sleep call by 1 day on each
 * side — see issue #33: the Oura /sleep endpoint filters by `bedtime_start`
 * date, not by `day`, so a record with `day: X` but `bedtime_start: X-1` is
 * silently dropped from a `start=end=X` query.
 */
export function filterPeriodsByDay(
  periods: SleepPeriod[],
  start_date: string,
  end_date: string,
): SleepPeriod[] {
  return periods.filter((p) => p.day >= start_date && p.day <= end_date);
}

export function registerSleepTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_daily_sleep",
    "Returns daily sleep scores and contributor breakdown for a date range. " +
      "Score is 0-100. All contributor values are 0-100 on a higher-is-better scale " +
      "(e.g. high `latency` means short time to fall asleep, not long latency). " +
      "Contributor notes: `timing` = bedtime regularity (not clock time); " +
      "`efficiency` = derived score (not the raw efficiency percentage). " +
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
      "Dates: \"day\" is typically the morning-of-report date (the date the sleep period ends), " +
      "matching oura_daily_sleep — but the keying is inconsistent across sleep period types: " +
      "`long_sleep` and `late_nap` records are keyed to the morning of the NEXT sleep score window, " +
      "while short `sleep` records are keyed to the calendar date they actually occurred on. " +
      "This makes naive `day == X` filtering a hazard for naps in particular. " +
      "When narrowing to a single day, this tool widens the upstream call by 1 day on each side " +
      "and post-filters by `day` so `start_date == end_date == X` reliably returns all records with `day: X`. " +
      "By default, the response strips time-series fields (heart_rate, hrv, sleep_phase_30_sec, " +
      "sleep_phase_5_min, app_sleep_phase_5_min, movement_30_sec) to keep payloads small; " +
      "set `include_time_series: true` to get the raw payload including those fields.",
    {
      ...dateRangeSchema,
      include_time_series: z
        .boolean()
        .optional()
        .describe(
          "If true, return the raw payload including time-series fields (heart_rate.items, hrv.items, sleep_phase_30_sec, sleep_phase_5_min, app_sleep_phase_5_min, movement_30_sec). Default false (stripped).",
        ),
    },
    async ({ start_date, end_date, max_pages, include_time_series }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      // Issue #33: widen by 1 day on each side and post-filter by `day`, since
      // the Oura /sleep endpoint filters on bedtime_start date, not on `day`.
      const widened = {
        start_date: shiftDate(range.start_date, -1),
        end_date: shiftDate(range.end_date, 1),
      };
      try {
        const raw = await getSleepPeriods(client, widened, max_pages);
        const filtered = filterPeriodsByDay(raw, range.start_date, range.end_date);
        const out = include_time_series ? filtered : filtered.map(stripTimeSeries);
        return textContent(out);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );

  server.tool(
    "oura_naps",
    "Returns only auto-detected nap periods (type === \"nap\" || type === \"late_nap\") from the " +
      "/sleep stream. This is the right tool for \"did the user nap in window X?\" — `oura_sessions` " +
      "only returns user-initiated sessions, not auto-detected naps. " +
      "Per-nap fields: day, type, bedtime_start, bedtime_end, total_sleep_duration (seconds), " +
      "efficiency (0-100), average_heart_rate (bpm), average_hrv (ms RMSSD). " +
      "Dates: `day` follows the Oura per-type keying — `late_nap` is keyed to the morning of the " +
      "NEXT sleep score window, while short naps may be keyed to their calendar date. When hunting " +
      "for naps that occurred on a specific evening, query a wider window (e.g. ±1 day) to be safe. " +
      "Like oura_sleep_detail, this tool widens the upstream call by 1 day on each side and post-filters " +
      "by `day` so single-day queries don't silently drop records.",
    dateRangeSchema,
    async ({ start_date, end_date, max_pages }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      const widened = {
        start_date: shiftDate(range.start_date, -1),
        end_date: shiftDate(range.end_date, 1),
      };
      try {
        const raw = await getSleepPeriods(client, widened, max_pages);
        const filtered = filterPeriodsByDay(raw, range.start_date, range.end_date);
        const naps = filtered
          .filter((p) => p.type === "nap" || p.type === "late_nap")
          .map((p) => ({
            day: p.day,
            type: p.type,
            bedtime_start: p.bedtime_start,
            bedtime_end: p.bedtime_end,
            total_sleep_duration: p.total_sleep_duration,
            efficiency: p.efficiency,
            average_heart_rate: p.average_heart_rate,
            average_hrv: p.average_hrv,
          }));
        return textContent(naps);
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
          if (p.type !== "sleep" && p.type !== "long_sleep") continue;
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
