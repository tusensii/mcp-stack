/**
 * get_elevation_profile: distance-indexed elevation series along a trail
 * polyline. Resolves the polyline (points | osm_id | trail_name+hint),
 * resamples to <=100 evenly spaced points, and fetches elevations in ONE
 * Open-Meteo Elevation API batch (Copernicus GLO-90 DEM). Degrades to a
 * distance-only profile with null elevations if the provider fails.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Confidence, Env, Source, ToolPayload } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import {
  ELEVATION_BATCH_LIMIT,
  OPEN_METEO_ATTRIBUTION,
  getElevationsMeters,
} from "../sources/openmeteo.js";
import { metersToFeet, resamplePolyline, type ProfilePoint } from "../polyline.js";
import { payloadResponse, titledTool } from "./utils.js";
import { profileInputSchema, resolvePolyline } from "./profile_shared.js";

export interface ElevationProfileEntry {
  mile: number;
  lat: number;
  lon: number;
  elevation_ft: number | null;
}

interface ElevationProfileData {
  resolved_from: "points" | "osm_id" | "trail_name";
  osm_id?: string;
  matched_name?: string;
  profile: ElevationProfileEntry[];
  total_distance_mi: number;
  total_gain_ft: number | null;
  total_loss_ft: number | null;
  min_elevation_ft: number | null;
  max_elevation_ft: number | null;
}

export function buildProfileEntries(
  sampled: ProfilePoint[],
  elevationsM: Array<number | null>,
): ElevationProfileEntry[] {
  return sampled.map((p, i) => {
    const m = elevationsM[i];
    return {
      mile: p.mile,
      lat: Math.round(p.lat * 1e5) / 1e5,
      lon: Math.round(p.lon * 1e5) / 1e5,
      elevation_ft: typeof m === "number" ? Math.round(metersToFeet(m)) : null,
    };
  });
}

export function profileStats(entries: ElevationProfileEntry[]): {
  total_gain_ft: number | null;
  total_loss_ft: number | null;
  min_elevation_ft: number | null;
  max_elevation_ft: number | null;
} {
  const elevs = entries.map((e) => e.elevation_ft).filter((v): v is number => v !== null);
  if (elevs.length === 0) {
    return {
      total_gain_ft: null,
      total_loss_ft: null,
      min_elevation_ft: null,
      max_elevation_ft: null,
    };
  }
  let gain = 0;
  let loss = 0;
  let prev: number | null = null;
  for (const e of entries) {
    if (e.elevation_ft === null) continue;
    if (prev !== null) {
      const d = e.elevation_ft - prev;
      if (d > 0) gain += d;
      else loss -= d;
    }
    prev = e.elevation_ft;
  }
  return {
    total_gain_ft: Math.round(gain),
    total_loss_ft: Math.round(loss),
    min_elevation_ft: Math.min(...elevs),
    max_elevation_ft: Math.max(...elevs),
  };
}

export function registerElevationProfileTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_elevation_profile",
    "Sampling elevation profile…",
    "Distance-indexed elevation profile along a trail polyline — the missing piece for \"chart this trail's elevation\" asks. Input precedence: (1) `points` as [lat,lon] pairs (e.g. from a GPX the user supplied), (2) `osm_id` ('way/123' / 'relation/123' / bare way id), (3) `trail_name` + lat/lon hint resolved via OpenStreetMap (matches OSM name, alt_name, loc_name, official_name, and USFS trail number). Output: `profile[]` of {mile, lat, lon, elevation_ft} with cumulative miles from the first point, plus total distance/gain/loss and min/max elevation. Inputs longer than 100 points are resampled DOWN to `samples` evenly spaced points (never multiple serial upstream batches). Elevations come from the Open-Meteo Elevation API (Copernicus GLO-90 DEM, 90 m resolution, <~4 m vertical error) — profiles are approximations of the mapped line, NOT surveyed track data; short steep features between samples are smoothed out. If the elevation provider fails, the distance-resampled polyline is returned with elevation_ft null and a named caveat.",
    {
      ...profileInputSchema,
      samples: z
        .number()
        .int()
        .min(2)
        .max(ELEVATION_BATCH_LIMIT)
        .default(50)
        .describe("Target sample count along the line (max 100 = one Open-Meteo batch). Default 50."),
    },
    async (args) => {
      const resolved = await resolvePolyline(env, args);
      if ("error" in resolved) {
        return payloadResponse(empty<ElevationProfileData>([resolved.error]));
      }

      const sampled = resamplePolyline(resolved.points, args.samples);
      const caveats = [
        ...resolved.caveats,
        "Elevations from a 90 m DEM (Copernicus GLO-90) — approximate; short steep features between samples are smoothed out.",
      ];
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

      let elevations: Array<number | null>;
      let elevationOk = true;
      try {
        elevations = await getElevationsMeters(env, sampled);
        sources.push(
          makeSource("https://open-meteo.com/en/docs/elevation-api", OPEN_METEO_ATTRIBUTION, {
            license: "CC BY 4.0",
            confidence: "medium",
          }),
        );
      } catch (e) {
        elevationOk = false;
        elevations = sampled.map(() => null);
        caveats.push(
          `open_meteo_elevation: ${e instanceof Error ? e.message : String(e)} — returning distance-only profile with null elevations.`,
        );
      }

      const profile = buildProfileEntries(sampled, elevations);
      const stats = profileStats(profile);
      const lastEntry = profile[profile.length - 1];

      const data: ElevationProfileData = {
        resolved_from: resolved.resolved_from,
        ...(resolved.osm_id ? { osm_id: resolved.osm_id } : {}),
        ...(resolved.matched_name ? { matched_name: resolved.matched_name } : {}),
        profile,
        total_distance_mi: lastEntry ? lastEntry.mile : 0,
        ...stats,
      };

      const confidence: Confidence = elevationOk ? "medium" : "low";
      const payload: ToolPayload<ElevationProfileData> = ok(data, sources, confidence, caveats);
      return payloadResponse(payload);
    },
  );
}
