import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailyReadiness } from "../oura/endpoints.js";
import { addDays, eachDay, fetchMetricByDay } from "../oura/metrics.js";
import { mean, stddev, zScore } from "../oura/stats.js";
import {
  textContent,
  errorContent,
  todayInTz,
  daysAgoInTz,
  validateDateRange,
} from "./utils.js";

const BASELINE_WINDOW = 28;
const MIN_BASELINE_SAMPLES = 7;

interface OnsetDay {
  date: string;
  signals: string[];
  z_scores: {
    body_temperature_deviation: number | null;
    respiratory_rate: number | null;
    rhr: number | null;
    hrv: number | null;
  };
  confidence: number;
}

function zForDay(
  series: Map<string, number | null>,
  date: string,
): number | null {
  const value = series.get(date);
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  // Baseline = 28 days ending the day BEFORE `date`.
  const start = addDays(date, -BASELINE_WINDOW);
  const end = addDays(date, -1);
  const vals: number[] = [];
  for (const d of eachDay(start, end)) {
    const v = series.get(d);
    if (v !== null && v !== undefined && Number.isFinite(v)) vals.push(v);
  }
  if (vals.length < MIN_BASELINE_SAMPLES) return null;
  const mu = mean(vals);
  const sigma = stddev(vals, mu);
  if (sigma === 0) return null;
  return zScore(value, mu, sigma);
}

export function registerSymptomOnsetDetectTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_symptom_onset_detect",
    "Scans a date window for clusters of biometric anomalies indicative of illness " +
      "onset. For each day, computes z-scores for body temperature deviation, respiratory " +
      "rate, resting heart rate, and HRV using a 28-day rolling baseline ending the day " +
      "BEFORE the candidate date (so the anomaly itself does not contaminate the baseline). " +
      "Default thresholds: temp z > +1.5, resp z > +1.0, RHR z > +1.0, HRV z < -1.0. " +
      "A day is flagged when at least `min_signals` (default 3) of the four signals trip. " +
      "Returns an array of { date, signals, z_scores, confidence } where " +
      "confidence = signals_count / 4. Returns an empty array when no onset days detected. " +
      "Requires at least 7 valid baseline samples per metric; days lacking sufficient " +
      "baseline data report null z-scores and contribute no signals. " +
      "Dates: each onset \"date\" indexes a mix of conventions — body temperature deviation uses the morning-of-report date (from daily_readiness), while respiratory rate, RHR, and HRV use the sleep-period-start date (from /sleep). For a given physiological night the same date string may refer to slightly different calendar days across signals; treat the flagged date as the night being scrutinized rather than a precise event timestamp.",
    {
      start_date: z
        .string()
        .optional()
        .describe("Start of scan window YYYY-MM-DD. Defaults to 30 days ago."),
      end_date: z
        .string()
        .optional()
        .describe("End of scan window YYYY-MM-DD. Defaults to today."),
      temp_z_threshold: z.number().optional().describe("Default +1.5. Trips when z > threshold."),
      resp_z_threshold: z.number().optional().describe("Default +1.0. Trips when z > threshold."),
      rhr_z_threshold: z.number().optional().describe("Default +1.0. Trips when z > threshold."),
      hrv_z_threshold: z
        .number()
        .optional()
        .describe("Default -1.0. Trips when z < threshold (HRV drop is the illness signal)."),
      min_signals: z
        .number()
        .int()
        .min(1)
        .max(4)
        .optional()
        .describe("Minimum tripped signals to flag a day. Default 3."),
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
      const end = end_date ?? todayInTz();
      const start = start_date ?? daysAgoInTz(30);
      const err = validateDateRange(start, end);
      if (err) return errorContent(err);

      const tempT = temp_z_threshold ?? 1.5;
      const respT = resp_z_threshold ?? 1.0;
      const rhrT = rhr_z_threshold ?? 1.0;
      const hrvT = hrv_z_threshold ?? -1.0;
      const minSig = min_signals ?? 3;

      // Need to fetch BASELINE_WINDOW extra days before `start` so the earliest
      // scan dates have access to their baseline.
      const fetchStart = addDays(start, -BASELINE_WINDOW);
      const fetchEnd = end;

      try {
        const [readiness, respSeries, rhrSeries, hrvSeries] = await Promise.all([
          getDailyReadiness(client, { start_date: fetchStart, end_date: fetchEnd }),
          fetchMetricByDay(client, "respiratory_rate", fetchStart, fetchEnd),
          fetchMetricByDay(client, "rhr", fetchStart, fetchEnd),
          fetchMetricByDay(client, "hrv", fetchStart, fetchEnd),
        ]);

        // Build temperature-deviation series from daily_readiness.
        const tempSeries = new Map<string, number | null>();
        for (const d of eachDay(fetchStart, fetchEnd)) tempSeries.set(d, null);
        for (const r of readiness) {
          tempSeries.set(r.day, r.temperature_deviation);
        }

        const scanDates = eachDay(start, end);
        const onsets: OnsetDay[] = [];

        for (const date of scanDates) {
          const tempZ = zForDay(tempSeries, date);
          const respZ = zForDay(respSeries, date);
          const rhrZ = zForDay(rhrSeries, date);
          const hrvZ = zForDay(hrvSeries, date);

          const signals: string[] = [];
          if (tempZ !== null && tempZ > tempT) signals.push("body_temperature_deviation");
          if (respZ !== null && respZ > respT) signals.push("respiratory_rate");
          if (rhrZ !== null && rhrZ > rhrT) signals.push("rhr");
          if (hrvZ !== null && hrvZ < hrvT) signals.push("hrv");

          if (signals.length >= minSig) {
            const round2 = (x: number | null): number | null =>
              x === null ? null : Math.round(x * 100) / 100;
            onsets.push({
              date,
              signals,
              z_scores: {
                body_temperature_deviation: round2(tempZ),
                respiratory_rate: round2(respZ),
                rhr: round2(rhrZ),
                hrv: round2(hrvZ),
              },
              confidence: Math.round((signals.length / 4) * 100) / 100,
            });
          }
        }

        return textContent({
          date_range: { start, end },
          baseline_window_days: BASELINE_WINDOW,
          thresholds: {
            temp_z: tempT,
            resp_z: respT,
            rhr_z: rhrT,
            hrv_z: hrvT,
            min_signals: minSig,
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
