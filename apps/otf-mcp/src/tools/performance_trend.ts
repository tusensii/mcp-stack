import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthEnv } from "../otf/auth.js";
import { getIdToken } from "../otf/auth.js";
import { API_IO, OtfApiError } from "../otf/client.js";
import { textContent, errorContent } from "./utils.js";
import { getMemberInfo } from "./member_info.js";

// ─── Inputs ───────────────────────────────────────────────────────────────────

const METRICS = [
  "splat_points",
  "orange_minutes",
  "red_minutes",
  "calories",
  "avg_hr",
  "max_hr",
] as const;
type Metric = (typeof METRICS)[number];

const GRANULARITIES = ["session", "weekly", "monthly"] as const;
type Granularity = (typeof GRANULARITIES)[number];

// ─── Performance summary fetch ───────────────────────────────────────────────

interface PerfSummary {
  date: string; // YYYY-MM-DD (UTC, OTF returns class_date with no TZ; treat as date)
  splat_points: number | null;
  orange_minutes: number | null;
  red_minutes: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
}

/**
 * Pull a numeric value from a record under the first key that has a number,
 * returning null when absent. Defensive against shape drift in the OTF API.
 */
function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Convert a "zone time" field that may be in seconds OR minutes to minutes.
 * Heuristic: values larger than 90 are almost certainly seconds (a 60-minute
 * class can yield at most ~60 minutes per zone).
 */
function toMinutes(value: number | null): number | null {
  if (value == null) return null;
  return value > 90 ? value / 60 : value;
}

/**
 * One-off fetch for /v1/performance-summaries with the extra "koji-*" headers
 * required by this endpoint. Mirrors the standard otfGet flow but adds the
 * member-id and member-email headers without changing the shared client.
 */
async function fetchPerformanceSummaries(
  env: AuthEnv,
  memberUuid: string,
  memberEmail: string,
  limit: number,
): Promise<unknown[]> {
  const { idToken } = await getIdToken(env);
  const url = new URL("/v1/performance-summaries", API_IO);
  url.searchParams.set("limit", String(limit));

  const resp = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
      Accept: "application/json",
      "User-Agent": "okhttp/4.12.0",
      "koji-member-id": memberUuid,
      "koji-member-email": memberEmail,
    },
  });

  if (!resp.ok) {
    let body: unknown;
    try {
      body = await resp.json();
    } catch {
      body = {};
    }
    const b = body as Record<string, unknown>;
    const msg = (b["message"] ?? b["Message"] ?? resp.statusText) as string;
    throw new OtfApiError(resp.status, `OTF API error ${resp.status}: ${msg}`);
  }

  if (resp.status === 204) return [];
  const json = (await resp.json()) as unknown;

  // Tolerate either {items:[...]} or a bare array
  if (Array.isArray(json)) return json;
  const obj = json as Record<string, unknown>;
  if (Array.isArray(obj["items"])) return obj["items"] as unknown[];
  if (Array.isArray(obj["data"])) return obj["data"] as unknown[];
  return [];
}

// Module-scope flag so we log unknown-shape warnings once per isolate.
let warnedUnknownShape = false;

