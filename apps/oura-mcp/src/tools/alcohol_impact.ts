import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import {
  getDailyReadiness,
  getEnhancedTags,
  getSleepPeriods,
} from "../oura/endpoints.js";
import { textContent, errorContent, todayInTz, daysAgoInTz } from "./utils.js";
import { defined, mean, stddev } from "../oura/stats.js";
import type { SleepPeriod, EnhancedTag } from "../oura/types.js";

/** Add N days to YYYY-MM-DD. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

/** Tag is alcohol-related if any of its identifier fields contains "alcohol". */
function tagMatchesAlcohol(tag: EnhancedTag, explicit?: string): boolean {
  if (explicit) {
    const target = explicit.toLowerCase();
    const fields = [tag.tag_type_code, tag.custom_name ?? "", tag.comment ?? ""];
    return fields.some((f) => f.toLowerCase() === target || f.toLowerCase().includes(target));
  }
  const haystack = `${tag.tag_type_code} ${tag.custom_name ?? ""} ${tag.comment ?? ""}`.toLowerCase();
  return haystack.includes("alcohol");
}

interface MetricStats {
  alcohol_mean: number | null;
  non_alcohol_mean: number | null;
  delta_pct: number | null;
}

function computeMetricStats(alcoholVals: number[], nonAlcoholVals: number[]): MetricStats {
  const a = defined(alcoholVals);
  const n = defined(nonAlcoholVals);
  const aMean = a.length > 0 ? mean(a) : null;
  const nMean = n.length > 0 ? mean(n) : null;
  let delta: number | null = null;
  if (aMean !== null && nMean !== null && nMean !== 0) {
    delta = ((aMean - nMean) / nMean) * 100;
  }
  return {
    alcohol_mean: aMean === null ? null : Math.round(aMean * 100) / 100,
    non_alcohol_mean: nMean === null ? null : Math.round(nMean * 100) / 100,
    delta_pct: delta === null ? null : Math.round(delta * 10) / 10,
  };
}

