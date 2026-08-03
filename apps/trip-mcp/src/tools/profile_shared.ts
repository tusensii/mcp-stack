/**
 * Shared polyline-input resolution for `get_elevation_profile` and
 * `get_trail_weather_profile`. Both accept the same three input shapes,
 * with this precedence:
 *
 *   1. `points` — caller-provided [lat, lon] array (e.g. parsed GPX)
 *   2. `osm_id` — "way/123" / "relation/456" / bare way id
 *   3. `trail_name` + lat/lon hint — Overpass name/alias/ref match
 */

import { z } from "zod";
import type { Env } from "../types.js";
import {
  findTrailGeometryByName,
  getOsmGeometry,
  type OsmGeometryAssembly,
} from "../sources/osm.js";
import { bboxAroundPoint, type PolyPoint } from "../polyline.js";

/** Caveats distinguishing clean chains, bridged gaps, and truncation. */
function assemblyCaveats(assembly: OsmGeometryAssembly | undefined): string[] {
  if (!assembly || assembly.segments_used <= 1) return [];
  const out: string[] = [];
  const from = assembly.assembled_from === "relation" ? "route relation members" : "connected OSM ways";
  if (assembly.bridged_gaps_m.length === 0) {
    out.push(`Full chain assembled from ${assembly.segments_used} ${from}.`);
  } else {
    out.push(
      `Chain assembled from ${assembly.segments_used} ${from} with ${assembly.bridged_gaps_m.length} bridged gap(s) (max ${Math.max(...assembly.bridged_gaps_m)} m straight-line) — mileage across gaps is approximate.`,
    );
  }
  if (assembly.leftover_segments > 0) {
    out.push(
      `${assembly.leftover_segments} name-matching segment(s) could not be connected to the chain (disjoint or >50 m away) and were excluded.`,
    );
  }
  if (assembly.capped) {
    out.push("Chain stopped at the 30 mi assembly cap — the matched route continues beyond it.");
  }
  return out;
}

export const profileInputSchema = {
  points: z
    .array(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]))
    .min(2)
    .max(2000)
    .optional()
    .describe(
      "Polyline as [lat, lon] pairs (e.g. parsed from a GPX). Takes precedence over osm_id and trail_name.",
    ),
  osm_id: z
    .string()
    .optional()
    .describe(
      "OSM element id — 'way/123456', 'relation/123456', or a bare way id. Used when `points` is absent.",
    ),
  trail_name: z
    .string()
    .optional()
    .describe(
      "Trail name to resolve via OpenStreetMap near the lat/lon hint. Matches OSM name, alt_name, loc_name, official_name, and USFS trail number (ref). Lowest precedence.",
    ),
  lat: z.number().min(-90).max(90).optional().describe("Latitude hint — required with trail_name."),
  lon: z
    .number()
    .min(-180)
    .max(180)
    .optional()
    .describe("Longitude hint — required with trail_name."),
  radius_km: z
    .number()
    .min(0.5)
    .max(25)
    .default(5)
    .describe("Search radius around the hint for trail_name resolution. Default 5."),
};

export interface ResolvedPolyline {
  points: PolyPoint[];
  resolved_from: "points" | "osm_id" | "trail_name";
  /** Set when geometry came from OSM. */
  osm_id?: string;
  /** OSM name of the matched element, when resolved via OSM. */
  matched_name?: string;
  caveats: string[];
}

export interface ProfileArgs {
  points?: Array<[number, number]>;
  osm_id?: string;
  trail_name?: string;
  lat?: number;
  lon?: number;
  radius_km: number;
}

/** Returns the resolved polyline, or a caveat list explaining why not. */
export async function resolvePolyline(
  env: Env,
  args: ProfileArgs,
): Promise<ResolvedPolyline | { error: string }> {
  if (args.points && args.points.length >= 2) {
    return {
      points: args.points.map(([lat, lon]) => ({ lat, lon })),
      resolved_from: "points",
      caveats: [],
    };
  }

  if (args.osm_id) {
    const geom = await getOsmGeometry(env, args.osm_id);
    if (!geom) {
      return { error: `OSM element not found or has no geometry: ${args.osm_id}` };
    }
    const out: ResolvedPolyline = {
      points: geom.points,
      resolved_from: "osm_id",
      osm_id: geom.id,
      caveats: assemblyCaveats(geom.assembly),
    };
    if (geom.name) out.matched_name = geom.name;
    return out;
  }

  if (args.trail_name) {
    if (typeof args.lat !== "number" || typeof args.lon !== "number") {
      return { error: "trail_name resolution requires both lat and lon as a location hint." };
    }
    const bbox = bboxAroundPoint(args.lat, args.lon, args.radius_km);
    const geom = await findTrailGeometryByName(env, bbox, args.trail_name, {
      lat: args.lat,
      lon: args.lon,
    });
    if (!geom) {
      return {
        error:
          `No OSM trail matching "${args.trail_name}" within ${args.radius_km} km of ` +
          `(${args.lat}, ${args.lon}). Try get_route_info without a name filter to list nearby trails, or pass points/osm_id directly.`,
      };
    }
    const out: ResolvedPolyline = {
      points: geom.points,
      resolved_from: "trail_name",
      osm_id: geom.id,
      caveats: [
        ...assemblyCaveats(geom.assembly),
        "Full mapped line assembled from OSM — OSM coverage may end before the on-the-ground destination (upper-basin routes are often unmapped user tracks).",
      ],
    };
    if (geom.name) out.matched_name = geom.name;
    return out;
  }

  return { error: "Provide one of: points ([lat,lon] pairs), osm_id, or trail_name with lat/lon." };
}
