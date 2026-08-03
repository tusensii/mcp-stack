/**
 * get_avalanche_forecast: NWAC zone forecasts with danger by elevation
 * band. Registry areas map statically to NWAC zone names (primary
 * first); point queries resolve via the map-layer polygons. Off-season
 * (roughly May–Oct) returns an explicit no-forecast status, never an
 * error.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Confidence, Env, Source, ToolPayload } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import { findAreaById, type RangerStation } from "../areas.js";
import {
  getNwacForecast,
  getNwacZones,
  pointInRings,
  type NwacDangerBand,
  type NwacProblem,
  type NwacZone,
} from "../sources/nwac.js";
import { payloadResponse, titledTool } from "./utils.js";

/**
 * Registry area → NWAC zone names, primary first. Names are matched
 * against the live map-layer at call time so numeric zone ids can churn
 * without breaking this table.
 */
export const AREA_NWAC_ZONES: Record<string, string[]> = {
  enchantments: ["East Slopes Central", "Stevens Pass"],
  mt_rainier: ["West Slopes South"],
  north_cascades: ["West Slopes North", "East Slopes North"],
  olympic: ["Olympics"],
  glacier_peak: ["West Slopes North", "East Slopes North"],
  pasayten: ["East Slopes North"],
  alpine_lakes: ["Snoqualmie Pass", "Stevens Pass"],
  henry_jackson: ["Stevens Pass", "West Slopes Central"],
  goat_rocks: ["West Slopes South", "East Slopes South"],
  mt_st_helens: ["West Slopes South"],
  mt_adams: ["East Slopes South"],
  mt_baker: ["West Slopes North"],
};

interface ZoneReport {
  zone_name: string;
  zone_id: number;
  status: "forecast" | "off_season" | "unavailable";
  link: string;
  published_time?: string | null;
  expires_time?: string | null;
  bottom_line?: string | null;
  travel_advice?: string | null;
  hazard_discussion?: string | null;
  /** Chart-ready: one row per valid_day × elevation band. */
  danger_by_band?: NwacDangerBand[];
  problems?: NwacProblem[];
}

interface AvalancheData {
  area_id: string | null;
  zones: ZoneReport[];
  season_note: string;
  ranger_stations: RangerStation[];
}

const SEASON_NOTE =
  "NWAC forecasts are issued roughly Nov–Apr. Outside the season, avalanche hazard still exists on steep snow (early/late-season storm slabs, spring wet slides, glacial terrain) — assess on the ground and check nwac.us for statements.";

