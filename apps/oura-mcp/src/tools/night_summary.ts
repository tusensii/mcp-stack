import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailySleep, getDailyReadiness, getSleepPeriods } from "../oura/endpoints.js";
import { addDays, fetchMetricByDay, fetchTagsByDay, type TagEntry } from "../oura/metrics.js";
import { defined, mean } from "../oura/stats.js";
import type { SleepPeriod } from "../oura/types.js";
import { todayInTz, textContent, errorContent, titledTool } from "./utils.js";

// How many days back to search for "the most recent synced night" when no
// `date` is given. 3 days comfortably covers a normal sync-lag window.
const LOOKBACK_DAYS = 3;

// Rolling window (days) for the HRV/RHR baseline context, matching
// oura_daily_readiness's BASELINE_WINDOW_DAYS.
const BASELINE_WINDOW_DAYS = 14;

/**
 * Picks the "main" sleep period (longest sleep/long_sleep, non-deleted) for
 * a given day out of a list of periods. Duplicated in small form here (see
 * also readiness.ts and metrics.ts) to keep this tool self-contained; all
 * three implement the same selection rule.
 */
export function mainPeriodForDay(periods: SleepPeriod[], day: string): SleepPeriod | undefined {
  let best: SleepPeriod | undefined;
  for (const p of periods) {
    if (p.type !== "sleep" && p.type !== "long_sleep") continue;
    if (p.day !== day) continue;
    const bestDur = best?.total_sleep_duration ?? -1;
    const candidateDur = p.total_sleep_duration ?? -1;
    if (!best || candidateDur > bestDur) best = p;
  }
  return best;
}

/**
 * Finds the most recent complete night (largest bedtime_end) among
 * sleep/long_sleep, non-deleted periods in the given list.
 */
export function mostRecentNight(periods: SleepPeriod[]): SleepPeriod | undefined {
  let best: SleepPeriod | undefined;
  for (const p of periods) {
    if (p.type !== "sleep" && p.type !== "long_sleep") continue;
    if (!best || Date.parse(p.bedtime_end) > Date.parse(best.bedtime_end)) best = p;
  }
  return best;
}

export function registerNightSummaryTool(server: McpServer, client: OuraClient): void {
  titledTool(
    server,
    "oura_night_summary",
    "Summarizing your night…",
    "Composite tool: answers 'how did I sleep?' in a single call by combining the sleep score " +
      "and contributors (from oura_daily_sleep), stage durations/HR/HRV/latency/efficiency highlights " +
      "(from oura_sleep_detail, stripped of bulky time-series arrays), the same-morning readiness score " +
      "and contributors, 14-day HRV/RHR baseline context, and any user tags overlapping the night. " +
      "Identifies the night unambiguously via `bedtime_start`/`bedtime_end` so there is no ambiguity " +
      "about which physical night is being summarized, regardless of the sleep-period-start vs. " +
      "morning-of-report date convention mismatch documented elsewhere in this server. " +
      "Default (no `date`): the most recently synced complete night within the last " +
      `${LOOKBACK_DAYS} days. ` +
      "Pass `date` (YYYY-MM-DD, morning-of-report convention — same as oura_daily_sleep's \"day\") " +
      "to summarize a specific morning instead. " +
      "Contains no bulky per-sample time-series data.",
    {
      date: z
        .string()
        .optional()
        .describe(
          "YYYY-MM-DD, morning-of-report date (same convention as oura_daily_sleep's `day`). Omit for the most recent synced night.",
        ),
    },
    async ({ date }) => {
      try {
        let mainPeriod: SleepPeriod | undefined;
        let resolvedDay: string;

        if (date) {
          // Widen by 1 day on each side, same reasoning as #33/#46: Oura's
          // /sleep endpoint filters by bedtime_start, not by `day`.
          const widened = { start_date: addDays(date, -1), end_date: addDays(date, 1) };
          const periods = await getSleepPeriods(client, widened);
          mainPeriod = mainPeriodForDay(periods, date);
          resolvedDay = date;
        } else {
          const today = todayInTz();
          const windowStart = addDays(today, -LOOKBACK_DAYS);
          const periods = await getSleepPeriods(client, { start_date: windowStart, end_date: today });
          mainPeriod = mostRecentNight(periods);
          if (!mainPeriod) {
            return errorContent(
              `No synced sleep period found in the last ${LOOKBACK_DAYS} days. The most recent night may not have synced yet.`,
            );
          }
          resolvedDay = mainPeriod.day;
        }

        if (!mainPeriod) {
          return errorContent(`No sleep period found for ${resolvedDay}.`);
        }

        const dayRange = { start_date: resolvedDay, end_date: resolvedDay };
        const [dailySleep, dailyReadiness, tagsByDay, hrvBaselineSeries, rhrBaselineSeries] =
          await Promise.all([
            getDailySleep(client, dayRange),
            getDailyReadiness(client, dayRange),
            // Tags may be logged the evening before (bedtime_start's calendar
            // date) or the morning of; check both buckets.
            fetchTagsByDay(client, addDays(resolvedDay, -1), resolvedDay, true),
            fetchMetricByDay(
              client,
              "hrv",
              addDays(resolvedDay, -BASELINE_WINDOW_DAYS),
              addDays(resolvedDay, -1),
            ),
            fetchMetricByDay(
              client,
              "rhr",
              addDays(resolvedDay, -BASELINE_WINDOW_DAYS),
              addDays(resolvedDay, -1),
            ),
          ]);

        const sleepScore = dailySleep.find((d) => d.day === resolvedDay);
        const readiness = dailyReadiness.find((r) => r.day === resolvedDay);

        const eveningTags = tagsByDay.get(addDays(resolvedDay, -1)) ?? [];
        const morningTags = tagsByDay.get(resolvedDay) ?? [];
        const tags: TagEntry[] = [...eveningTags, ...morningTags];

        const hrvValues = defined([...hrvBaselineSeries.values()]);
        const rhrValues = defined([...rhrBaselineSeries.values()]);
        const hrvBaseline = hrvValues.length > 0 ? mean(hrvValues) : null;
        const rhrBaseline = rhrValues.length > 0 ? mean(rhrValues) : null;

        const result = {
          date: resolvedDay,
          bedtime_start: mainPeriod.bedtime_start,
          bedtime_end: mainPeriod.bedtime_end,
          sleep: {
            score: sleepScore?.score ?? null,
            contributors: sleepScore?.contributors ?? null,
            total_sleep_duration: mainPeriod.total_sleep_duration,
            time_in_bed: mainPeriod.time_in_bed,
            efficiency: mainPeriod.efficiency,
            latency: mainPeriod.latency,
            awake_time: mainPeriod.awake_time,
            deep_sleep_duration: mainPeriod.deep_sleep_duration,
            light_sleep_duration: mainPeriod.light_sleep_duration,
            rem_sleep_duration: mainPeriod.rem_sleep_duration,
            restless_periods: mainPeriod.restless_periods,
            average_heart_rate: mainPeriod.average_heart_rate,
            lowest_heart_rate: mainPeriod.lowest_heart_rate,
            average_hrv: mainPeriod.average_hrv,
            average_breath: mainPeriod.average_breath,
          },
          readiness: readiness
            ? {
                score: readiness.score,
                contributors: readiness.contributors,
                temperature_deviation: readiness.temperature_deviation,
              }
            : null,
          baselines: {
            hrv_ms_14d_mean: hrvBaseline,
            rhr_bpm_14d_mean: rhrBaseline,
          },
          tags,
        };

        return textContent(result);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
