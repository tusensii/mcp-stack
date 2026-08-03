/**
 * get_river_conditions: USGS gauge data for crossing assessment.
 *
 * Registry areas carry curated crossing→gauge mappings; anything else
 * falls back to bbox gauge discovery with an explicit relevance caveat.
 * Gauges indicate TREND, not crossability — output never judges a
 * crossing "safe", and the ranger-station pointer rides along per the
 * app's safety convention.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Confidence, Env, Source, ToolPayload } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import { findAreaById, type RangerStation } from "../areas.js";
import {
  discoverGauges,
  flowContext,
  getDailyStats,
  getGauges,
  type FlowContext,
  type GaugeSeriesPoint,
} from "../sources/usgs_water.js";
import { bboxAroundPoint } from "../polyline.js";
import { payloadResponse, titledTool } from "./utils.js";

interface GaugeReport {
  site_id: string;
  site_name: string;
  lat: number | null;
  lon: number | null;
  crossing?: string;
  crossing_note?: string;
  discharge_cfs: number | null;
  gage_height_ft: number | null;
  reading_time: string | null;
  flow_context: FlowContext;
  flow_context_detail: string | null;
  /** 7-day chart-ready series {time_iso, discharge_cfs}. */
  series: GaugeSeriesPoint[];
}

interface RiverConditionsData {
  area_id: string | null;
  gauges: GaugeReport[];
  gauge_relevance: "curated" | "discovered";
  ranger_stations: RangerStation[];
  provenance: {
    discharge: string;
    flow_context: string;
  };
}

const SAFETY_CAVEATS = [
  "Gauges indicate flow TREND, not crossability — no reading makes a specific crossing safe. Glacial streams pulse in the afternoon; cross in the morning.",
  "Call the ranger station for current crossing conditions before committing to a route with major fords.",
];

