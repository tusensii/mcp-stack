/**
 * get_trail_weather_profile: one chart-ready series merging mileage,
 * elevation, temperature, and precipitation along a trail.
 *
 * Pipeline: resolve polyline (same inputs as get_elevation_profile) →
 * resample → one Open-Meteo elevation batch → ≤5 elevation-corrected
 * weather samples along the route (parallel, one day window each) →
 * interpolate temperature between samples per profile point.
 *
 * Honesty contract (carried from doing this by hand): precipitation does
 * NOT vary meaningfully in the source model at trail scale, and the
 * temperature correction is a model adjustment, not a mountain-station
 * observation. Per-field provenance is part of the payload so downstream
 * consumers label charts accordingly.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Confidence, Env, Source, ToolPayload } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import {
  OPEN_METEO_ATTRIBUTION,
  getElevationsMeters,
  getPointForecast,
} from "../sources/openmeteo.js";
import { resamplePolyline } from "../polyline.js";
import { payloadResponse, titledTool } from "./utils.js";
import { profileInputSchema, resolvePolyline } from "./profile_shared.js";
import { buildProfileEntries, profileStats } from "./elevation_profile.js";

const MAX_WEATHER_SAMPLES = 5;
const PROFILE_POINTS = 50;

interface TrailWeatherPoint {
  mile: number;
  elevation_ft: number | null;
  temp_f: number | null;
  precip_pct: number | null;
}

interface TrailWeatherData {
  resolved_from: "points" | "osm_id" | "trail_name";
  osm_id?: string;
  matched_name?: string;
  date: string;
  window: { start_hour: number; end_hour: number };
  series: TrailWeatherPoint[];
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function registerTrailWeatherProfileTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_trail_weather_profile",
    "Modeling weather along the trail…",
    "One merged, chart-ready series along a trail: {mile, elevation_ft, temp_f, precip_pct}[] — built for \"graph mileage, elevation, temperature and rain in one visual\" asks. Accepts the same polyline inputs as get_elevation_profile (`points` > `osm_id` > `trail_name`+lat/lon), plus optional `date` (YYYY-MM-DD, default today Pacific, up to ~16 days out) and an hour window (default 8–18). Internally: elevation from one Open-Meteo DEM batch, then at most 5 elevation-corrected weather samples along the route, temperatures interpolated between samples. READ THE PROVENANCE LABELS before charting: elevation is DEM-sampled (90 m Copernicus GLO-90); temp_f is a model elevation-correction (Open-Meteo hypsometric adjustment), not a mountain-station observation; precip_pct is GRID-SCALE — it does not vary meaningfully at trail scale, so never imply per-point precipitation precision. Partial failure degrades per-field: series returns with null temp/precip (or null elevation) and a named caveat.",
    {
      ...profileInputSchema,
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Forecast date YYYY-MM-DD (default: today, America/Los_Angeles)."),
      start_hour: z.number().int().min(0).max(23).default(8).describe("Window start hour, local (default 8)."),
      end_hour: z.number().int().min(1).max(24).default(18).describe("Window end hour, local, exclusive (default 18)."),
    },
    async (args) => {
      const date = args.date ?? todayInPacific();
      if (args.end_hour <= args.start_hour) {
        return payloadResponse(empty<TrailWeatherData>(["end_hour must be after start_hour."]));
      }

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
      const sampleResults = await Promise.all(
        indices.map(async (idx) => {
          const p = sampled[idx]!;
          const elevM = elevationsM[idx];
          try {
            const fc = await getPointForecast(env, {
              lat: p.lat,
              lon: p.lon,
              ...(typeof elevM === "number" ? { elevationM: elevM } : {}),
              startDate: date,
              endDate: date,
            });
            const windowHours = fc.hourly.filter((h) => {
              if (!h.time.startsWith(date)) return false;
              const hour = Number.parseInt(h.time.slice(11, 13), 10);
              return hour >= args.start_hour && hour < args.end_hour;
            });
            const temps = windowHours
              .map((h) => h.temp_f)
              .filter((v): v is number => v !== null);
            const precips = windowHours
              .map((h) => h.precip_probability_pct)
              .filter((v): v is number => v !== null);
            return {
              mile: profile[idx]!.mile,
              temp_f: mean(temps),
              precip_pct: precips.length > 0 ? Math.max(...precips) : null,
              ok: true,
            };
          } catch (e) {
            return {
              mile: profile[idx]!.mile,
              temp_f: null,
              precip_pct: null,
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }),
      );

      const failed = sampleResults.filter((r) => !r.ok);
      if (failed.length === sampleResults.length) {
        caveats.push(
          `open_meteo_forecast: all ${sampleResults.length} weather samples failed (${failed[0] && "error" in failed[0] ? failed[0].error : "unknown"}) — temp_f/precip_pct are null.`,
        );
      } else if (failed.length > 0) {
        caveats.push(
          `open_meteo_forecast: ${failed.length}/${sampleResults.length} weather samples failed; temperatures interpolated from the remaining samples.`,
        );
      }
      if (sampleResults.some((r) => r.ok && r.temp_f === null)) {
        caveats.push(
          `No forecast hours in the ${args.start_hour}:00–${args.end_hour}:00 window for ${date} — date may be out of the ~16-day forecast range.`,
        );
      }

      const miles = profile.map((p) => p.mile);
      const temps = interpolateByMile(
        miles,
        sampleResults.map((r) => r.mile),
        sampleResults.map((r) => r.temp_f),
      );
      const precipSampleValues = sampleResults.map((r) => r.precip_pct);
      const maxPrecip = precipSampleValues.filter((v): v is number => v !== null);
      // Precip is grid-scale: apply the nearest sample's value rather than
      // pretending it varies per point.
      const precips = miles.map((m) => {
        let nearest: number | null = null;
        let nearestDist = Infinity;
        for (const r of sampleResults) {
          if (r.precip_pct === null) continue;
          const d = Math.abs(r.mile - m);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = r.precip_pct;
          }
        }
        return nearest;
      });

      const series: TrailWeatherPoint[] = profile.map((p, i) => ({
        mile: p.mile,
        elevation_ft: p.elevation_ft,
        temp_f: temps[i] ?? null,
        precip_pct: precips[i] ?? null,
      }));

      sources.push(
        makeSource("https://open-meteo.com/en/docs", OPEN_METEO_ATTRIBUTION, {
          license: "CC BY 4.0",
          confidence: "medium",
        }),
      );

      const validTemps = temps.filter((v): v is number => v !== null);
      const lastPoint = profile[profile.length - 1];
      const data: TrailWeatherData = {
        resolved_from: resolved.resolved_from,
        ...(resolved.osm_id ? { osm_id: resolved.osm_id } : {}),
        ...(resolved.matched_name ? { matched_name: resolved.matched_name } : {}),
        date,
        window: { start_hour: args.start_hour, end_hour: args.end_hour },
        series,
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
          temp: "model elevation-corrected (Open-Meteo hypsometric adjustment) — not a station observation",
          precip: "grid-scale — weakest field; does not vary meaningfully at trail scale",
        },
      };

      const confidence: Confidence =
        validTemps.length > 0 && stats.min_elevation_ft !== null ? "medium" : "low";
      const payload: ToolPayload<TrailWeatherData> = ok(data, sources, confidence, caveats);
      return payloadResponse(payload);
    },
  );
}
