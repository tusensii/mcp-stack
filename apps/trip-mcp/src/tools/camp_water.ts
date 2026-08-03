/**
 * get_camp_water_beta: overnight camp + water beta. Two layers —
 * curated registry data (regulation model, named camps, sourced fire/
 * food rules, late-season water reliability) and a live OSM campsite
 * query. References get_safety_brief (bear practice) and get_permits
 * rather than duplicating them.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import { findAreaById } from "../areas.js";
import { CAMPING, type Camping } from "../camping.js";
import { findCampsites, type OsmCampsite } from "../sources/osm.js";
import { bboxAroundPoint } from "../polyline.js";
import { payloadResponse, titledTool } from "./utils.js";

const OSM_CAVEAT =
  "mapped_sites comes from OpenStreetMap and is incomplete AND unofficial: many legal dispersed sites are unmapped, and many mapped pitches are unofficial or closed — the curated regulation model governs what's legal.";

interface CampWaterData {
  area_id: string;
  area_name: string;
  camping: Camping | null;
  mapped_sites: OsmCampsite[];
}

export function registerCampWaterTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_camp_water_beta",
    "Checking camp and water beta…",
    "Overnight camp + water beta for a registry area. Curated layer: regulation_model (designated_sites_only | zone_quota | dispersed_with_rules) with detail, named_camps for designated-site areas, fire_rules and food_storage each citing the governing source URL (never bare fact), and late-season water_reliability notes (LOW confidence — verify against recent trip reports). Live layer: `mapped_sites` from OSM (tourism=camp_site/camp_pitch, backcountry flag) — incomplete and unofficial; the regulation model governs legality. Cross-references by design: bear/wildlife practice lives in get_safety_brief, permits in get_permits/get_permit_strategy. Day-hike parity: nothing here is assumed by other tools.",
    {
      area_id: z.string().describe("Registry area id (e.g. 'enchantments')."),
      radius_km: z
        .number()
        .min(1)
        .max(30)
        .default(15)
        .describe("OSM campsite search radius around the area centroid. Default 15."),
    },
    async ({ area_id, radius_km }) => {
      const area = findAreaById(area_id);
      if (!area) {
        return payloadResponse(
          empty<CampWaterData>([
            `Unknown area_id: ${area_id}. Camp/water beta is registry-curated — for off-registry trails use get_route_info's water layer + recent trip reports.`,
          ]),
        );
      }

      const caveats: string[] = [OSM_CAVEAT];
      const sources = [
        makeSource(
          "https://github.com/tusensii/mcp-stack/blob/main/apps/trip-mcp/src/camping.ts",
          "trip-mcp curated camping registry",
          { confidence: "medium" },
        ),
      ];

      const camping = CAMPING[area_id] ?? null;
      if (!camping) {
        caveats.push(`No curated camping data for ${area_id} yet — explicit empty status; the OSM layer below is all that's available.`);
      } else {
        caveats.push(
          "water_reliability notes are curated and LOW confidence — verify against recent trip reports (get_trip_reports with extract_conditions).",
        );
        sources.push(
          makeSource(camping.fire_rules.source_url, "Governing fire/food-storage regulations", {
            confidence: "medium",
          }),
        );
      }

      let mappedSites: OsmCampsite[] = [];
      try {
        const bbox = bboxAroundPoint(area.centroid.lat, area.centroid.lon, radius_km);
        mappedSites = (await findCampsites(env, bbox)).slice(0, 50);
        sources.push(
          makeSource("https://overpass-api.de/api/interpreter", "OpenStreetMap (Overpass API) — mapped campsites", {
            license: "ODbL",
            confidence: "low",
          }),
        );
      } catch (e) {
        caveats.push(`osm_campsites: ${e instanceof Error ? e.message : String(e)} — mapped_sites empty.`);
      }

      const data: CampWaterData = {
        area_id,
        area_name: area.name,
        camping,
        mapped_sites: mappedSites,
      };
      return payloadResponse(ok(data, sources, camping ? "medium" : "low", caveats));
    },
  );
}
