import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailyReadiness } from "../oura/endpoints.js";
import { textContent, errorContent, todayInTz } from "./utils.js";
import { mean, stddev, linearSlope, interpretSlope } from "../oura/stats.js";

/** Add N days to YYYY-MM-DD. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function registerRecoveryForecastTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_recovery_forecast",
    "Forecasts a single day's readiness score using recent trend plus regression " +
      "toward a 30-day mean. Returns predicted_readiness with a confidence band " +
      "(±1 stddev of recent values, clamped 0-100), trend label, and basis string. " +
      "Defaults to predicting tomorrow.",
    {
      target_date: z
        .string()
        .optional()
        .describe("YYYY-MM-DD. Default: tomorrow (user's TZ)."),
      use_days: z
        .number()
        .int()
        .min(3)
        .max(30)
        .optional()
        .describe("Default 7. Recent history to base forecast on."),
    },
    async ({ target_date, use_days }) => {
      const target = target_date ?? shiftDate(todayInTz(), 1);
      const recentDays = use_days ?? 7;

      const dayBeforeTarget = shiftDate(target, -1);
      const recentStart = shiftDate(dayBeforeTarget, -(recentDays - 1));
      const longStart = shiftDate(dayBeforeTarget, -29);
      const fetchStart = longStart < recentStart ? longStart : recentStart;

      try {
        const readiness = await getDailyReadiness(
          client,
          { start_date: fetchStart, end_date: dayBeforeTarget },
          20,
        );

        // Sort by day ascending for slope computation
        const sorted = [...readiness].sort((a, b) => (a.day < b.day ? -1 : 1));
        const dayMap = new Map<string, number | null>();
        for (const r of sorted) dayMap.set(r.day, r.score);

        const recentVals: number[] = [];
        for (let i = recentDays - 1; i >= 0; i--) {
          const d = shiftDate(dayBeforeTarget, -i);
          const v = dayMap.get(d);
          if (v !== null && v !== undefined) recentVals.push(v);
        }

        const longVals: number[] = [];
        for (let i = 29; i >= 0; i--) {
          const d = shiftDate(dayBeforeTarget, -i);
          const v = dayMap.get(d);
          if (v !== null && v !== undefined) longVals.push(v);
        }

        if (recentVals.length < 5) {
          return textContent({
            predicted_readiness: null,
            error: "Insufficient recent data: need at least 5 days of readiness scores",
          });
        }

        const recentMean = mean(recentVals);
        const longMean = longVals.length > 0 ? mean(longVals) : recentMean;
        const slope = linearSlope(recentVals);
        const trend = interpretSlope(slope, 0.3);

        const projected = recentMean + slope;
        const blended = projected * 0.5 + longMean * 0.5;
        const predicted = Math.round(blended);

        const recentStd = stddev(recentVals, recentMean);
        const lo = clamp(Math.round(predicted - recentStd), 0, 100);
        const hi = clamp(Math.round(predicted + recentStd), 0, 100);

        const basis =
          `${recentVals.length}-day mean ${Math.round(recentMean)}, ` +
          `slope ${slope >= 0 ? "+" : ""}${(Math.round(slope * 10) / 10).toFixed(1)}/day, ` +
          `30-day mean ${Math.round(longMean)}`;

        return textContent({
          target_date: target,
          predicted_readiness: clamp(predicted, 0, 100),
          confidence_low: lo,
          confidence_high: hi,
          recent_trend: trend,
          basis,
        });
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}

