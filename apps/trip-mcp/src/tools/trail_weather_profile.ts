/**
 * get_trail_weather_profile: one chart-ready series merging mileage,
 * elevation, temperature, and precipitation along a trail — plus, on
 * request, a time axis (hourly conditions per sample point), ETA-based
 * evaluation ("what will it feel like when I'm actually there"), and
 * rule-based gear flags.
 *
 * Pipeline: resolve polyline (same inputs as get_elevation_profile) →
 * resample → one Open-Meteo elevation batch → ≤5 elevation-corrected
 * weather samples along the route (parallel, one day window each) →
 * interpolate temperature between samples.
 *
 * Honesty contract (carried from doing this by hand): precipitation does
 * NOT vary meaningfully in the source model at trail scale, the
 * temperature correction is a model adjustment (not a mountain-station
 * observation), and gear flags are deterministic heuristics — the
 * consuming LLM narrates; this tool never freeforms advice. Per-field
 * provenance is part of the payload.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Confidence, Env, Source, ToolPayload } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import {
  OPEN_METEO_ATTRIBUTION,
  getElevationsMeters,
  getPointForecast,
  type OpenMeteoHourly,
} from "../sources/openmeteo.js";
import { resamplePolyline } from "../polyline.js";
import { payloadResponse, titledTool } from "./utils.js";
import { profileInputSchema, resolvePolyline } from "./profile_shared.js";
import { buildProfileEntries, profileStats } from "./elevation_profile.js";

const MAX_WEATHER_SAMPLES = 5;
const PROFILE_POINTS = 50;

const GEAR_DISCLAIMER =
  "Gear flags are model-derived heuristics from forecast data — not a substitute for judgment, current conditions, or ranger information. get_safety_brief remains the authority for safety gear.";

interface TrailWeatherPoint {
  mile: number;
  elevation_ft: number | null;
  temp_f: number | null;
  precip_pct: number | null;
  /** Present in ETA mode: estimated arrival clock time (HH:MM local). */
  eta?: string;
}

export interface TimeSeriesHour {
  time_iso: string;
  temp_f: number | null;
  precip_pct: number | null;
  precip_in: number | null;
  wind_mph: number | null;
  freezing_level_ft: number | null;
}

interface SampleTimeSeries {
  mile: number;
  hours: TimeSeriesHour[];
}

export interface GearFlag {
  item: string;
  level: "consider" | "recommended" | "strongly_recommended";
  reason: string;
  /** Mile range affected, or null when route-wide. */
  affected_miles: [number, number] | null;
}

interface TrailWeatherData {
  resolved_from: "points" | "osm_id" | "trail_name";
  osm_id?: string;
  matched_name?: string;
  date: string;
  window: { start_hour: number; end_hour: number };
  /** How temp_f/precip_pct in `series` were evaluated. */
  evaluation: "window_mean" | "eta";
  eta_params?: { start_time: string; pace_mph: number };
  series: TrailWeatherPoint[];
  time_series?: SampleTimeSeries[];
  gear_flags?: { flags: GearFlag[]; disclaimer: string };
  summary: {
    total_distance_mi: number;
    total_gain_ft: number | null;
    min_elevation_ft: number | null;
    max_elevation_ft: number | null;
    route_min_temp_f: number | null;
    route_max_temp_f: number | null;
    any_point_at_or_below_freezing: boolean | null;
    max_precip_probability_pct: number | null;
  };
  provenance: {
    elevation: string;
    temp: string;
    precip: string;
    gear_flags?: string;
  };
}

