import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import {
  getDailySleep,
  getDailyReadiness,
  getDailyActivity,
  getSleepPeriods,
  getEnhancedTags,
  getWorkouts,
} from "../oura/endpoints.js";
import { textContent, errorContent, todayInTz } from "./utils.js";
import { defined, mean, linearSlope } from "../oura/stats.js";
import type { SleepPeriod } from "../oura/types.js";
import { detectAnomalies, buildMetricSeries } from "./anomaly_detect.js";

/** Add N days to YYYY-MM-DD. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Day-of-week from YYYY-MM-DD, 0=Sun..6=Sat using UTC noon to dodge DST. */
function dayOfWeek(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Most recent Sunday <= date (returns date itself if it's Sunday). */
function mostRecentSunday(date: string): string {
  const dow = dayOfWeek(date);
  return shiftDate(date, -dow);
}

/** Pick canonical main sleep period for a day. */
function pickMainSleep(periods: SleepPeriod[]): SleepPeriod | undefined {
  const usable = periods.filter((p) => p.type !== "deleted");
  if (usable.length === 0) return undefined;
  const longSleep = usable.find((p) => p.type === "long_sleep");
  if (longSleep) return longSleep;
  return [...usable].sort(
    (a, b) => (b.total_sleep_duration ?? 0) - (a.total_sleep_duration ?? 0),
  )[0];
}

function pctChange(value: number, baseline: number): number {
  if (baseline === 0) return 0;
  return Math.round(((value - baseline) / baseline) * 1000) / 10;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function registerWeeklyDigestTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_weekly_digest",
    "Composite weekly summary across sleep, readiness, HRV, activity, anomalies, " +
      "and tags. Returns area-by-area numbers plus highlights (positive things) " +
      "and watch_outs (concerns). Default window is the 7 days ending the most " +
      "recent Sunday in the user's TZ. Plain factual summary; agent layers narrative. " +
      "Dates: week_start/week_ending bracket a calendar window, but the metrics inside mix conventions — sleep-period-derived stats (HRV, RHR, deep/REM sleep, total sleep) bucket by sleep-period-start date, while readiness/sleep score/activity score bucket by morning-of-report date. Tag bucketing uses tag start_day. Differences are usually within ±1 day for any given night.",
    {
      week_ending: z
        .string()
        .optional()
        .describe("YYYY-MM-DD. Default: most recent Sunday in user's TZ."),
    },
    async ({ week_ending }) => {
      const weekEnd = week_ending ?? mostRecentSunday(todayInTz());
      const weekStart = shiftDate(weekEnd, -6);
      const baselineEnd = shiftDate(weekStart, -1);
      const baselineStart = shiftDate(baselineEnd, -29);

      // Fetch start covers both baseline (30d) and week (7d)
      const fetchStart = baselineStart;
      const fetchEnd = weekEnd;
      const params = { start_date: fetchStart, end_date: fetchEnd };

      try {
        const [sleepDaily, readiness, activity, sleepPeriods, tags, workouts] =
          await Promise.all([
            getDailySleep(client, params, 20),
            getDailyReadiness(client, params, 20),
            getDailyActivity(client, params, 20),
            getSleepPeriods(client, params, 20),
            getEnhancedTags(client, params, 20),
            getWorkouts(client, params, 20),
          ]);

        // Maps for week & baseline membership
        const weekDays: string[] = [];
        for (let d = weekStart; d <= weekEnd; d = shiftDate(d, 1)) weekDays.push(d);
        const inWeek = (day: string): boolean => day >= weekStart && day <= weekEnd;
        const inBaseline = (day: string): boolean =>
          day >= baselineStart && day <= baselineEnd;

        // Per-day sleep period (main)
        const periodsByDay = new Map<string, SleepPeriod[]>();
        for (const p of sleepPeriods) {
          const arr = periodsByDay.get(p.day) ?? [];
          arr.push(p);
          periodsByDay.set(p.day, arr);
        }
        const mainSleepByDay = new Map<string, SleepPeriod>();
        for (const [day, ps] of periodsByDay) {
          const main = pickMainSleep(ps);
          if (main) mainSleepByDay.set(day, main);
        }

        // ---- Sleep block (week vs baseline) ----
        const weekSleepScores: number[] = [];
        const baselineSleepScores: number[] = [];
        for (const s of sleepDaily) {
          if (s.score === null) continue;
          if (inWeek(s.day)) weekSleepScores.push(s.score);
          else if (inBaseline(s.day)) baselineSleepScores.push(s.score);
        }

        const weekTotalSleep: number[] = []; // hours
        const weekDeepSleep: number[] = []; // minutes
        const weekRem: number[] = []; // minutes
        const weekEfficiency: number[] = [];
        const baselineDeepSleep: number[] = [];
        const baselineTotalSleep: number[] = [];
        for (const [day, p] of mainSleepByDay) {
          if (inWeek(day)) {
            if (p.total_sleep_duration !== null)
              weekTotalSleep.push(p.total_sleep_duration / 3600);
            if (p.deep_sleep_duration !== null)
              weekDeepSleep.push(p.deep_sleep_duration / 60);
            if (p.rem_sleep_duration !== null)
              weekRem.push(p.rem_sleep_duration / 60);
            if (p.efficiency !== null) weekEfficiency.push(p.efficiency);
          } else if (inBaseline(day)) {
            if (p.deep_sleep_duration !== null)
              baselineDeepSleep.push(p.deep_sleep_duration / 60);
            if (p.total_sleep_duration !== null)
              baselineTotalSleep.push(p.total_sleep_duration / 3600);
          }
        }

        const weekSleepScoreMean =
          weekSleepScores.length > 0 ? mean(weekSleepScores) : null;
        const baselineSleepScoreMean =
          baselineSleepScores.length > 0 ? mean(baselineSleepScores) : null;
        const weekDeepSleepMean = weekDeepSleep.length > 0 ? mean(weekDeepSleep) : null;
        const baselineDeepSleepMean =
          baselineDeepSleep.length > 0 ? mean(baselineDeepSleep) : null;
        const weekTotalSleepMean = weekTotalSleep.length > 0 ? mean(weekTotalSleep) : null;
        const baselineTotalSleepMean =
          baselineTotalSleep.length > 0 ? mean(baselineTotalSleep) : null;

        const sleepBlock = {
          avg_sleep_score:
            weekSleepScoreMean === null ? null : Math.round(weekSleepScoreMean),
          avg_total_sleep_hours:
            weekTotalSleepMean === null ? null : round1(weekTotalSleepMean),
          avg_deep_sleep_minutes:
            weekDeepSleepMean === null ? null : Math.round(weekDeepSleepMean),
          avg_rem_sleep_minutes:
            weekRem.length > 0 ? Math.round(mean(weekRem)) : null,
          avg_efficiency:
            weekEfficiency.length > 0 ? Math.round(mean(weekEfficiency)) : null,
          vs_baseline_score_pct:
            weekSleepScoreMean !== null && baselineSleepScoreMean !== null
              ? pctChange(weekSleepScoreMean, baselineSleepScoreMean)
              : null,
          vs_baseline_total_sleep_pct:
            weekTotalSleepMean !== null && baselineTotalSleepMean !== null
              ? pctChange(weekTotalSleepMean, baselineTotalSleepMean)
              : null,
        };

        // ---- Readiness block ----
        const weekReadinessScores: number[] = [];
        const baselineReadinessScores: number[] = [];
        const weekReadinessOrdered: number[] = [];
        const dayToReadiness = new Map<string, number | null>();
        for (const r of readiness) dayToReadiness.set(r.day, r.score);
        for (const day of weekDays) {
          const v = dayToReadiness.get(day);
          if (v !== null && v !== undefined) {
            weekReadinessScores.push(v);
            weekReadinessOrdered.push(v);
          }
        }
        for (const r of readiness) {
          if (r.score === null) continue;
          if (inBaseline(r.day)) baselineReadinessScores.push(r.score);
        }

        const weekReadinessMean =
          weekReadinessScores.length > 0 ? mean(weekReadinessScores) : null;
        const baselineReadinessMean =
          baselineReadinessScores.length > 0 ? mean(baselineReadinessScores) : null;
        const readinessSlope =
          weekReadinessOrdered.length >= 2 ? linearSlope(weekReadinessOrdered) : 0;

        const readinessBlock = {
          avg_readiness: weekReadinessMean === null ? null : Math.round(weekReadinessMean),
          vs_baseline_pct:
            weekReadinessMean !== null && baselineReadinessMean !== null
              ? pctChange(weekReadinessMean, baselineReadinessMean)
              : null,
          slope_per_day: round1(readinessSlope),
        };

        // ---- HRV block ----
        const weekHrv: number[] = [];
        const baselineHrv: number[] = [];
        const weekRhr: number[] = [];
        const baselineRhr: number[] = [];
        for (const [day, p] of mainSleepByDay) {
          if (inWeek(day)) {
            if (p.average_hrv !== null) weekHrv.push(p.average_hrv);
            if (p.lowest_heart_rate !== null) weekRhr.push(p.lowest_heart_rate);
          } else if (inBaseline(day)) {
            if (p.average_hrv !== null) baselineHrv.push(p.average_hrv);
            if (p.lowest_heart_rate !== null) baselineRhr.push(p.lowest_heart_rate);
          }
        }
        const weekHrvMean = weekHrv.length > 0 ? mean(weekHrv) : null;
        const baselineHrvMean = baselineHrv.length > 0 ? mean(baselineHrv) : null;
        const weekRhrMean = weekRhr.length > 0 ? mean(weekRhr) : null;
        const baselineRhrMean = baselineRhr.length > 0 ? mean(baselineRhr) : null;

        const hrvBlock = {
          avg_hrv_ms: weekHrvMean === null ? null : Math.round(weekHrvMean),
          avg_rhr_bpm: weekRhrMean === null ? null : Math.round(weekRhrMean),
          vs_baseline_hrv_pct:
            weekHrvMean !== null && baselineHrvMean !== null
              ? pctChange(weekHrvMean, baselineHrvMean)
              : null,
          vs_baseline_rhr_pct:
            weekRhrMean !== null && baselineRhrMean !== null
              ? pctChange(weekRhrMean, baselineRhrMean)
              : null,
        };

        // ---- Activity block ----
        const weekActivityScores: number[] = [];
        const weekSteps: number[] = [];
        const weekActiveCalories: number[] = [];
        const baselineActivityScores: number[] = [];
        for (const a of activity) {
          if (inWeek(a.day)) {
            if (a.score !== null) weekActivityScores.push(a.score);
            weekSteps.push(a.steps);
            weekActiveCalories.push(a.active_calories);
          } else if (inBaseline(a.day)) {
            if (a.score !== null) baselineActivityScores.push(a.score);
          }
        }
        const weekActivityMean =
          weekActivityScores.length > 0 ? mean(weekActivityScores) : null;
        const baselineActivityMean =
          baselineActivityScores.length > 0 ? mean(baselineActivityScores) : null;

        const weekWorkouts = workouts.filter((w) => inWeek(w.day));

        const activityBlock = {
          avg_activity_score:
            weekActivityMean === null ? null : Math.round(weekActivityMean),
          avg_steps: weekSteps.length > 0 ? Math.round(mean(weekSteps)) : null,
          avg_active_calories:
            weekActiveCalories.length > 0 ? Math.round(mean(weekActiveCalories)) : null,
          vs_baseline_score_pct:
            weekActivityMean !== null && baselineActivityMean !== null
              ? pctChange(weekActivityMean, baselineActivityMean)
              : null,
          workouts_logged: weekWorkouts.length,
        };

        // ---- Anomalies (z>2.0 vs 30d baseline, top 3 by |z|) ----
        // Reuse already-fetched arrays — no extra API calls.
        const series = buildMetricSeries(readiness, sleepDaily, activity, sleepPeriods);
        const allWeekAnomalies = detectAnomalies(
          series,
          [
            "readiness",
            "sleep_score",
            "hrv",
            "rhr",
            "deep_sleep",
            "rem_sleep",
            "respiratory_rate",
            "activity_score",
          ],
          weekDays,
          30,
          2.0,
        );
        const topAnomalies = [...allWeekAnomalies]
          .sort((a, b) => Math.abs(b.z_score) - Math.abs(a.z_score))
          .slice(0, 3);

        // ---- Tags logged ----
        const weekTags = tags.filter((t) => inWeek(t.start_day));
        const tagsByType = new Map<string, number>();
        for (const t of weekTags) {
          const key = t.custom_name && t.custom_name.length > 0 ? t.custom_name : t.tag_type_code;
          tagsByType.set(key, (tagsByType.get(key) ?? 0) + 1);
        }
        const tagsLogged = Array.from(tagsByType.entries()).map(([name, count]) => ({
          name,
          count,
        }));

        const alcoholTagCount = weekTags.filter((t) => {
          const haystack = `${t.tag_type_code} ${t.custom_name ?? ""} ${t.comment ?? ""}`.toLowerCase();
          return haystack.includes("alcohol");
        }).length;

        // ---- Highlights and watch_outs ----
        const highlights: string[] = [];
        const watchOuts: string[] = [];

        if (hrvBlock.vs_baseline_hrv_pct !== null) {
          if (hrvBlock.vs_baseline_hrv_pct > 10) {
            highlights.push(
              `HRV averaged ${round1(hrvBlock.vs_baseline_hrv_pct)}% above baseline this week — strong recovery`,
            );
          } else if (hrvBlock.vs_baseline_hrv_pct < -10) {
            watchOuts.push(
              `HRV averaged ${round1(Math.abs(hrvBlock.vs_baseline_hrv_pct))}% below baseline — system showing strain`,
            );
          }
        }

        if (sleepBlock.avg_deep_sleep_minutes !== null && sleepBlock.avg_deep_sleep_minutes < 60) {
          watchOuts.push(
            `Deep sleep averaged ${sleepBlock.avg_deep_sleep_minutes} min, lower than recommended`,
          );
        }

        const roughNights = defined(weekSleepScores).filter((s) => s < 70).length;
        if (roughNights >= 3) {
          watchOuts.push(`Three or more rough nights this week (${roughNights} below score 70)`);
        }

        if (readinessSlope < -1) {
          watchOuts.push(`Readiness trending downward (${round1(readinessSlope)}/day)`);
        } else if (readinessSlope > 1) {
          highlights.push(`Readiness trending upward (+${round1(readinessSlope)}/day)`);
        }

        if (weekWorkouts.length > 5) {
          highlights.push(`High training volume (${weekWorkouts.length} workouts)`);
        }

        if (
          alcoholTagCount >= 3 &&
          hrvBlock.vs_baseline_hrv_pct !== null &&
          hrvBlock.vs_baseline_hrv_pct < 0
        ) {
          watchOuts.push(
            `${alcoholTagCount} alcohol days logged with reduced HRV (${round1(hrvBlock.vs_baseline_hrv_pct)}% vs baseline)`,
          );
        }

        if (
          sleepBlock.avg_sleep_score !== null &&
          sleepBlock.vs_baseline_score_pct !== null &&
          sleepBlock.vs_baseline_score_pct > 5
        ) {
          highlights.push(
            `Sleep score averaged ${sleepBlock.avg_sleep_score}, ${round1(sleepBlock.vs_baseline_score_pct)}% above baseline`,
          );
        }

        if (
          readinessBlock.avg_readiness !== null &&
          readinessBlock.vs_baseline_pct !== null &&
          readinessBlock.vs_baseline_pct > 5
        ) {
          highlights.push(
            `Readiness averaged ${readinessBlock.avg_readiness}, ${round1(readinessBlock.vs_baseline_pct)}% above baseline`,
          );
        }

        return textContent({
          week_start: weekStart,
          week_ending: weekEnd,
          baseline_window: { start: baselineStart, end: baselineEnd },
          sleep: sleepBlock,
          readiness: readinessBlock,
          hrv: hrvBlock,
          activity: activityBlock,
          anomalies: topAnomalies,
          tags_logged: tagsLogged,
          highlights,
          watch_outs: watchOuts,
        });
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