export function registerRiverConditionsTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_river_conditions",
    "Reading river gauges…",
    "USGS stream-gauge data for river-crossing assessment. Pass `area_id` for curated crossing→gauge mappings (Glacier Peak's Sauk/Suiattle corridors, Olympic's Elwha/Quinault, Enchantments' Icicle, etc.), or lat/lon + radius_km for nearest-gauge discovery — discovered gauges carry a caveat that gauge-to-crossing relevance is UNVERIFIED (a downstream gauge may not represent the crossing). Per gauge: current discharge (cfs) + gage height (ft), a 7-day chart-ready `series` of {time_iso, discharge_cfs}, and `flow_context` (low/normal/elevated/high) from historical percentiles for this date when USGS statistics exist. Rising limb + elevated/high context = postpone fords. This tool NEVER judges a crossing safe — surface the flow context and trend, then point at the ranger station (included in the response for registry areas).",
    {
      area_id: z.string().optional().describe("Registry area id (e.g. 'glacier_peak') — uses curated crossing→gauge mappings."),
      lat: z.number().min(-90).max(90).optional().describe("Latitude for gauge discovery when area_id is absent."),
      lon: z.number().min(-180).max(180).optional().describe("Longitude for gauge discovery when area_id is absent."),
      radius_km: z.number().min(1).max(50).default(25).describe("Discovery radius (km). Default 25."),
      max_gauges: z.number().int().min(1).max(10).default(5).describe("Max gauges returned in discovery mode. Default 5."),
    },
    async ({ area_id, lat, lon, radius_km, max_gauges }) => {
      const fetchedAt = new Date().toISOString();
      const caveats: string[] = [...SAFETY_CAVEATS];
      const sources: Source[] = [
        makeSource(
          "https://waterservices.usgs.gov/nwis/iv/",
          "USGS NWIS Instantaneous Values",
          { license: "public domain (US Govt)", confidence: "high", fetched_at: fetchedAt },
        ),
      ];

      let curated: Array<{ site: string; crossing: string; note?: string }> = [];
      let rangerStations: RangerStation[] = [];
      let relevance: "curated" | "discovered" = "discovered";
      let centerLat = lat;
      let centerLon = lon;

      if (area_id) {
        const area = findAreaById(area_id);
        if (!area) {
          return payloadResponse(empty<RiverConditionsData>([`Unknown area_id: ${area_id}`]));
        }
        rangerStations = area.ranger_stations;
        centerLat = area.centroid.lat;
        centerLon = area.centroid.lon;
        if (area.crossings && area.crossings.length > 0) {
          relevance = "curated";
          curated = area.crossings.map((c) => ({
            site: c.gauge_site_id,
            crossing: c.name,
            ...(c.note ? { note: c.note } : {}),
          }));
        } else {
          caveats.push(
            `No curated crossing→gauge mappings for ${area_id} yet — falling back to nearest-gauge discovery; gauge-to-crossing relevance is UNVERIFIED.`,
          );
        }
      }

      if (curated.length === 0) {
        if (typeof centerLat !== "number" || typeof centerLon !== "number") {
          return payloadResponse(
            empty<RiverConditionsData>(["Provide area_id or both lat and lon."]),
          );
        }
        if (!area_id) {
          caveats.push(
            "Discovered gauges are nearest-by-bbox; gauge-to-crossing relevance is UNVERIFIED — a downstream gauge may not represent conditions at your crossing.",
          );
        }
      }

      // Resolve site list: curated ids, or discovery.
      let siteIds: string[];
      const crossingBySite = new Map<string, { crossing: string; note?: string }>();
      if (curated.length > 0) {
        siteIds = curated.map((c) => c.site);
        for (const c of curated) {
          crossingBySite.set(c.site, { crossing: c.crossing, ...(c.note ? { note: c.note } : {}) });
        }
      } else {
        try {
          const bbox = bboxAroundPoint(centerLat!, centerLon!, radius_km);
          const found = await discoverGauges(env, bbox);
          siteIds = found.slice(0, max_gauges).map((g) => g.site_id);
          if (siteIds.length === 0) {
            return payloadResponse(
              empty<RiverConditionsData>(
                [`No active USGS discharge gauges within ${radius_km} km.`, ...caveats],
                sources,
              ),
            );
          }
        } catch (e) {
          return payloadResponse(
            empty<RiverConditionsData>(
              [`usgs_discovery: ${e instanceof Error ? e.message : String(e)}`, ...caveats],
              sources,
            ),
          );
        }
      }

      // Fetch gauge data, then per-gauge percentile context (isolated).
      let gauges: GaugeReport[];
      try {
        const data = await getGauges(env, siteIds);
        gauges = await Promise.all(
          data.map(async (g): Promise<GaugeReport> => {
            let context: FlowContext = "unknown";
            let detail: string | null = null;
            try {
              const stats = await getDailyStats(env, g.site_id);
              const now = new Date(
                new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
              );
              const stat = stats.get(`${now.getMonth() + 1}-${now.getDate()}`);
              const fc = flowContext(g.discharge_cfs, stat);
              context = fc.context;
              detail = fc.detail;
              if (context === "unknown") {
                caveats.push(
                  `flow_context unavailable for ${g.site_id} — no historical statistics for this site/date.`,
                );
              }
            } catch (e) {
              caveats.push(
                `usgs_stats (${g.site_id}): ${e instanceof Error ? e.message : String(e)} — flow_context unknown.`,
              );
            }
            const curatedInfo = crossingBySite.get(g.site_id);
            return {
              site_id: g.site_id,
              site_name: g.site_name,
              lat: g.lat,
              lon: g.lon,
              ...(curatedInfo ? { crossing: curatedInfo.crossing } : {}),
              ...(curatedInfo?.note ? { crossing_note: curatedInfo.note } : {}),
              discharge_cfs: g.discharge_cfs,
              gage_height_ft: g.gage_height_ft,
              reading_time: g.reading_time,
              flow_context: context,
              flow_context_detail: detail,
              series: g.series,
            };
          }),
        );
      } catch (e) {
        return payloadResponse(
          empty<RiverConditionsData>(
            [`usgs_iv: ${e instanceof Error ? e.message : String(e)}`, ...caveats],
            sources,
          ),
        );
      }

      const missing = siteIds.filter((s) => !gauges.some((g) => g.site_id === s));
      for (const m of missing) {
        caveats.push(`Gauge ${m} returned no data (inactive or ice-affected) — omitted.`);
      }

      sources.push(
        makeSource(
          "https://waterservices.usgs.gov/nwis/stat/",
          "USGS NWIS Daily Statistics (historical percentiles)",
          { license: "public domain (US Govt)", confidence: "high", fetched_at: fetchedAt },
        ),
      );

      const data: RiverConditionsData = {
        area_id: area_id ?? null,
        gauges,
        gauge_relevance: relevance,
        ranger_stations: rangerStations,
        provenance: {
          discharge: "USGS real-time gauge observation (provisional data, subject to revision)",
          flow_context: "derived from USGS daily statistics percentiles for this calendar date",
        },
      };
      const confidence: Confidence = gauges.length > 0 ? "high" : "low";
      return payloadResponse(ok(data, sources, confidence, caveats));
    },
  );
}
