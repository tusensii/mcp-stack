import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailyReadiness, getSleepPeriods } from "../oura/endpoints.js";
import type { SleepPeriod } from "../oura/types.js";
import { addDays, eachDay } from "../oura/metrics.js";
import { defined, mean, stddev, zScore } from "../oura/stats.js";
import {
  textContent,
  errorContent,
  todayInTz,
  daysAgoInTz,
  validateDateRange,
} from "./utils.js";

const BASELINE_WINDOW_DAYS = 28;
const MIN_BASELINE_SAMPLES = 7;

type SignalName = "body_temperature" | "respiratory_rate" | "rhr" | "hrv";

interface DayMetrics {
  body_temperature: number | null;
  respiratory_rate: number | null;
  rhr: number | null;
  hrv: number | null;
}

interface OnsetDay {
  date: string;
  signals: SignalName[];
  z_scores: Partial<Record<SignalName, number>>;
  confidence: number;
}

/**
 * For each day, take the longest non-deleted sleep period as canonical.
 * Mirrors the convention in oura/metrics.ts (longest period wins; we don't
 * fall back to the next-longest when the chosen period's value is null —
 * that's a sleep-derived metric concept that's not the right call when we
 * also need RHR and HRV from the same period for consistency).
 */
function mainSleepPerDay(periods: ReadonlyArray<SleepPeriod>): Map<string, SleepPeriod> {
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

function buildDayMetrics(
  days: string[],
  readiness: ReadonlyArray<{ day: string; temperature_deviation: number | null }>,
  sleepMain: Map<string, SleepPeriod>,
): Map<string, DayMetrics> {
  const tempByDay = new Map<string, number | null>();
  for (const r of readiness) tempByDay.set(r.day, r.temperature_deviation);

  const out = new Map<string, DayMetrics>();
  for (const d of days) {
    const sleep = sleepMain.get(d);
    out.set(d, {
      body_temperature: tempByDay.get(d) ?? null,
      respiratory_rate: sleep?.average_breath ?? null,
      rhr: sleep?.lowest_heart_rate ?? null,
      hrv: sleep?.average_hrv ?? null,
    });
  }
  return out;
}

/**
 * Compute z-score for `date` against the previous BASELINE_WINDOW_DAYS days.
 * Returns null when fewer than MIN_BASELINE_SAMPLES valid baseline points
 * exist or the value on the candidate date is missing.
 */
function rollingZ(
  metricsByDay: Map<string, DayMetrics>,
  date: string,
  field: keyof DayMetrics,
): number | null {
  const today = metricsByDay.get(date);
  const value = today?.[field];
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  const baselineDays = eachDay(addDays(date, -BASELINE_WINDOW_DAYS), addDays(date, -1));
  const raw: (number | null | undefined)[] = baselineDays.map(
    (d) => metricsByDay.get(d)?.[field] ?? null,
  );
  const baseline = defined(raw);
  if (baseline.length < MIN_BASELINE_SAMPLES) return null;
  const mu = mean(baseline);
  const sigma = stddev(baseline, mu);
  if (sigma === 0) return null;
  return zScore(value, mu, sigma);
}

export function registerSymptomOnsetDetectTool(
  server: McpServer,
  client: OuraClient,
): void {
  server.tool(
    "oura_symptom_onset_detect",
    "Scans a date window for likely illness-onset days: clusters of biometric " +
      "anomalies (elevated body temperature, elevated respiratory rate, elevated " +
      "RHR, depressed HRV) on the same day, all measured against a 28-day rolling " +
      "baseline ending the day before each candidate (so the candidate's own value " +
      "does not contaminate its baseline). " +
      "Default thresholds: temp z > +1.5, resp z > +1.0, RHR z > +1.0, HRV z < -1.0. " +
      "A day is flagged when >= min_signals (default 3) of the 4 thresholds trip. " +
      "Returns an empty array when no onset days are detected (not an error).",
    {
      start_date: z
        .string()
        .optional()
        .describe(
          "Start of scan window YYYY-MM-DD. Default: 29 days ago (30-day window).",
        ),
      end_date: z
        .string()
        .optional()
        .describe("End of scan window YYYY-MM-DD. Default: today."),
      temp_z_threshold: z
        .number()
        .optional()
        .describe("Default +1.5. Body-temp-deviation z above this counts as a signal."),
      resp_z_threshold: z
        .number()
        .optional()
        .describe("Default +1.0. Respiratory-rate z above this counts as a signal."),
      rhr_z_threshold: z
        .number()
        .optional()
        .describe("Default +1.0. RHR z above this counts as a signal."),
      hrv_z_threshold: z
        .number()
        .optional()
        .describe("Default -1.0. HRV z below this counts as a signal (negative number)."),
      min_signals: z
        .number()
        .int()
        .min(1)
        .max(4)
        .optional()
        .describe("Default 3. Minimum number of tripped signals to flag a day."),
    },
    async ({
      start_date,
      end_date,
      temp_z_threshold,
      resp_z_threshold,
      rhr_z_threshold,
      hrv_z_threshold,
      min_signals,
    }) => {
      const scanEnd = end_date ?? todayInTz();
      const scanStart = start_date ?? daysAgoInTz(29);
      const err = validateDateRange(scanStart, scanEnd);
      if (err) return errorContent(err);

      const tempT = temp_z_threshold ?? 1.5;
      const respT = resp_z_threshold ?? 1.0;
      const rhrT = rhr_z_threshold ?? 1.0;
      const hrvT = hrv_z_threshold ?? -1.0;
      const minSignals = min_signals ?? 3;

      // Fetch enough history to baseline the earliest scan day.
      const fetchStart = addDays(scanStart, -BASELINE_WINDOW_DAYS);
      const range = { start_date: fetchStart, end_date: scanEnd };

      try {
        const [readiness, sleepPeriods] = await Promise.all([
          getDailyReadiness(client, range),
          getSleepPeriods(client, range),
        ]);
        const sleepMain = mainSleepPerDay(sleepPeriods);
        const allDays = eachDay(fetchStart, scanEnd);
        const metricsByDay = buildDayMetrics(allDays, readiness, sleepMain);

        const onsets: OnsetDay[] = [];
        for (const date of eachDay(scanStart, scanEnd)) {
          const tempZ = rollingZ(metricsByDay, date, "body_temperature");
          const respZ = rollingZ(metricsByDay, date, "respiratory_rate");
          const rhrZ = rollingZ(metricsByDay, date, "rhr");
          const hrvZ = rollingZ(metricsByDay, date, "hrv");

          const signals: SignalName[] = [];
          const z_scores: Partial<Record<SignalName, number>> = {};
          if (tempZ !== null) {
            z_scores.body_temperature = Math.round(tempZ * 100) / 100;
            if (tempZ > tempT) signals.push("body_temperature");
          }
          if (respZ !== null) {
            z_scores.respiratory_rate = Math.round(respZ * 100) / 100;
            if (respZ > respT) signals.push("respiratory_rate");
          }
          if (rhrZ !== null) {
            z_scores.rhr = Math.round(rhrZ * 100) / 100;
            if (rhrZ > rhrT) signals.push("rhr");
          }
          if (hrvZ !== null) {
            z_scores.hrv = Math.round(hrvZ * 100) / 100;
            if (hrvZ < hrvT) signals.push("hrv");
          }

          if (signals.length >= minSignals) {
            onsets.push({
              date,
              signals,
              z_scores,
              confidence: signals.length / 4,
            });
          }
        }

        return textContent({
          scan_window: { start: scanStart, end: scanEnd },
          baseline_window_days: BASELINE_WINDOW_DAYS,
          thresholds: {
            temp_z: tempT,
            resp_z: respT,
            rhr_z: rhrT,
            hrv_z: hrvT,
            min_signals: minSignals,
          },
          onsets,
        });
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
