/**
 * Open-Meteo clients (open-meteo.com). Free for non-commercial use, no
 * API key; attribution required (CC BY 4.0).
 *
 *  - Elevation API: Copernicus GLO-90 DEM (90 m resolution, <~4 m
 *    vertical error). Accepts comma-separated batches of up to 100
 *    coordinate pairs per request.
 *  - Forecast API: `best_match` model selection (1–2 km high-res models
 *    over North America for the first days). Supplying `elevation`
 *    applies hypsometric altitude correction to temperature/pressure
 *    variables — this is a model adjustment, not a station observation.
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { userAgent } from "../tools/utils.js";

const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export const OPEN_METEO_ATTRIBUTION = "Weather/elevation data by Open-Meteo.com (CC BY 4.0)";

/** Max coordinate pairs the Elevation API accepts in one request. */
export const ELEVATION_BATCH_LIMIT = 100;

function client(env: Env) {
  return createFetchClient({
    userAgent: userAgent(env.CONTACT),
    defaultHeaders: { Accept: "application/json" },
    timeoutMs: 15_000,
    retries: 1,
  });
}

/** FNV-1a over a string — short stable cache keys for long coord lists. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

interface ElevationResponse {
  elevation?: number[];
}

/**
 * Batch point elevations in METERS (callers convert). At most
 * ELEVATION_BATCH_LIMIT points — throws on more rather than silently
 * splitting into serial requests. Returns null per point on gaps.
 */
export async function getElevationsMeters(
  env: Env,
  points: Array<{ lat: number; lon: number }>,
): Promise<Array<number | null>> {
  if (points.length === 0) return [];
  if (points.length > ELEVATION_BATCH_LIMIT) {
    throw new Error(`open-meteo elevation batch limit is ${ELEVATION_BATCH_LIMIT} points`);
  }
  const lats = points.map((p) => round5(p.lat)).join(",");
  const lons = points.map((p) => round5(p.lon)).join(",");
  const key = `openmeteo:elev:${fnv1a(`${lats}|${lons}`)}:${points.length}`;
  return cached(env, key, TTL.USGS, async () => {
    const res = await client(env).json<ElevationResponse>(
      `${ELEVATION_URL}?latitude=${lats}&longitude=${lons}`,
    );
    const elev = res.elevation ?? [];
    return points.map((_, i) => (typeof elev[i] === "number" ? elev[i]! : null));
  });
}

export interface OpenMeteoDaily {
  date: string;
  temp_max_f: number | null;
  temp_min_f: number | null;
  precip_probability_max_pct: number | null;
  precip_sum_in: number | null;
  freezing_level_min_ft: number | null;
  freezing_level_max_ft: number | null;
}

export interface OpenMeteoHourly {
  time: string;
  temp_f: number | null;
  precip_probability_pct: number | null;
  precip_in: number | null;
  wind_speed_mph: number | null;
  freezing_level_ft: number | null;
}

export interface OpenMeteoForecast {
  /** Elevation (ft) the model actually used for altitude correction. */
  model_elevation_ft: number;
  daily: OpenMeteoDaily[];
  hourly: OpenMeteoHourly[];
}

interface RawForecastResponse {
  elevation?: number;
  hourly_units?: Record<string, string>;
  daily?: {
    time?: string[];
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    precipitation_probability_max?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: Array<number | null>;
    precipitation_probability?: Array<number | null>;
    precipitation?: Array<number | null>;
    wind_speed_10m?: Array<number | null>;
    freezing_level_height?: Array<number | null>;
  };
}

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Elevation-corrected forecast for a point. `elevationM`, when given, is
 * passed as the `elevation` parameter so temperature/pressure variables
 * are altitude-adjusted; otherwise Open-Meteo falls back to its own
 * 90 m DEM lookup.
 *
 * With `temperature_unit=fahrenheit`, Open-Meteo also returns
 * `freezing_level_height` in FEET (verified against `hourly_units`) —
 * the units block is consulted rather than assumed.
 */
export async function getPointForecast(
  env: Env,
  opts: {
    lat: number;
    lon: number;
    elevationM?: number;
    days?: number;
    startDate?: string;
    endDate?: string;
  },
): Promise<OpenMeteoForecast> {
  const { lat, lon, elevationM } = opts;
  const days = Math.min(Math.max(opts.days ?? 7, 1), 16);
  const params = new URLSearchParams({
    latitude: String(round5(lat)),
    longitude: String(round5(lon)),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
    hourly: "temperature_2m,precipitation_probability,precipitation,wind_speed_10m,freezing_level_height",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "America/Los_Angeles",
  });
  if (typeof elevationM === "number") params.set("elevation", String(Math.round(elevationM)));
  if (opts.startDate && opts.endDate) {
    params.set("start_date", opts.startDate);
    params.set("end_date", opts.endDate);
  } else {
    params.set("forecast_days", String(days));
  }

  const key = `openmeteo:fc:${fnv1a(params.toString())}`;
  return cached(env, key, TTL.NWS_FORECAST, async () => {
    const res = await client(env).json<RawForecastResponse>(`${FORECAST_URL}?${params.toString()}`);

    const flUnit = res.hourly_units?.["freezing_level_height"] ?? "m";
    const toFt = (v: number | null): number | null =>
      v === null ? null : flUnit === "ft" ? v : v * 3.28084;

    const hourly: OpenMeteoHourly[] = (res.hourly?.time ?? []).map((t, i) => ({
      time: t,
      temp_f: num(res.hourly?.temperature_2m?.[i]),
      precip_probability_pct: num(res.hourly?.precipitation_probability?.[i]),
      precip_in: num(res.hourly?.precipitation?.[i]),
      wind_speed_mph: num(res.hourly?.wind_speed_10m?.[i]),
      freezing_level_ft: roundOrNull(toFt(num(res.hourly?.freezing_level_height?.[i]))),
    }));

    const daily: OpenMeteoDaily[] = (res.daily?.time ?? []).map((date, i) => {
      const dayHours = hourly.filter((h) => h.time.startsWith(date));
      const levels = dayHours
        .map((h) => h.freezing_level_ft)
        .filter((v): v is number => v !== null);
      return {
        date,
        temp_max_f: num(res.daily?.temperature_2m_max?.[i]),
        temp_min_f: num(res.daily?.temperature_2m_min?.[i]),
        precip_probability_max_pct: num(res.daily?.precipitation_probability_max?.[i]),
        precip_sum_in: num(res.daily?.precipitation_sum?.[i]),
        freezing_level_min_ft: levels.length > 0 ? Math.round(Math.min(...levels)) : null,
        freezing_level_max_ft: levels.length > 0 ? Math.round(Math.max(...levels)) : null,
      };
    });

    const modelElevM = typeof res.elevation === "number" ? res.elevation : 0;
    return { model_elevation_ft: Math.round(modelElevM * 3.28084), daily, hourly };
  });
}

function roundOrNull(v: number | null): number | null {
  return v === null ? null : Math.round(v);
}
