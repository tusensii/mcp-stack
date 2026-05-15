/**
 * get_route_info: trail/trailhead/water/elevation summary for a PNW area
 * or arbitrary lat/lon. Pulls in parallel from OpenStreetMap (Overpass)
 * and USGS 3DEP. Defensive — never throws out of the handler; if a
 * source fails it surfaces a caveat and returns whatever else worked.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Confidence, Env, Source, ToolPayload } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import { findAreaById } from "../areas.js";
import {
  findTrails,
  findTrailheads,
  findWaterSources,
  type Bbox,
  type OsmTrail,
  type OsmTrailhead,
  type OsmWaterSource,
} from "../sources/osm.js";
import { getElevation } from "../sources/usgs.js";
import { payloadResponse, roundCoord } from "./utils.js";

interface RouteInfoData {
  centroid: { lat: number; lon: number; area_id?: string; area_name?: string };
  bbox: Bbox;
  radius_km: number;
  trailheads: OsmTrailhead[];
  trails: OsmTrail[];
  /** Springs / drinking-water points within 500m of centroid. */
  water_sources_within_500m: OsmWaterSource[];
  /** Rivers, streams, springs anywhere within the search radius. Cap 25. */
  water_sources_in_area: OsmWaterSource[];
  centroid_elevation_ft: number | null;
  water_summary: string;
  driving_from_seattle_minutes?: number;
}

const STANDARD_CAVEATS = [
  "Trail data sourced from OpenStreetMap; verify with current trail map before trip.",
  "Elevation profile not computed — request lat/lon polyline for full profile.",
];

/** Earth radius in km for crude lat/lon ↔ km conversion. */
const KM_PER_DEG_LAT = 111.32;

function bboxAround(lat: number, lon: number, radius_km: number): Bbox {
  const dLat = radius_km / KM_PER_DEG_LAT;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = radius_km / (KM_PER_DEG_LAT * cosLat);
  return [
    roundCoord(lon - dLon, 5),
    roundCoord(lat - dLat, 5),
    roundCoord(lon + dLon, 5),
    roundCoord(lat + dLat, 5),
  ];
}

