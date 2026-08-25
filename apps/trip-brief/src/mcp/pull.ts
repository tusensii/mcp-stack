/**
 * Data acquisition (#102).
 *
 * Every pull the Royal Basin cycle did by hand runs here, in parallel, once
 * per build. A tool that fails degrades to an absent section plus a recorded
 * caveat — a brief that refuses to build because one river gauge is offline
 * is worse than a brief that says the gauge is offline.
 *
 * Each tool is assigned the provenance tier its data actually warrants (#105).
 * `get_permits` is `lookup-inference` on purpose: it is a rec.gov *catalog*
 * lookup, and treating it as anything stronger is precisely how a park-wide
 * permit-system ID ended up printed as the party's permit number (#104).
 */

import type { ProvenanceTier, TripConfig, OptionsConfig, Candidate } from "../config/schema.ts";
import type { ToolPayload, TripMcpClient } from "./client.ts";
import { normalizePayload } from "./client.ts";
import type {
  AccessStatusData,
  CampWaterData,
  ConditionsData,
  ElevationProfileData,
  GetPermitsData,
  RiverConditionsData,
  SafetyBriefData,
  TrailWeatherData,
  TripReportsData,
  WeatherData,
} from "./types.ts";

export interface PullResult<T> {
  tool: string;
  tier: ProvenanceTier;
  payload: ToolPayload<T>;
  /** Set when the call itself failed rather than returning an empty payload. */
  error?: string;
}

function failed<T>(tool: string, tier: ProvenanceTier, error: string): PullResult<T> {
  return {
    tool,
    tier,
    error,
    payload: {
      data: null,
      sources: [],
      confidence: "low",
      caveats: [`${tool} could not be reached during this build: ${error}`],
    },
  };
}

async function attempt<T>(
  client: TripMcpClient,
  tool: string,
  tier: ProvenanceTier,
  args: Record<string, unknown>,
  onLog: (m: string) => void,
): Promise<PullResult<T>> {
  onLog(`pull ${tool}`);
  try {
    const payload = await client.call<T>(tool, args);
    return { tool, tier, payload: normalizePayload(payload) };
  } catch (err) {
    const message = (err as Error).message;
    onLog(`pull ${tool} FAILED: ${message}`);
    return failed<T>(tool, tier, message);
  }
}

export interface TripPull {
  weather: PullResult<WeatherData>;
  trailWeather: PullResult<TrailWeatherData> | null;
  elevation: PullResult<ElevationProfileData> | null;
  rivers: PullResult<RiverConditionsData> | null;
  conditions: PullResult<ConditionsData>;
  tripReports: PullResult<TripReportsData>;
  safety: PullResult<SafetyBriefData> | null;
  access: PullResult<AccessStatusData> | null;
  permits: PullResult<GetPermitsData> | null;
  campWater: PullResult<CampWaterData> | null;
  /** Instant the pull began; becomes the report's refresh timestamp. */
  pulled_at: Date;
}

/** Number of forecast days to request so the whole trip window is covered. */
function forecastDays(cfg: { dates: { start: string; end: string } }): number {
  const endMs = Date.parse(`${cfg.dates.end}T23:59:59Z`);
  const spanDays = Math.ceil((endMs - Date.now()) / 86_400_000);
  return Math.min(7, Math.max(1, spanDays));
}

function routeArgs(cfg: TripConfig): Record<string, unknown> | null {
  const route = cfg.route;
  if (!route) return null;
  if (route.points?.length) {
    return { points: route.points.map(([lat, lon]) => ({ lat, lon })) };
  }
  if (route.osm_id) return { osm_id: route.osm_id };
  if (route.trail_name) return { trail_name: route.trail_name };
  return null;
}

