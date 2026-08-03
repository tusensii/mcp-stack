/**
 * USGS NWIS water clients for river-crossing assessment:
 *  - Instantaneous Values (IV): current + 7-day discharge/gage height.
 *  - Daily Statistics: historical percentiles to contextualize flow
 *    ("85th percentile for this date" beats raw cfs).
 *
 * Both keyless. NWIS is migrating to api.waterdata.usgs.gov; the legacy
 * services below remain the widely used stable surface (verified live
 * 2026-08-02) — revisit when USGS announces shutdown dates.
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { userAgent } from "../tools/utils.js";

const IV_URL = "https://waterservices.usgs.gov/nwis/iv/";
const STAT_URL = "https://waterservices.usgs.gov/nwis/stat/";

export type FlowContext = "low" | "normal" | "elevated" | "high" | "unknown";

export interface GaugeSeriesPoint {
  time_iso: string;
  discharge_cfs: number | null;
}

export interface GaugeData {
  site_id: string;
  site_name: string;
  lat: number | null;
  lon: number | null;
  discharge_cfs: number | null;
  gage_height_ft: number | null;
  reading_time: string | null;
  /** 7-day discharge series, downsampled to ≤100 points (chart-ready). */
  series: GaugeSeriesPoint[];
}

function client(env: Env) {
  return createFetchClient({
    userAgent: userAgent(env.CONTACT),
    defaultHeaders: { Accept: "application/json" },
    timeoutMs: 20_000,
    retries: 1,
  });
}

interface IvTimeSeries {
  sourceInfo?: {
    siteName?: string;
    siteCode?: Array<{ value?: string }>;
    geoLocation?: { geogLocation?: { latitude?: number; longitude?: number } };
  };
  variable?: { variableCode?: Array<{ value?: string }> };
  values?: Array<{ value?: Array<{ value?: string; dateTime?: string }> }>;
}

interface IvResponse {
  value?: { timeSeries?: IvTimeSeries[] };
}

function parseNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number.parseFloat(v);
  // NWIS uses large negative sentinels (-999999) for missing/ice-affected.
  return Number.isFinite(n) && n > -99999 ? n : null;
}

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(arr[Math.round((i * (arr.length - 1)) / (max - 1))]!);
  }
  return out;
}

/** Fetch current values + 7-day discharge series for up to ~20 sites. */
export async function getGauges(env: Env, siteIds: string[]): Promise<GaugeData[]> {
  if (siteIds.length === 0) return [];
  const sites = [...siteIds].sort().join(",");
  const key = `usgs:iv:${sites}`;
  return cached(env, key, TTL.RIDB_AVAIL, async () => {
    const url = `${IV_URL}?format=json&sites=${encodeURIComponent(sites)}&parameterCd=00060,00065&period=P7D&siteStatus=active`;
    const res = await client(env).json<IvResponse>(url);
    const bySite = new Map<string, GaugeData>();
    for (const ts of res.value?.timeSeries ?? []) {
      const siteId = ts.sourceInfo?.siteCode?.[0]?.value;
      const param = ts.variable?.variableCode?.[0]?.value;
      if (!siteId || !param) continue;
      let g = bySite.get(siteId);
      if (!g) {
        g = {
          site_id: siteId,
          site_name: ts.sourceInfo?.siteName ?? siteId,
          lat: ts.sourceInfo?.geoLocation?.geogLocation?.latitude ?? null,
          lon: ts.sourceInfo?.geoLocation?.geogLocation?.longitude ?? null,
          discharge_cfs: null,
          gage_height_ft: null,
          reading_time: null,
          series: [],
        };
        bySite.set(siteId, g);
      }
      const values = ts.values?.[0]?.value ?? [];
      const latest = values[values.length - 1];
      if (param === "00060") {
        g.discharge_cfs = parseNum(latest?.value);
        g.reading_time = latest?.dateTime ?? g.reading_time;
        g.series = downsample(values, 100).map((v) => ({
          time_iso: v.dateTime ?? "",
          discharge_cfs: parseNum(v.value),
        }));
      } else if (param === "00065") {
        g.gage_height_ft = parseNum(latest?.value);
        g.reading_time = g.reading_time ?? latest?.dateTime ?? null;
      }
    }
    return [...bySite.values()];
  });
}

export interface DiscoveredGauge {
  site_id: string;
  site_name: string;
  lat: number | null;
  lon: number | null;
  discharge_cfs: number | null;
}