function haversineM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function registerRouteInfoTools(server: McpServer, env: Env): void {
  server.tool(
    "get_route_info",
    "Returns trailheads, trails, water sources, and centroid elevation around a PNW area or arbitrary point. Pulls from OpenStreetMap (trails, parking, springs, streams, rivers) and USGS 3DEP (elevation). Trails are trimmed to the longest 10 by estimated length. Returns both `water_sources_within_500m` (strict — for \"is there water near camp\") and `water_sources_in_area` (radius-wide — for \"what water do I cross on this trail\"). Use this for first-pass route scouting; ALWAYS verify with a real trail map (Green Trails, USGS quad, or CalTopo) before the trip — OSM trail data has gaps and labels can be wrong. If you already have an `area_id` from `find_areas` or a prior tool call, pass it directly to avoid re-resolution. USGS elevation is sometimes flaky; if `centroid_elevation_ft` is null the source is omitted from citations and a caveat is added — surface the missing elevation to the user rather than inventing one.",
    {
      area_id: z.string().optional().describe("Known PNW area id (e.g. 'enchantments'). Overrides lat/lon."),
      lat: z.number().min(-90).max(90).optional().describe("Latitude (decimal). Required if area_id absent."),
      lon: z.number().min(-180).max(180).optional().describe("Longitude (decimal). Required if area_id absent."),
      radius_km: z
        .number()
        .min(0.5)
        .max(25)
        .default(5)
        .describe("Search radius (km) around the centroid. Default 5."),
      trail_name: z
        .string()
        .optional()
        .describe("Optional trail-name substring filter (case-insensitive)."),
    },
    async ({ area_id, lat, lon, radius_km, trail_name }) => {
      let resolvedLat: number | undefined = lat;
      let resolvedLon: number | undefined = lon;
      let areaName: string | undefined;
      let driveMinutes: number | undefined;

      if (area_id) {
        const area = findAreaById(area_id);
        if (!area) {
          return payloadResponse(
            empty<RouteInfoData>([`Unknown area_id: ${area_id}`]),
          );
        }
        resolvedLat = area.centroid.lat;
        resolvedLon = area.centroid.lon;
        areaName = area.name;
        driveMinutes = Math.round(area.drive_hours_from_seattle * 60);
      }

      if (typeof resolvedLat !== "number" || typeof resolvedLon !== "number") {
        return payloadResponse(
          empty<RouteInfoData>(["Must provide either area_id or both lat and lon."]),
        );
      }

      const rlat = roundCoord(resolvedLat);
      const rlon = roundCoord(resolvedLon);
      const bbox = bboxAround(rlat, rlon, radius_km);

      const [trailsResult, trailheadsResult, waterResult, elevResult] = await Promise.all([
        findTrails(env, bbox).catch(() => null),
        findTrailheads(env, bbox).catch(() => null),
        findWaterSources(env, bbox).catch(() => null),
        getElevation(env, rlat, rlon).catch(() => null),
      ]);

      const caveats: string[] = [...STANDARD_CAVEATS];
      if (trailsResult === null) caveats.push("OSM trails unavailable.");
      if (trailheadsResult === null) caveats.push("OSM trailheads unavailable.");
      if (waterResult === null) caveats.push("OSM water sources unavailable.");
      if (elevResult === null || !Number.isFinite(elevResult?.elevation_ft ?? Number.NaN)) {
        caveats.push("USGS elevation unavailable.");
      }

      let trails: OsmTrail[] = trailsResult ?? [];
      if (trail_name) {
        const needle = trail_name.toLowerCase();
        trails = trails.filter((t) => t.name.toLowerCase().includes(needle));
      }
      // Trim to top 10 by length.
      trails = [...trails]
        .sort((a, b) => b.length_m_estimate - a.length_m_estimate)
        .slice(0, 10);

      const trailheads = trailheadsResult ?? [];
      const allWater = waterResult ?? [];

      // Filter water within ~500m of centroid. For point features (springs,
      // drinking_water) compare lat/lon. For ways (rivers, streams) the
      // entry has a `geometry` polyline — find the *closest* vertex,
      // because a 5-mile river that crosses the bbox would otherwise be
      // collapsed to its first vertex (which may be miles away). This
      // was the bug where the Suiattle River Trail returned 0 water.
      const center = { lat: rlat, lon: rlon };
      const minDistanceM = (w: OsmWaterSource): number | null => {
        if (w.geometry && w.geometry.length > 0) {
          let min = Infinity;
          for (const v of w.geometry) {
            const d = haversineM(center, v);
            if (d < min) min = d;
          }
          return Number.isFinite(min) ? min : null;
        }
        if (typeof w.lat === "number" && typeof w.lon === "number") {
          return haversineM(center, { lat: w.lat, lon: w.lon });
        }
        return null;
      };
      const water500: OsmWaterSource[] = allWater.filter((w) => {
        const d = minDistanceM(w);
        return d !== null && d <= 500;
      });

      // "In-area" view: anything OSM returned for the bbox. Useful for
      // questions like "is there water on this trip?" — the 500m filter
      // is too narrow when the area centroid is a peak summit.
      const waterInArea: OsmWaterSource[] = allWater.slice(0, 25);

      const springCountArea = allWater.filter(
        (w) => w.kind === "spring" || w.kind === "drinking_water",
      ).length;
      const streamCountArea = allWater.filter(
        (w) => w.kind === "stream" || w.kind === "river" || w.kind === "waterway" || w.kind === "water",
      ).length;
      const springCount500 = water500.filter(
        (w) => w.kind === "spring" || w.kind === "drinking_water",
      ).length;
      const water_summary =
        `${springCount500} springs / drinking-water points within 500m of centroid; ` +
        `${springCountArea} springs and ${streamCountArea} stream/river segments in the ${radius_km}km area.`;

      const centroidElev =
        elevResult && Number.isFinite(elevResult.elevation_ft)
          ? Math.round(elevResult.elevation_ft)
          : null;

      const sources: Source[] = [
        makeSource(
          "https://overpass-api.de/api/interpreter",
          "OpenStreetMap (Overpass API) — trails, trailheads, water",
          {
            license: "ODbL",
            confidence: trailsResult || trailheadsResult || waterResult ? "medium" : "low",
          },
        ),
      ];
      // Only cite USGS when it actually returned a value — earlier versions
      // claimed `confidence: "high"` even when elevation was null.
      if (centroidElev !== null) {
        sources.push(
          makeSource(
            "https://epqs.nationalmap.gov/v1/json",
            "USGS 3DEP elevation (EPQS)",
            { license: "public domain (US Govt)", confidence: "high" },
          ),
        );
      }

      const data: RouteInfoData = {
        centroid: {
          lat: rlat,
          lon: rlon,
          ...(area_id ? { area_id } : {}),
          ...(areaName ? { area_name: areaName } : {}),
        },
        bbox,
        radius_km,
        trailheads,
        trails,
        water_sources_within_500m: water500,
        water_sources_in_area: waterInArea,
        centroid_elevation_ft: centroidElev,
        water_summary,
        ...(typeof driveMinutes === "number" ? { driving_from_seattle_minutes: driveMinutes } : {}),
      };

      const confidence: Confidence = "medium";
      const payload: ToolPayload<RouteInfoData> = ok(data, sources, confidence, caveats);
      return payloadResponse(payload);
    },
  );
}