export async function pullTrip(
  client: TripMcpClient,
  cfg: TripConfig,
  onLog: (m: string) => void = () => {},
): Promise<TripPull> {
  const pulled_at = new Date();
  const { lat, lon } = cfg.destination;
  const days = forecastDays(cfg);
  const route = routeArgs(cfg);
  const areaArgs = cfg.area_id ? { area_id: cfg.area_id } : null;

  const [
    weather,
    trailWeather,
    elevation,
    rivers,
    conditions,
    tripReports,
    safety,
    access,
    permits,
    campWater,
  ] = await Promise.all([
    attempt<WeatherData>(client, "get_weather", "live-instrument", {
      lat,
      lon,
      days,
      include_alerts: true,
      include_afd: true,
      // #108: asking for the destination elevation is what produces the
      // `elevation_adjusted` block the climb card prefers over the valley grid.
      ...(cfg.destination.elevation_ft ? { elevation_ft: cfg.destination.elevation_ft } : {}),
    }, onLog),

    route && cfg.route?.climb_window
      ? attempt<TrailWeatherData>(client, "get_trail_weather_profile", "live-instrument", {
          ...route,
          date: cfg.route.climb_window.date,
          start_hour: cfg.route.climb_window.start_hour,
          end_hour: cfg.route.climb_window.end_hour,
          pace_mph: cfg.route.climb_window.pace_mph,
          include_gear_flags: true,
        }, onLog)
      : null,

    route
      ? attempt<ElevationProfileData>(client, "get_elevation_profile", "official-static", route, onLog)
      : null,

    areaArgs
      ? attempt<RiverConditionsData>(client, "get_river_conditions", "live-instrument", areaArgs, onLog)
      : null,

    attempt<ConditionsData>(
      client,
      "get_conditions",
      "official-static",
      areaArgs ?? { lat, lon },
      onLog,
    ),

    attempt<TripReportsData>(client, "get_trip_reports", "community", {
      ...(areaArgs ?? {}),
      ...(cfg.route?.trail_name ? { trail_name: cfg.route.trail_name } : {}),
      since_days: 30,
      limit: 8,
      extract_conditions: true,
    }, onLog),

    areaArgs
      ? attempt<SafetyBriefData>(client, "get_safety_brief", "official-static", areaArgs, onLog)
      : null,

    areaArgs
      ? attempt<AccessStatusData>(client, "get_access_status", "official-static", {
          ...areaArgs,
          ...(cfg.drive?.origin ? { origin: cfg.drive.origin } : {}),
        }, onLog)
      : null,

    // Catalog lookup only. Never the party's reservation (#104).
    areaArgs
      ? attempt<GetPermitsData>(client, "get_permits", "lookup-inference", areaArgs, onLog)
      : null,

    areaArgs
      ? attempt<CampWaterData>(client, "get_camp_water_beta", "official-static", areaArgs, onLog)
      : null,
  ]);

  return {
    weather,
    trailWeather,
    elevation,
    rivers,
    conditions,
    tripReports,
    safety,
    access,
    permits,
    campWater,
    pulled_at,
  };
}

// ---------------------------------------------------------------------------
// Options card (#106)
// ---------------------------------------------------------------------------

export interface CandidatePull {
  candidate: Candidate;
  weather: PullResult<WeatherData>;
  conditions: PullResult<ConditionsData>;
}

export interface OptionsPull {
  candidates: CandidatePull[];
  pulled_at: Date;
}

export async function pullOptions(
  client: TripMcpClient,
  cfg: OptionsConfig,
  onLog: (m: string) => void = () => {},
): Promise<OptionsPull> {
  const pulled_at = new Date();
  const days = forecastDays(cfg);

  // Serialised in small batches: a nine-candidate card is eighteen tool calls
  // and hammering the Worker in one burst just trips upstream rate limits.
  const results: CandidatePull[] = [];
  const batchSize = 3;
  for (let i = 0; i < cfg.candidates.length; i += batchSize) {
    const batch = cfg.candidates.slice(i, i + batchSize);
    const pulled = await Promise.all(
      batch.map(async (candidate): Promise<CandidatePull> => {
        const areaArgs = candidate.area_id
          ? { area_id: candidate.area_id }
          : { lat: candidate.point.lat, lon: candidate.point.lon };
        const [weather, conditions] = await Promise.all([
          attempt<WeatherData>(client, "get_weather", "live-instrument", {
            lat: candidate.point.lat,
            lon: candidate.point.lon,
            days,
            include_alerts: true,
            include_afd: false,
            ...(candidate.point.elevation_ft
              ? { elevation_ft: candidate.point.elevation_ft }
              : {}),
          }, onLog),
          attempt<ConditionsData>(client, "get_conditions", "official-static", areaArgs, onLog),
        ]);
        return { candidate, weather, conditions };
      }),
    );
    results.push(...pulled);
  }

  return { candidates: results, pulled_at };
}