function todayInPacific(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** Evenly spaced sample indices over [0, n-1], endpoints included. */
export function sampleIndices(n: number, maxSamples: number): number[] {
  if (n <= 0) return [];
  const count = Math.min(maxSamples, n);
  if (count === 1) return [0];
  const out = new Set<number>();
  for (let i = 0; i < count; i++) {
    out.add(Math.round(((n - 1) * i) / (count - 1)));
  }
  return [...out].sort((a, b) => a - b);
}

/** Piecewise-linear interpolation of sample values by mile. */
export function interpolateByMile(
  miles: number[],
  sampleMiles: number[],
  sampleValues: Array<number | null>,
): Array<number | null> {
  const valid: Array<{ mile: number; value: number }> = [];
  for (let i = 0; i < sampleMiles.length; i++) {
    const v = sampleValues[i];
    if (typeof v === "number") valid.push({ mile: sampleMiles[i]!, value: v });
  }
  if (valid.length === 0) return miles.map(() => null);
  return miles.map((m) => {
    if (m <= valid[0]!.mile) return round1(valid[0]!.value);
    const last = valid[valid.length - 1]!;
    if (m >= last.mile) return round1(last.value);
    for (let i = 1; i < valid.length; i++) {
      const a = valid[i - 1]!;
      const b = valid[i]!;
      if (m <= b.mile) {
        const t = b.mile > a.mile ? (m - a.mile) / (b.mile - a.mile) : 0;
        return round1(a.value + (b.value - a.value) * t);
      }
    }
    return round1(last.value);
  });
}

/**
 * Estimated arrival hour (fractional, 24h clock) for a route point.
 * Linear pace; clamped to 23.99 with the clamp reported by callers.
 */
export function etaHourForMile(mile: number, startTime: string, paceMph: number): number {
  const [hh, mm] = startTime.split(":");
  const startHours = Number.parseInt(hh ?? "8", 10) + Number.parseInt(mm ?? "0", 10) / 60;
  return Math.min(startHours + mile / Math.max(paceMph, 0.1), 23.99);
}

function fmtClock(hourFloat: number): string {
  const h = Math.floor(hourFloat);
  const m = Math.round((hourFloat - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function hourOf(h: OpenMeteoHourly): number {
  return Number.parseInt(h.time.slice(11, 13), 10);
}

interface SampleData {
  mile: number;
  ok: boolean;
  error?: string;
  /** Hourly entries for the requested date (whole day). */
  dayHours: OpenMeteoHourly[];
  /** Window aggregates (static mode). */
  temp_window_mean_f: number | null;
  precip_window_max_pct: number | null;
  precip_window_sum_in: number | null;
  wind_window_max_mph: number | null;
  cloud_window_mean_pct: number | null;
  uv_window_max: number | null;
  freezing_level_window_min_ft: number | null;
}

/** Nearest-hour lookup within a sample's day. */
function sampleAtHour(s: SampleData, hourFloat: number): OpenMeteoHourly | null {
  if (s.dayHours.length === 0) return null;
  let best: OpenMeteoHourly | null = null;
  let bestDist = Infinity;
  for (const h of s.dayHours) {
    const d = Math.abs(hourOf(h) - hourFloat);
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  return best;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mileRange(miles: number[]): [number, number] | null {
  if (miles.length === 0) return null;
  return [Math.min(...miles), Math.max(...miles)];
}

/**
 * Rule-based gear flags. Thresholds (documented in the tool description):
 * rain_shell ≥30% precip prob or >0.01 in (strongly ≥60%); insulation
 * route min ≤45°F (strongly ≤35°F); freezing_risk any point ≤32°F;
 * traction freezing level below route max elevation; sun mean cloud <30%
 * and UV ≥6; wind max ≥20 mph.
 */
export function computeGearFlags(input: {
  points: Array<{ mile: number; elevation_ft: number | null; temp_f: number | null }>;
  samples: SampleData[];
  maxElevationFt: number | null;
}): GearFlag[] {
  const flags: GearFlag[] = [];
  const okSamples = input.samples.filter((s) => s.ok);
  if (okSamples.length === 0) return flags;

  const maxPrecipPct = Math.max(
    ...okSamples.map((s) => s.precip_window_max_pct ?? -1).filter((v) => v >= 0),
    -1,
  );
  const anyPrecipIn = okSamples.some((s) => (s.precip_window_sum_in ?? 0) > 0.01);
  if (maxPrecipPct >= 60) {
    flags.push({
      item: "rain_shell",
      level: "strongly_recommended",
      reason: `max precipitation probability ${Math.round(maxPrecipPct)}% in window`,
      affected_miles: null,
    });
  } else if (maxPrecipPct >= 30 || anyPrecipIn) {
    flags.push({
      item: "rain_shell",
      level: "recommended",
      reason: anyPrecipIn
        ? "measurable precipitation forecast in window"
        : `max precipitation probability ${Math.round(maxPrecipPct)}% in window`,
      affected_miles: null,
    });
  }

  const temps = input.points.map((p) => p.temp_f).filter((v): v is number => v !== null);
  if (temps.length > 0) {
    const minTemp = Math.min(...temps);
    if (minTemp <= 35) {
      flags.push({
        item: "insulation",
        level: "strongly_recommended",
        reason: `route minimum temperature ${round1(minTemp)}°F`,
        affected_miles: null,
      });
    } else if (minTemp <= 45) {
      flags.push({
        item: "insulation",
        level: "recommended",
        reason: `route minimum temperature ${round1(minTemp)}°F`,
        affected_miles: null,
      });
    }
    const freezingMiles = input.points
      .filter((p) => p.temp_f !== null && p.temp_f <= 32)
      .map((p) => p.mile);
    if (freezingMiles.length > 0) {
      flags.push({
        item: "freezing_risk",
        level: "strongly_recommended",
        reason: "modeled temperature at or below 32°F at evaluation time",
        affected_miles: mileRange(freezingMiles),
      });
    }
  }

  if (input.maxElevationFt !== null) {
    const minFreezing = okSamples
      .map((s) => s.freezing_level_window_min_ft)
      .filter((v): v is number => v !== null);
    if (minFreezing.length > 0 && Math.min(...minFreezing) < input.maxElevationFt) {
      flags.push({
        item: "traction",
        level: "consider",
        reason: `freezing level (${Math.round(Math.min(...minFreezing))} ft) drops below route max elevation (${Math.round(input.maxElevationFt)} ft) — snow/ice possible at elevation`,
        affected_miles: null,
      });
    }
  }

  const cloudMeans = okSamples
    .map((s) => s.cloud_window_mean_pct)
    .filter((v): v is number => v !== null);
  const uvMaxes = okSamples.map((s) => s.uv_window_max).filter((v): v is number => v !== null);
  if (
    cloudMeans.length > 0 &&
    (mean(cloudMeans) ?? 100) < 30 &&
    uvMaxes.length > 0 &&
    Math.max(...uvMaxes) >= 6
  ) {
    flags.push({
      item: "sun_protection",
      level: "recommended",
      reason: `mostly clear (mean cloud cover ${Math.round(mean(cloudMeans)!)}%) with UV index up to ${round1(Math.max(...uvMaxes))}`,
      affected_miles: null,
    });
  }

  const windySamples = okSamples.filter((s) => (s.wind_window_max_mph ?? 0) >= 20);
  if (windySamples.length > 0) {
    flags.push({
      item: "wind_shell",
      level: "recommended",
      reason: `max wind ${Math.round(Math.max(...windySamples.map((s) => s.wind_window_max_mph!)))} mph in window`,
      affected_miles: mileRange(windySamples.map((s) => s.mile)),
    });
  }

  return flags;
}

export function registerTrailWeatherProfileTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_trail_weather_profile",
    "Modeling weather along the trail…",
    "One merged, chart-ready series along a trail: {mile, elevation_ft, temp_f, precip_pct}[] — built for \"graph mileage, elevation, temperature and rain in one visual\" asks. Accepts the same polyline inputs as get_elevation_profile (`points` > `osm_id` > `trail_name`+lat/lon), plus optional `date` (YYYY-MM-DD, default today Pacific, up to ~16 days out) and an hour window (default 8–18). MODES: (1) default — temp_f is the window mean at each point; (2) `eta_mode: true` with optional `start_time` (default 08:00) and `pace_mph` (default 2, linear) — each point is evaluated at its ESTIMATED ARRIVAL TIME, the answer to \"what will it feel like when I'm actually there\", with per-point `eta` clock times; (3) `time_series: true` — adds per-sample hourly arrays {time_iso, temp_f, precip_pct, precip_in, wind_mph, freezing_level_ft} (≤5 samples × ≤24 h, optionally filtered by `hours: [8,12,16]`) for mile×time charting from ONE call. GEAR FLAGS: a rule-based `gear_flags` block (thresholds: rain_shell ≥30% precip prob or >0.01 in, strongly ≥60%; insulation route-min ≤45°F, strongly ≤35°F; freezing_risk any point ≤32°F with mile range; traction when freezing level < route max elevation; sun_protection mean cloud <30% and UV ≥6; wind_shell ≥20 mph) — heuristics for the consuming LLM to narrate, never safety authority (that's get_safety_brief). READ THE PROVENANCE LABELS before charting: elevation is DEM-sampled (90 m); temp_f is a model elevation-correction, not a station observation; precip_pct is GRID-SCALE — never imply per-point precipitation precision. Partial failure degrades per-field with named caveats.",
    {
      ...profileInputSchema,
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Forecast date YYYY-MM-DD (default: today, America/Los_Angeles)."),
      start_hour: z.number().int().min(0).max(23).default(8).describe("Window start hour, local (default 8)."),
      end_hour: z.number().int().min(1).max(24).default(18).describe("Window end hour, local, exclusive (default 18)."),
      eta_mode: z
        .boolean()
        .default(false)
        .describe("Evaluate each point at its estimated arrival time (start_time + mile/pace_mph) instead of the window mean."),
      start_time: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .optional()
        .describe("ETA mode: departure clock time HH:MM local (default 08:00)."),
      pace_mph: z
        .number()
        .min(0.5)
        .max(6)
        .default(2)
        .describe("ETA mode: linear pace in mph (default 2; no uphill adjustment — pick a conservative value)."),
      time_series: z
        .boolean()
        .default(false)
        .describe("Include per-sample hourly arrays for the date (≤5 samples × ≤24 h)."),
      hours: z
        .array(z.number().int().min(0).max(23))
        .max(24)
        .optional()
        .describe("time_series: restrict hourly arrays to these hours (default: all 24)."),
    },
    async (args) => {
      const date = args.date ?? todayInPacific();
      if (args.end_hour <= args.start_hour) {
        return payloadResponse(empty<TrailWeatherData>(["end_hour must be after start_hour."]));
      }
      const startTime = args.start_time ?? "08:00";

      const resolved = await resolvePolyline(env, args);
      if ("error" in resolved) {
        return payloadResponse(empty<TrailWeatherData>([resolved.error]));
      }

      const sampled = resamplePolyline(resolved.points, PROFILE_POINTS);
      const caveats = [...resolved.caveats];
      const sources: Source[] = [];
      if (resolved.resolved_from !== "points") {
        sources.push(
          makeSource(
            "https://overpass-api.de/api/interpreter",
            "OpenStreetMap (Overpass API) — trail geometry",
            { license: "ODbL", confidence: "medium" },
          ),
        );
      }

      // Elevation batch. Failure → null elevations, weather proceeds uncorrected.
      let elevationsM: Array<number | null>;
      try {
        elevationsM = await getElevationsMeters(env, sampled);
      } catch (e) {
        elevationsM = sampled.map(() => null);
        caveats.push(
          `open_meteo_elevation: ${e instanceof Error ? e.message : String(e)} — elevations null; temperatures NOT elevation-corrected.`,
        );
      }
      const profile = buildProfileEntries(sampled, elevationsM);
      const stats = profileStats(profile);

      // ≤5 weather samples along the route, fetched in parallel for the
      // one-day window; each is elevation-corrected when a DEM value exists.
      const indices = sampleIndices(profile.length, MAX_WEATHER_SAMPLES);
      const samples: SampleData[] = await Promise.all(
        indices.map(async (idx): Promise<SampleData> => {
          const p = sampled[idx]!;
          const elevM = elevationsM[idx];
          const base: SampleData = {
            mile: profile[idx]!.mile,
            ok: false,
            dayHours: [],
            temp_window_mean_f: null,
            precip_window_max_pct: null,
            precip_window_sum_in: null,
            wind_window_max_mph: null,
            cloud_window_mean_pct: null,
            uv_window_max: null,
            freezing_level_window_min_ft: null,
          };
          try {
            const fc = await getPointForecast(env, {
              lat: p.lat,
              lon: p.lon,
              ...(typeof elevM === "number" ? { elevationM: elevM } : {}),
              startDate: date,
              endDate: date,
            });
            const dayHours = fc.hourly.filter((h) => h.time.startsWith(date));
            const windowHours = dayHours.filter((h) => {
              const hour = hourOf(h);
              return hour >= args.start_hour && hour < args.end_hour;
            });
            const nums = (get: (h: OpenMeteoHourly) => number | null) =>
              windowHours.map(get).filter((v): v is number => v !== null);
            const temps = nums((h) => h.temp_f);
            const precipPcts = nums((h) => h.precip_probability_pct);
            const precipIns = nums((h) => h.precip_in);
            const winds = nums((h) => h.wind_speed_mph);
            const clouds = nums((h) => h.cloud_cover_pct);
            const uvs = nums((h) => h.uv_index);
            const freezing = nums((h) => h.freezing_level_ft);
            return {
              ...base,
              ok: true,
              dayHours,
              temp_window_mean_f: mean(temps),
              precip_window_max_pct: precipPcts.length > 0 ? Math.max(...precipPcts) : null,
              precip_window_sum_in:
                precipIns.length > 0 ? precipIns.reduce((a, b) => a + b, 0) : null,
              wind_window_max_mph: winds.length > 0 ? Math.max(...winds) : null,
              cloud_window_mean_pct: mean(clouds),
              uv_window_max: uvs.length > 0 ? Math.max(...uvs) : null,
              freezing_level_window_min_ft: freezing.length > 0 ? Math.min(...freezing) : null,
            };
          } catch (e) {
            return { ...base, error: e instanceof Error ? e.message : String(e) };
          }
        }),
      );

      const failed = samples.filter((s) => !s.ok);
      if (failed.length === samples.length) {
        caveats.push(
          `open_meteo_forecast: all ${samples.length} weather samples failed (${failed[0]?.error ?? "unknown"}) — temp_f/precip_pct are null.`,
        );
      } else if (failed.length > 0) {
        caveats.push(
          `open_meteo_forecast: ${failed.length}/${samples.length} weather samples failed; temperatures interpolated from the remaining samples.`,
        );
      }
      if (samples.some((s) => s.ok && s.dayHours.length === 0)) {
        caveats.push(
          `No forecast hours for ${date} — date may be out of the ~16-day forecast range.`,
        );
      }

      const miles = profile.map((p) => p.mile);
      let temps: Array<number | null>;
      let etas: string[] | null = null;
      if (args.eta_mode) {
        // Evaluate bracketing samples at each point's arrival hour, then
        // interpolate by mile between those time-specific values.
        etas = miles.map((m) => fmtClock(etaHourForMile(m, startTime, args.pace_mph)));
        temps = miles.map((m) => {
          const hour = etaHourForMile(m, startTime, args.pace_mph);
          const values = samples.map((s) => {
            const h = s.ok ? sampleAtHour(s, hour) : null;
            return h ? h.temp_f : null;
          });
          const interp = interpolateByMile(
            [m],
            samples.map((s) => s.mile),
            values,
          );
          return interp[0] ?? null;
        });
        const lastEta = etaHourForMile(miles[miles.length - 1] ?? 0, startTime, args.pace_mph);
        if (lastEta >= 23.98) {
          caveats.push(
            "ETA evaluation clamped at end of day (23:59) — route end arrival passes midnight at the given pace; conditions past midnight are not evaluated.",
          );
        }
      } else {
        temps = interpolateByMile(
          miles,
          samples.map((s) => s.mile),
          samples.map((s) => s.temp_window_mean_f),
        );
      }

      // Precip is grid-scale: apply the nearest sample's value rather than
      // pretending it varies per point.
      const precips = miles.map((m) => {
        let nearest: number | null = null;
        let nearestDist = Infinity;
        for (const s of samples) {
          if (s.precip_window_max_pct === null) continue;
          const d = Math.abs(s.mile - m);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = s.precip_window_max_pct;
          }
        }
        return nearest;
      });

      const series: TrailWeatherPoint[] = profile.map((p, i) => ({
        mile: p.mile,
        elevation_ft: p.elevation_ft,
        temp_f: temps[i] ?? null,
        precip_pct: precips[i] ?? null,
        ...(etas ? { eta: etas[i]! } : {}),
      }));

      // Optional time-series block: per-sample hourly arrays, bounded.
      let timeSeries: SampleTimeSeries[] | undefined;
      if (args.time_series) {
        const hourFilter = args.hours ? new Set(args.hours) : null;
        timeSeries = samples
          .filter((s) => s.ok)
          .map((s) => ({
            mile: s.mile,
            hours: s.dayHours
              .filter((h) => !hourFilter || hourFilter.has(hourOf(h)))
              .slice(0, 24)
              .map((h) => ({
                time_iso: h.time,
                temp_f: h.temp_f,
                precip_pct: h.precip_probability_pct,
                precip_in: h.precip_in,
                wind_mph: h.wind_speed_mph,
                freezing_level_ft: h.freezing_level_ft,
              })),
          }));
      }

      sources.push(
        makeSource("https://open-meteo.com/en/docs", OPEN_METEO_ATTRIBUTION, {
          license: "CC BY 4.0",
          confidence: "medium",
        }),
      );

      const validTemps = temps.filter((v): v is number => v !== null);
      const weatherResolved = samples.some((s) => s.ok) && validTemps.length > 0;

      // Gear flags only when weather data actually resolved.
      let gearFlags: { flags: GearFlag[]; disclaimer: string } | undefined;
      if (weatherResolved) {
        gearFlags = {
          flags: computeGearFlags({
            points: profile.map((p, i) => ({
              mile: p.mile,
              elevation_ft: p.elevation_ft,
              temp_f: temps[i] ?? null,
            })),
            samples,
            maxElevationFt: stats.max_elevation_ft,
          }),
          disclaimer: GEAR_DISCLAIMER,
        };
      } else {
        caveats.push("gear_flags omitted — weather data did not resolve.");
      }

      const lastPoint = profile[profile.length - 1];
      const maxPrecip = samples
        .map((s) => s.precip_window_max_pct)
        .filter((v): v is number => v !== null);
      const data: TrailWeatherData = {
        resolved_from: resolved.resolved_from,
        ...(resolved.osm_id ? { osm_id: resolved.osm_id } : {}),
        ...(resolved.matched_name ? { matched_name: resolved.matched_name } : {}),
        date,
        window: { start_hour: args.start_hour, end_hour: args.end_hour },
        evaluation: args.eta_mode ? "eta" : "window_mean",
        ...(args.eta_mode ? { eta_params: { start_time: startTime, pace_mph: args.pace_mph } } : {}),
        series,
        ...(timeSeries ? { time_series: timeSeries } : {}),
        ...(gearFlags ? { gear_flags: gearFlags } : {}),
        summary: {
          total_distance_mi: lastPoint ? lastPoint.mile : 0,
          total_gain_ft: stats.total_gain_ft,
          min_elevation_ft: stats.min_elevation_ft,
          max_elevation_ft: stats.max_elevation_ft,
          route_min_temp_f: validTemps.length > 0 ? Math.min(...validTemps) : null,
          route_max_temp_f: validTemps.length > 0 ? Math.max(...validTemps) : null,
          any_point_at_or_below_freezing:
            validTemps.length > 0 ? validTemps.some((t) => t <= 32) : null,
          max_precip_probability_pct: maxPrecip.length > 0 ? Math.max(...maxPrecip) : null,
        },
        provenance: {
          elevation: "DEM-sampled (Copernicus GLO-90, 90 m resolution)",
          temp: args.eta_mode
            ? "model elevation-corrected (Open-Meteo), evaluated at estimated arrival time — not a station observation"
            : "model elevation-corrected (Open-Meteo hypsometric adjustment) — not a station observation",
          precip: "grid-scale — weakest field; does not vary meaningfully at trail scale",
          ...(gearFlags ? { gear_flags: "rule-based heuristic over forecast fields" } : {}),
        },
      };

      const confidence: Confidence =
        weatherResolved && stats.min_elevation_ft !== null ? "medium" : "low";
      const payload: ToolPayload<TrailWeatherData> = ok(data, sources, confidence, caveats);
      return payloadResponse(payload);
    },
  );
}