function normalizeSummary(raw: unknown): PerfSummary | null {
  if (!raw || typeof raw !== "object") {
    if (!warnedUnknownShape) {
      // eslint-disable-next-line no-console
      console.warn("otf_performance_trend: skipping non-object summary entry");
      warnedUnknownShape = true;
    }
    return null;
  }
  const r = raw as Record<string, unknown>;

  // class_date may be "YYYY-MM-DD" or a full ISO; slice first 10 chars.
  const dateRaw = (r["class_date"] ?? r["date"] ?? r["classDate"]) as unknown;
  const dateStr = typeof dateRaw === "string" && dateRaw.length >= 10 ? dateRaw.slice(0, 10) : null;
  if (!dateStr) return null;

  // Zones: prefer explicit minutes fields; fall back to seconds with conversion.
  const orangeMin =
    pickNumber(r, ["orange_zone_minutes", "orangeZoneMinutes"]) ??
    toMinutes(pickNumber(r, ["orange_zone_time_seconds", "orangeZoneTimeSeconds"]));
  const redMin =
    pickNumber(r, ["red_zone_minutes", "redZoneMinutes"]) ??
    toMinutes(pickNumber(r, ["red_zone_time_seconds", "redZoneTimeSeconds"]));

  return {
    date: dateStr,
    splat_points: pickNumber(r, ["splat_points", "splatPoints", "total_splat_points"]),
    orange_minutes: orangeMin,
    red_minutes: redMin,
    calories: pickNumber(r, ["calories_burned", "caloriesBurned", "total_calories", "calories"]),
    avg_hr: pickNumber(r, ["avg_hr", "average_hr", "averageHr", "avgHr"]),
    max_hr: pickNumber(r, ["peak_hr", "max_hr", "maxHr", "peakHr"]),
  };
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

interface SeriesPoint {
  period_start: string;
  period_end: string;
  splat_points_avg: number;
  splat_points_total: number;
  orange_minutes_avg: number;
  orange_minutes_total: number;
  red_minutes_avg: number;
  red_minutes_total: number;
  calories_avg: number;
  calories_total: number;
  avg_hr: number;
  max_hr: number;
  sessions: number;
}

/** Mean of finite values; 0 for empty. */
function mean(xs: (number | null)[]): number {
  const finite = xs.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (finite.length === 0) return 0;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

/** Sum of finite values; 0 for empty. */
function total(xs: (number | null)[]): number {
  let s = 0;
  for (const v of xs) if (typeof v === "number" && Number.isFinite(v)) s += v;
  return s;
}

/** ISO week start (Monday) for a date in YYYY-MM-DD form, returns YYYY-MM-DD. */
function isoWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  // getUTCDay(): Sun=0, Mon=1, ..., Sat=6
  const day = d.getUTCDay();
  const offset = (day + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function isoWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

function monthEnd(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map((s) => parseInt(s, 10));
  // Day 0 of next month is the last day of current month
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function periodFor(
  granularity: Granularity,
  dateStr: string,
): { key: string; start: string; end: string } {
  if (granularity === "session") {
    return { key: dateStr, start: dateStr, end: dateStr };
  }
  if (granularity === "weekly") {
    const start = isoWeekStart(dateStr);
    return { key: start, start, end: isoWeekEnd(start) };
  }
  // monthly
  const key = monthKey(dateStr);
  return { key, start: key + "-01", end: monthEnd(key) };
}

function aggregate(
  summaries: PerfSummary[],
  granularity: Granularity,
): SeriesPoint[] {
  const groups = new Map<string, { start: string; end: string; rows: PerfSummary[] }>();
  for (const s of summaries) {
    const p = periodFor(granularity, s.date);
    const existing = groups.get(p.key);
    if (existing) existing.rows.push(s);
    else groups.set(p.key, { start: p.start, end: p.end, rows: [s] });
  }

  const points: SeriesPoint[] = [];
  for (const [, g] of groups) {
    const splat = g.rows.map((r) => r.splat_points);
    const orange = g.rows.map((r) => r.orange_minutes);
    const red = g.rows.map((r) => r.red_minutes);
    const cals = g.rows.map((r) => r.calories);
    const avgHr = g.rows.map((r) => r.avg_hr);
    const maxHr = g.rows.map((r) => r.max_hr);

    points.push({
      period_start: g.start,
      period_end: g.end,
      splat_points_avg: mean(splat),
      splat_points_total: total(splat),
      orange_minutes_avg: mean(orange),
      orange_minutes_total: total(orange),
      red_minutes_avg: mean(red),
      red_minutes_total: total(red),
      calories_avg: mean(cals),
      calories_total: total(cals),
      avg_hr: mean(avgHr),
      max_hr: mean(maxHr),
      sessions: g.rows.length,
    });
  }

  points.sort((a, b) => a.period_start.localeCompare(b.period_start));
  return points;
}

// ─── Trend / slope ────────────────────────────────────────────────────────────

function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (ys[i] - my);
    den += (i - mx) * (i - mx);
  }
  return den === 0 ? 0 : num / den;
}

type Direction = "improving" | "stable" | "declining";

function direction(values: number[]): { slope: number; direction: Direction } {
  const s = slope(values);
  const m = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  // Guard near-zero means: noisy slope on tiny values shouldn't flip direction.
  if (Math.abs(m) <= 0.001) return { slope: s, direction: "stable" };
  const threshold = 0.05 * Math.abs(m);
  if (s > threshold) return { slope: s, direction: "improving" };
  if (s < -threshold) return { slope: s, direction: "declining" };
  return { slope: s, direction: "stable" };
}

// Map our public metric names to the per-period series field used for trend math.
// HR metrics use averages; volume metrics use averages of per-session values.
const METRIC_TO_SERIES_FIELD: Record<Metric, keyof SeriesPoint> = {
  splat_points: "splat_points_avg",
  orange_minutes: "orange_minutes_avg",
  red_minutes: "red_minutes_avg",
  calories: "calories_avg",
  avg_hr: "avg_hr",
  max_hr: "max_hr",
};

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerPerformanceTrendTool(server: McpServer, env: AuthEnv): void {
  server.tool(
    "otf_performance_trend",
    "Trend analysis of OTF workout performance over time: splat points, " +
    "orange/red minutes, calories, and heart rate. Aggregates per session, " +
    "week, or month and reports a per-metric direction (improving/stable/declining).",
    {
      date_range: z
        .object({
          start: z.string(),
          end: z.string(),
        })
        .optional()
        .describe("YYYY-MM-DD bounds. Default: last 90 days."),
      metrics: z
        .array(z.enum(METRICS))
        .optional()
        .describe("Metrics to compute trend on. Default: all."),
      granularity: z
        .enum(GRANULARITIES)
        .optional()
        .describe("session, weekly (ISO week, Mon-start), or monthly. Default weekly."),
    },
    async ({ date_range, metrics, granularity }) => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const defaultStart = (() => {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - 90);
          return d.toISOString().slice(0, 10);
        })();
        const startStr = date_range?.start ?? defaultStart;
        const endStr = date_range?.end ?? today;
        const gran: Granularity = granularity ?? "weekly";
        const wantedMetrics: Metric[] = metrics && metrics.length > 0 ? metrics : [...METRICS];

        // Resolve member identity for the koji-* headers.
        const [{ memberUuid }, info] = await Promise.all([
          getIdToken(env),
          getMemberInfo(env),
        ]);
        if (!info.email) {
          return errorContent(
            "OTF performance trend requires a member email but none is available on the profile.",
          );
        }

        // Fetch summaries (one shot, generous limit; pagination not exposed)
        const rawList = await fetchPerformanceSummaries(env, memberUuid, info.email, 200);

        const emptyResponse = {
          date_range: { start: startStr, end: endStr },
          granularity: gran,
          series: [] as SeriesPoint[],
          trend: {} as Record<string, { slope: number; direction: Direction }>,
          note:
            "No performance data available — older OTF plans may not retain per-session metrics",
        };

        if (rawList.length === 0) return textContent(emptyResponse);

        const normalized: PerfSummary[] = [];
        for (const raw of rawList) {
          const n = normalizeSummary(raw);
          if (n) normalized.push(n);
        }

        // Date filter
        const inRange = normalized.filter((s) => s.date >= startStr && s.date <= endStr);

        if (inRange.length === 0) return textContent(emptyResponse);

        const series = aggregate(inRange, gran);

        // Trend per requested metric
        const trend: Record<string, { slope: number; direction: Direction }> = {};
        for (const m of wantedMetrics) {
          const field = METRIC_TO_SERIES_FIELD[m];
          const values = series.map((p) => p[field] as number);
          trend[m] = direction(values);
        }

        return textContent({
          date_range: { start: startStr, end: endStr },
          granularity: gran,
          series,
          trend,
        });
      } catch (e) {
        if (e instanceof OtfApiError) return errorContent(e.message);
        if (e instanceof Error) return errorContent(e.message);
        throw e;
      }
    },
  );
}