/** Discover active discharge gauges inside a bbox [minLon,minLat,maxLon,maxLat]. */
export async function discoverGauges(
  env: Env,
  bbox: [number, number, number, number],
): Promise<DiscoveredGauge[]> {
  // NWIS caps bbox extents; round to 3 decimals per API requirements.
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const bb = `${r3(bbox[0])},${r3(bbox[1])},${r3(bbox[2])},${r3(bbox[3])}`;
  const key = `usgs:discover:${bb}`;
  return cached(env, key, TTL.USFS_ALERTS, async () => {
    const url = `${IV_URL}?format=json&bBox=${bb}&parameterCd=00060&period=P1D&siteStatus=active`;
    const res = await client(env).json<IvResponse>(url);
    const seen = new Set<string>();
    const out: DiscoveredGauge[] = [];
    for (const ts of res.value?.timeSeries ?? []) {
      const siteId = ts.sourceInfo?.siteCode?.[0]?.value;
      if (!siteId || seen.has(siteId)) continue;
      seen.add(siteId);
      const values = ts.values?.[0]?.value ?? [];
      out.push({
        site_id: siteId,
        site_name: ts.sourceInfo?.siteName ?? siteId,
        lat: ts.sourceInfo?.geoLocation?.geogLocation?.latitude ?? null,
        lon: ts.sourceInfo?.geoLocation?.geogLocation?.longitude ?? null,
        discharge_cfs: parseNum(values[values.length - 1]?.value),
      });
    }
    return out;
  });
}

export interface DailyStat {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  mean: number | null;
}

/**
 * Daily discharge statistics for a site, keyed "M-D" (no zero padding —
 * matches NWIS month_nu/day_nu columns). RDB (tab-separated) format.
 */
export async function getDailyStats(env: Env, siteId: string): Promise<Map<string, DailyStat>> {
  const key = `usgs:stat:${siteId}`;
  const obj = await cached(env, key, TTL.RIDB_META, async () => {
    const url = `${STAT_URL}?format=rdb&sites=${encodeURIComponent(siteId)}&statReportType=daily&statTypeCd=all&parameterCd=00060`;
    const res = await client(env).fetch(url);
    if (!res.ok) throw new Error(`usgs_stat_http_${res.status}`);
    const text = await res.text();
    const lines = text.split("\n").filter((l) => l && !l.startsWith("#"));
    const header = lines[0]?.split("\t") ?? [];
    const col = (name: string) => header.indexOf(name);
    const [iMonth, iDay, iMean, iP25, iP50, iP75, iP90] = [
      col("month_nu"),
      col("day_nu"),
      col("mean_va"),
      col("p25_va"),
      col("p50_va"),
      col("p75_va"),
      col("p90_va"),
    ];
    const out: Record<string, DailyStat> = {};
    // Skip header + the RDB format row ("5s 15s ..."), then data rows.
    for (const line of lines.slice(2)) {
      const f = line.split("\t");
      const month = f[iMonth];
      const day = f[iDay];
      if (!month || !day) continue;
      out[`${Number(month)}-${Number(day)}`] = {
        p25: parseNum(f[iP25]),
        p50: parseNum(f[iP50]),
        p75: parseNum(f[iP75]),
        p90: parseNum(f[iP90]),
        mean: parseNum(f[iMean]),
      };
    }
    return out;
  });
  return new Map(Object.entries(obj));
}

/**
 * Contextualize a current discharge against the day's historical
 * percentiles. Bands: <p25 low, p25–p75 normal, p75–p90 elevated,
 * >p90 high.
 */
export function flowContext(
  current: number | null,
  stat: DailyStat | undefined,
): { context: FlowContext; detail: string | null } {
  if (current === null || !stat || stat.p25 === null || stat.p75 === null) {
    return { context: "unknown", detail: null };
  }
  if (stat.p90 !== null && current > stat.p90) {
    return { context: "high", detail: `above the 90th percentile for this date (p90 ${stat.p90} cfs)` };
  }
  if (current > stat.p75) {
    return { context: "elevated", detail: `above the 75th percentile for this date (p75 ${stat.p75} cfs)` };
  }
  if (current < stat.p25) {
    return { context: "low", detail: `below the 25th percentile for this date (p25 ${stat.p25} cfs)` };
  }
  return {
    context: "normal",
    detail: `within the interquartile range for this date (p25 ${stat.p25}–p75 ${stat.p75} cfs)`,
  };
}
