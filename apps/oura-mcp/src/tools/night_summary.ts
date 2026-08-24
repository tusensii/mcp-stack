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
 * Upstream /sleep window to request for the no-`date` "most recent synced
 * night" lookup, given today's date in the user's timezone.
 *
 * Same #33 hazard the sleep tools work around: the Oura /sleep endpoint does
 * NOT filter on `day`, so a record with `day: X` is silently dropped from a
 * query whose `end_date` is X. Observed live on 2026-08-24
 * (America/Los_Angeles): a long_sleep with `day: 2026-08-24` /
 * `bedtime_start: 2026-08-23T22:59:54-07:00` was absent from
 * `start=2026-08-21&end=2026-08-24` but present from the same query ending
 * 2026-08-25. Without the +1 day on the end, night_summary could never see
 * last night and always lagged one night behind oura_sleep_detail.
 *
 * So: widen by one day on each side and post-filter by `day`
 * (selectMostRecentNight), the same pattern oura_sleep_detail/oura_naps use.
 */
export function lookbackWindow(today: string): { start_date: string; end_date: string } {
  return {
    start_date: addDays(today, -(LOOKBACK_DAYS + 1)),
    end_date: addDays(today, 1),
  };
}

/**
 * Picks the most recent complete night at or before `today` out of the raw
 * (widened) upstream response.
 *
 * Selection rule:
 *   1. keep sleep/long_sleep periods whose `day` lands in the lookback window
 *      [today - LOOKBACK_DAYS, today] — this re-applies the `day` filter the
 *      widening in lookbackWindow deliberately relaxed, and keeps a period
 *      keyed forward to tomorrow from dragging the answer past today;
 *   2. take the latest such `day`;
 *   3. return that day's main (longest) period — the same rule the explicit
 *      `date` branch uses, so both branches agree with oura_sleep_detail.
 *
 * Keying on `day` rather than on the largest `bedtime_end` is deliberate:
 * `day` is the morning-of-report field the rest of the response
 * (daily_sleep / daily_readiness / tags) is looked up by, and it keeps a short
 * evening `sleep` record from outranking the real night it belongs to.
 *
 * Nothing is excluded on the basis of `sleep_analysis_reason` or a non-zero
 * score delta: a `bedtime_edit` night is a real, complete night and must stay
 * selectable.
 */
export function selectMostRecentNight(
  periods: SleepPeriod[],
  today: string,
): SleepPeriod | undefined {
  const windowStart = addDays(today, -LOOKBACK_DAYS);
  const inWindow = periods.filter(
    (p) =>
      (p.type === "sleep" || p.type === "long_sleep") && p.day >= windowStart && p.day <= today,
  );
  let latestDay: string | undefined;
  for (const p of inWindow) {
    if (!latestDay || p.day > latestDay) latestDay = p.day;
  }
  if (!latestDay) return undefined;
  return mainPeriodForDay(inWindow, latestDay);
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
      "That is the same night oura_sleep_detail returns for today when today's night has synced, " +
      "falling back through the lookback window only when it hasn't. " +
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
          const periods = await getSleepPeriods(client, lookbackWindow(today));
          mainPeriod = selectMostRecentNight(periods, today);
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