export function registerAlcoholImpactTool(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_alcohol_impact",
    "Compares biometrics (HRV, deep sleep, RHR, readiness, sleep latency) between " +
      "alcohol-tagged days and non-alcohol days. Also estimates how many days HRV " +
      "takes to recover after an alcohol day. Tag is auto-discovered by name match " +
      "unless alcohol_tag_name is provided.",
    {
      date_range: z
        .object({ start: z.string(), end: z.string() })
        .optional()
        .describe("Default last 90 days."),
      alcohol_tag_name: z
        .string()
        .optional()
        .describe(
          "Default: matches tags with 'alcohol' in tag_type_code, custom_name, or comment (case-insensitive).",
        ),
    },
    async ({ date_range, alcohol_tag_name }) => {
      const range = date_range ?? { start: daysAgoInTz(89), end: todayInTz() };

      try {
        const [tags, sleepPeriods, readiness] = await Promise.all([
          getEnhancedTags(client, { start_date: range.start, end_date: range.end }, 20),
          getSleepPeriods(client, { start_date: range.start, end_date: range.end }, 20),
          getDailyReadiness(client, { start_date: range.start, end_date: range.end }, 20),
        ]);

        // Discover/filter alcohol tags
        const alcoholTags = tags.filter((t) => tagMatchesAlcohol(t, alcohol_tag_name));
        if (alcoholTags.length === 0) {
          return textContent({
            error: alcohol_tag_name
              ? `No tag matched "${alcohol_tag_name}" in the date range.`
              : "No alcohol tag found. Specify alcohol_tag_name explicitly.",
          });
        }

        // Set of YYYY-MM-DD strings for alcohol days. A tag spanning days marks
        // the start_day; we don't try to infer a multi-day window from end_day.
        const alcoholDays = new Set<string>();
        for (const t of alcoholTags) alcoholDays.add(t.start_day);

        // Build per-day metric series from sleep periods
        const byDay = new Map<string, SleepPeriod[]>();
        for (const p of sleepPeriods) {
          const arr = byDay.get(p.day) ?? [];
          arr.push(p);
          byDay.set(p.day, arr);
        }
        const sleepByDay = new Map<string, SleepPeriod>();
        for (const [day, periods] of byDay) {
          const main = pickMainSleep(periods);
          if (main) sleepByDay.set(day, main);
        }
        const readinessByDay = new Map<string, number | null>();
        for (const r of readiness) readinessByDay.set(r.day, r.score);

        // Iterate over the full date range. A "day in range" only counts if we
        // have at least sleep data for it (otherwise no metrics anyway).
        const allDays: string[] = [];
        for (let d = range.start; d <= range.end; d = shiftDate(d, 1)) allDays.push(d);

        const metricBuckets = {
          hrv: { alcohol: [] as number[], non: [] as number[] },
          deep_sleep: { alcohol: [] as number[], non: [] as number[] },
          rhr: { alcohol: [] as number[], non: [] as number[] },
          readiness: { alcohol: [] as number[], non: [] as number[] },
          sleep_latency: { alcohol: [] as number[], non: [] as number[] },
        };

        let nAlcoholDays = 0;
        let nNonAlcoholDays = 0;
        for (const day of allDays) {
          const main = sleepByDay.get(day);
          if (!main) continue;
          const isAlc = alcoholDays.has(day);
          if (isAlc) nAlcoholDays++;
          else nNonAlcoholDays++;
          const bucket = isAlc ? "alcohol" : "non";

          if (main.average_hrv !== null) metricBuckets.hrv[bucket].push(main.average_hrv);
          if (main.deep_sleep_duration !== null)
            metricBuckets.deep_sleep[bucket].push(main.deep_sleep_duration);
          if (main.lowest_heart_rate !== null)
            metricBuckets.rhr[bucket].push(main.lowest_heart_rate);
          if (main.latency !== null) metricBuckets.sleep_latency[bucket].push(main.latency);

          const rScore = readinessByDay.get(day);
          if (rScore !== null && rScore !== undefined)
            metricBuckets.readiness[bucket].push(rScore);
        }

        const impact = {
          hrv: computeMetricStats(metricBuckets.hrv.alcohol, metricBuckets.hrv.non),
          deep_sleep: computeMetricStats(
            metricBuckets.deep_sleep.alcohol,
            metricBuckets.deep_sleep.non,
          ),
          rhr: computeMetricStats(metricBuckets.rhr.alcohol, metricBuckets.rhr.non),
          readiness: computeMetricStats(
            metricBuckets.readiness.alcohol,
            metricBuckets.readiness.non,
          ),
          sleep_latency: computeMetricStats(
            metricBuckets.sleep_latency.alcohol,
            metricBuckets.sleep_latency.non,
          ),
        };

        // Recovery pattern: per-offset (1, 2, 3 days post-alcohol) mean HRV.
        // First offset where mean HRV crosses (non_alcohol_mean - 1*stddev)
        // signals "recovered". If never, return ">3".
        const nonAlcHrvVals = defined(metricBuckets.hrv.non);
        const nonAlcHrvMean = nonAlcHrvVals.length > 0 ? mean(nonAlcHrvVals) : null;
        const nonAlcHrvStd =
          nonAlcHrvVals.length >= 2 ? stddev(nonAlcHrvVals, nonAlcHrvMean ?? 0) : 0;
        const recoveryThreshold =
          nonAlcHrvMean !== null ? nonAlcHrvMean - nonAlcHrvStd : null;

        let hrvRecoveryDays: number | string = ">3";
        if (recoveryThreshold !== null) {
          for (let offset = 1; offset <= 3; offset++) {
            const offsetVals: number[] = [];
            for (const day of alcoholDays) {
              const future = shiftDate(day, offset);
              const futureSleep = sleepByDay.get(future);
              if (futureSleep && futureSleep.average_hrv !== null) {
                offsetVals.push(futureSleep.average_hrv);
              }
            }
            if (offsetVals.length === 0) continue;
            const offsetMean = mean(offsetVals);
            if (offsetMean >= recoveryThreshold) {
              hrvRecoveryDays = offset;
              break;
            }
          }
        }

        const result: Record<string, unknown> = {
          n_alcohol_days: nAlcoholDays,
          n_non_alcohol_days: nNonAlcoholDays,
          date_range: range,
          impact,
          recovery_pattern: {
            hrv_recovery_days: hrvRecoveryDays,
          },
        };

        if (nAlcoholDays < 3) {
          result.note = `Sample size very small (n=${nAlcoholDays}); results not reliable`;
        }

        return textContent(result);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