export function registerAvalancheTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_avalanche_forecast",
    "Checking avalanche forecast…",
    "NWAC avalanche zone forecast(s) with danger by elevation band. Pass a registry `area_id` (mapped to its NWAC zone(s), primary first — some areas span two zones) or lat/lon (resolved via zone polygons). In season (~Nov–Apr): danger ratings per band as chart-ready rows {valid_day, band, danger_level (1–5 or null), danger_label (Low/Moderate/Considerable/High/Extreme)}, avalanche problems (type, aspects/elevations, likelihood, size), bottom line, and discussion. Ratings are never invented — bands the forecast omits come back null/'No Rating'. OFF-SEASON: returns status 'off_season' with the season note rather than an error — steep snow can still slide in summer; that status is not an all-clear. Safety framing: this surfaces the forecast, it does not make go/no-go calls — pair with get_safety_brief's ranger contacts for terrain-specific questions.",
    {
      area_id: z.string().optional().describe("Registry area id (e.g. 'mt_baker'). Overrides lat/lon."),
      lat: z.number().min(-90).max(90).optional().describe("Latitude — resolved via NWAC zone polygons."),
      lon: z.number().min(-180).max(180).optional().describe("Longitude."),
    },
    async ({ area_id, lat, lon }) => {
      const fetchedAt = new Date().toISOString();
      const caveats: string[] = [];
      const sources: Source[] = [
        makeSource(
          "https://api.avalanche.org/v2/public/products/map-layer/NWAC",
          "Northwest Avalanche Center via avalanche.org",
          { license: "public", confidence: "high", fetched_at: fetchedAt },
        ),
      ];

      let zones: NwacZone[];
      try {
        zones = await getNwacZones(env);
      } catch (e) {
        return payloadResponse(
          empty<AvalancheData>(
            [
              `nwac_map_layer: ${e instanceof Error ? e.message : String(e)} — check nwac.us/avalanche-forecast directly.`,
            ],
            sources,
          ),
        );
      }

      let matched: NwacZone[] = [];
      let rangerStations: RangerStation[] = [];
      if (area_id) {
        const area = findAreaById(area_id);
        if (!area) {
          return payloadResponse(empty<AvalancheData>([`Unknown area_id: ${area_id}`]));
        }
        rangerStations = area.ranger_stations;
        const wanted = AREA_NWAC_ZONES[area_id];
        if (!wanted) {
          caveats.push(`No NWAC zone mapping for ${area_id} — falling back to polygon lookup at the area centroid.`);
          matched = zones.filter((zone) =>
            pointInRings(area.centroid.lat, area.centroid.lon, zone.rings),
          );
        } else {
          // Preserve mapping order (primary first).
          matched = wanted
            .map((name) => zones.find((zone) => zone.name.toLowerCase() === name.toLowerCase()))
            .filter((zone): zone is NwacZone => zone !== undefined);
          const missing = wanted.filter(
            (name) => !zones.some((zone) => zone.name.toLowerCase() === name.toLowerCase()),
          );
          if (missing.length > 0) {
            caveats.push(`Mapped NWAC zone(s) not found in the live zone list: ${missing.join(", ")}.`);
          }
        }
      } else if (typeof lat === "number" && typeof lon === "number") {
        matched = zones.filter((zone) => pointInRings(lat, lon, zone.rings));
        if (matched.length === 0) {
          caveats.push("Point is outside all NWAC zone polygons — NWAC covers WA and the Mt Hood area only.");
        }
      } else {
        return payloadResponse(empty<AvalancheData>(["Provide area_id or both lat and lon."]));
      }

      if (matched.length === 0) {
        return payloadResponse(
          empty<AvalancheData>([...caveats, "No NWAC zone resolved for this query."], sources),
        );
      }

      const reports: ZoneReport[] = await Promise.all(
        matched.map(async (zone): Promise<ZoneReport> => {
          if (zone.off_season) {
            // Still try the product endpoint — off-season it often carries
            // the spring/fall statement worth surfacing.
            let discussion: string | null = null;
            try {
              const product = await getNwacForecast(env, zone.zone_id);
              discussion = product?.hazard_discussion ?? null;
            } catch {
              // statement is a bonus; off_season status stands on its own
            }
            return {
              zone_name: zone.name,
              zone_id: zone.zone_id,
              status: "off_season",
              link: zone.link,
              ...(discussion ? { hazard_discussion: discussion } : {}),
            };
          }
          try {
            const product = await getNwacForecast(env, zone.zone_id);
            if (!product) {
              return { zone_name: zone.name, zone_id: zone.zone_id, status: "unavailable", link: zone.link };
            }
            return {
              zone_name: zone.name,
              zone_id: zone.zone_id,
              status: "forecast",
              link: zone.link,
              published_time: product.published_time,
              expires_time: product.expires_time,
              bottom_line: product.bottom_line,
              travel_advice: zone.travel_advice,
              hazard_discussion: product.hazard_discussion,
              danger_by_band: product.danger_by_band,
              problems: product.problems,
            };
          } catch (e) {
            caveats.push(
              `nwac_forecast (${zone.name}): ${e instanceof Error ? e.message : String(e)} — see ${zone.link}.`,
            );
            return { zone_name: zone.name, zone_id: zone.zone_id, status: "unavailable", link: zone.link };
          }
        }),
      );

      sources.push(
        makeSource("https://nwac.us/avalanche-forecast/", "NWAC forecast pages", {
          license: "public",
          confidence: "high",
          fetched_at: fetchedAt,
        }),
      );

      const anyForecast = reports.some((r) => r.status === "forecast");
      const data: AvalancheData = {
        area_id: area_id ?? null,
        zones: reports,
        season_note: SEASON_NOTE,
        ranger_stations: rangerStations,
      };
      const confidence: Confidence = anyForecast
        ? "high"
        : reports.every((r) => r.status === "off_season")
          ? "medium"
          : "low";
      return payloadResponse(ok(data, sources, confidence, caveats));
    },
  );
}
