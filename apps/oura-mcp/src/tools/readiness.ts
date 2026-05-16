import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailyReadiness, getSleepPeriods } from "../oura/endpoints.js";
import { addDays, fetchTagsByDay, type TagEntry } from "../oura/metrics.js";
import { defined, mean } from "../oura/stats.js";
import type { DailyReadiness, SleepPeriod } from "../oura/types.js";
import { resolveDateRange, validateDateRange, textContent, errorContent } from "./utils.js";

// Rolling window (days) used to compute personal baselines for raw biometric
// values. Matches the "recent trend" framing Oura itself uses for contributor
// scoring (~2 weeks). Kept smaller than baseline_compare's default of 30 to
// avoid expanding the /sleep fetch window further.
const BASELINE_WINDOW_DAYS = 14;

interface RawValues {
  rhr_bpm?: number;
  rhr_baseline?: number;
  hrv_ms?: number;
  hrv_baseline?: number;
  body_temperature_deviation_c?: number;
  resp_rate?: number;
  resp_rate_baseline?: number;
}

interface ReadinessWithRawValues extends DailyReadiness {
  raw_values: RawValues;
}

/**
 * Pick the longest-duration non-deleted sleep period per day.
 * Mirrors `mainSleepPerDay` in oura/metrics.ts but is duplicated locally
 * to keep that helper's private encapsulation intact.
 */
function mainSleepPerDay(periods: SleepPeriod[]): Map<string, SleepPeriod> {
  const byDay = new Map<string, SleepPeriod>();
  for (const p of periods) {
    if (p.type === "deleted") continue;
    const existing = byDay.get(p.day);
    const existingDur = existing?.total_sleep_duration ?? -1;
    const candidateDur = p.total_sleep_duration ?? -1;
    if (!existing || candidateDur > existingDur) byDay.set(p.day, p);
  }
  return byDay;
}

/** Mean over the BASELINE_WINDOW_DAYS days strictly preceding `day`. */
function rollingBaseline(
  day: string,
  source: Map<string, number | null>,
): number | undefined {
  const values: (number | null)[] = [];
  for (let i = 1; i <= BASELINE_WINDOW_DAYS; i++) {
    const d = addDays(day, -i);
    if (source.has(d)) values.push(source.get(d) ?? null);
  }
  const cleaned = defined(values);
  if (cleaned.length === 0) return undefined;
  return mean(cleaned);
}

export function registerReadinessTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_daily_readiness",
    "Returns daily readiness scores (0-100) and contributor breakdown. " +
      "Contributors include HRV balance, resting heart rate, sleep balance, " +
      "activity balance, body temperature, and sleep regularity. " +
      "Each day also includes a `raw_values` object with the underlying " +
      "biometrics (rhr_bpm, hrv_ms, body_temperature_deviation_c, resp_rate) " +
      "sourced from the main overnight sleep period, plus rolling 14-day " +
      "baselines (rhr_baseline, hrv_baseline, resp_rate_baseline). Fields " +
      "are omitted when the underlying data is unavailable. " +
      "Pass `overlay_tags: true` to attach all user tags falling on each date, " +
      "or `overlay_tags: [\"sick\", \"alcohol\"]` to filter by tag name (exact, case-insensitive). " +
      "When set, each row gets a `tags` array of {name, comment?, timestamp?}.",
    {
      start_date: z.string().optional().describe("Start date YYYY-MM-DD. Defaults to today minus 6 days (7-day inclusive window)."),
      end_date: z.string().optional().describe("End date YYYY-MM-DD. Defaults to today."),
      max_pages: z.number().int().min(1).max(20).optional().describe("Max pagination pages (default 5)."),
      overlay_tags: z
        .union([z.boolean(), z.array(z.string()).min(1)])
        .optional()
        .describe(
          "Attach user tags to each row. `true` = all tags; string[] = filter by tag name (case-insensitive exact match). Omit/false = no tags.",
        ),
    },
    async ({ start_date, end_date, max_pages, overlay_tags }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      try {
        const readiness = await getDailyReadiness(client, range, max_pages);

        // Pull a slightly wider /sleep window so we have BASELINE_WINDOW_DAYS
        // of prior data for the earliest readiness day. One extra paginated
        // GET — well within the "keep latency reasonable" constraint.
        const sleepRange = {
          start_date: addDays(range.start_date, -BASELINE_WINDOW_DAYS),
          end_date: range.end_date,
        };
        const sleepPeriods = await getSleepPeriods(client, sleepRange, max_pages);
        const main = mainSleepPerDay(sleepPeriods);

        // Build per-day series for each raw metric to support rolling baselines.
        const rhrByDay = new Map<string, number | null>();
        const hrvByDay = new Map<string, number | null>();
        const respByDay = new Map<string, number | null>();
        for (const [day, p] of main) {
          rhrByDay.set(day, p.lowest_heart_rate);
          hrvByDay.set(day, p.average_hrv);
          respByDay.set(day, p.average_breath);
        }

        const enriched: ReadinessWithRawValues[] = readiness.map((r) => {
          const sleep = main.get(r.day);
          const raw: RawValues = {};

          const rhr = sleep?.lowest_heart_rate;
          if (rhr !== null && rhr !== undefined) raw.rhr_bpm = rhr;
          const rhrBase = rollingBaseline(r.day, rhrByDay);
          if (rhrBase !== undefined) raw.rhr_baseline = rhrBase;

          const hrv = sleep?.average_hrv;
          if (hrv !== null && hrv !== undefined) raw.hrv_ms = hrv;
          const hrvBase = rollingBaseline(r.day, hrvByDay);
          if (hrvBase !== undefined) raw.hrv_baseline = hrvBase;

          // temperature_deviation lives directly on the readiness object
          // (in degrees Celsius, per Oura's API docs).
          if (r.temperature_deviation !== null && r.temperature_deviation !== undefined) {
            raw.body_temperature_deviation_c = r.temperature_deviation;
          }

          const resp = sleep?.average_breath;
          if (resp !== null && resp !== undefined) raw.resp_rate = resp;
          const respBase = rollingBaseline(r.day, respByDay);
          if (respBase !== undefined) raw.resp_rate_baseline = respBase;

          return { ...r, raw_values: raw };
        });

        if (overlay_tags) {
          const tagsByDay = await fetchTagsByDay(
            client,
            range.start_date,
            range.end_date,
            overlay_tags,
          );
          const withTags = enriched.map((r) => ({
            ...r,
            tags: (tagsByDay.get(r.day) ?? []) as TagEntry[],
          }));
          return textContent(withTags);
        }

        return textContent(enriched);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
