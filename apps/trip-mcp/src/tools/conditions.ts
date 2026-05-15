/**
 * `get_conditions` MCP tool — composite area-conditions snapshot.
 *
 * Aggregates NPS alerts, WSDOT pass conditions, WFIGS active fire
 * perimeters, and InciWeb PNW incidents into one ToolPayload. Each
 * upstream source is wrapped in `safe()` so a single failure degrades
 * gracefully into a caveat instead of breaking the whole tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, Source, ToolPayload, Confidence } from "../types.js";
import { makeSource, nowIso, ok } from "../types.js";
import { findAreaById, type Area } from "../areas.js";
import { payloadResponse } from "./utils.js";
import { getNpsAlerts, type NpsAlert } from "../sources/nps.js";
import {
  getMountainPassConditions,
  findPassByName,
  type MountainPassCondition,
} from "../sources/wsdot.js";
import {
  getActiveFirePerimeters,
  getActiveIncidents,
  type ArcgisFeature,
  type ArcgisQueryResponse,
} from "../sources/wfigs.js";
import { getInciwebFeed, type InciwebItem } from "../sources/inciweb.js";

const ALL_PNW_PARK_CODES = ["mora", "noca", "olym", "crla"];

interface ConditionsData {
  area_id: string | null;
  center: { lat: number; lon: number } | null;
  bbox: [number, number, number, number] | null;
  nps_alerts: NpsAlert[];
  usfs_alerts: never[];
  pass_conditions: MountainPassCondition[];
  fire_perimeters: ArcgisFeature[];
  active_incidents: ArcgisFeature[];
  summary: string;
}

interface SafeResult<T> {
  data: T;
  ok: boolean;
  error?: string;
}

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<SafeResult<T>> {
  try {
    const data = await fn();
    return { data, ok: true };
  } catch (e) {
    return {
      data: fallback,
      ok: false,
      error: `${label}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Convert kilometers to a rough lat/lon delta. 1 deg latitude ~= 111 km;
 * longitude scales by cos(lat). Coarse but fine for bbox queries.
 */
function bboxFromCenter(
  lat: number,
  lon: number,
  radiusKm: number,
): [number, number, number, number] {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta];
}

const argsSchema = {
  area_id: z
    .string()
    .optional()
    .describe("Area ID from find_areas (e.g. 'mt_rainier'). If omitted, lat/lon required."),
  lat: z.number().optional().describe("Latitude in decimal degrees."),
  lon: z.number().optional().describe("Longitude in decimal degrees."),
  radius_km: z
    .number()
    .positive()
    .optional()
    .describe("Search radius in km for fire perimeters bbox. Default 25."),
  approach_passes: z
    .array(z.string())
    .optional()
    .describe(
      "WSDOT pass names to filter to. Defaults to area.approach_passes if area_id given, else all WA passes.",
    ),
};

export function registerConditionsTools(server: McpServer, env: Env): void {
  server.tool(
    "get_conditions",
    "Composite trip-conditions snapshot for a PNW area or arbitrary point. Aggregates: NPS park alerts, WSDOT mountain pass conditions for the area's approach passes, WFIGS active fire perimeters intersecting a bbox around the area, and InciWeb PNW fire incidents. Each upstream source is isolated — one failure degrades to a named caveat rather than failing the whole call. USFS forest-page alert scraping is not yet implemented; `usfs_alerts` is always [] (check fs.usda.gov manually for forest-specific alerts when this matters). Use this for \"is there a fire near my route\" or \"is the road over Stevens Pass open\" questions. If `wsdot.passes` returns an error, the caveat will name it explicitly — point the user at wsdot.wa.gov/travel/real-time/mountainpasses directly. For shoulder-season trips (Apr–Jun, Oct–Nov) ALWAYS call this tool — pass status determines whether the trailhead is even reachable.",
    argsSchema,
    async ({ area_id, lat, lon, radius_km, approach_passes }) => {
      const radius = radius_km ?? 25;

      let area: Area | undefined;
      let centerLat: number | undefined;
      let centerLon: number | undefined;
      if (area_id) {
        area = findAreaById(area_id);
        if (!area) {
          const payload: ToolPayload<null> = {
            data: null,
            sources: [],
            confidence: "low",
            caveats: [`Unknown area_id: ${area_id}`],
          };
          return payloadResponse(payload);
        }
        centerLat = area.centroid.lat;
        centerLon = area.centroid.lon;
      } else if (typeof lat === "number" && typeof lon === "number") {
        centerLat = lat;
        centerLon = lon;
      } else {
        const payload: ToolPayload<null> = {
          data: null,
          sources: [],
          confidence: "low",
          caveats: ["Must provide either area_id or both lat and lon."],
        };
        return payloadResponse(payload);
      }

      const bbox = bboxFromCenter(centerLat, centerLon, radius);

      const npsParkCodes =
        area?.nps_park_code ? [area.nps_park_code] : !area_id ? ALL_PNW_PARK_CODES : [];

      const passFilter =
        approach_passes && approach_passes.length > 0
          ? approach_passes
          : area?.approach_passes ?? null;

      const fetchedAt = nowIso();
      const sources: Source[] = [];
      const caveats: string[] = [];

      const [npsRes, wsdotRes, perimRes, incRes, inciwebRes] = await Promise.all([
        npsParkCodes.length > 0
          ? safe("nps_alerts", () => getNpsAlerts(env, npsParkCodes), { data: [], total: 0 })
          : Promise.resolve<SafeResult<{ data: NpsAlert[]; total: number }>>({
              data: { data: [], total: 0 },
              ok: true,
            }),
        safe<MountainPassCondition[]>(
          "wsdot_passes",
          () => getMountainPassConditions(env),
          [],
        ),
        safe<ArcgisQueryResponse>(
          "wfigs_perimeters",
          () => getActiveFirePerimeters(env, bbox),
          {},
        ),
        safe<ArcgisQueryResponse>("wfigs_incidents", () => getActiveIncidents(env), {}),
        safe<InciwebItem[]>("inciweb", () => getInciwebFeed(env), []),
      ]);

      // NPS
      if (npsParkCodes.length > 0) {
        sources.push(
          makeSource(
            `https://developer.nps.gov/api/v1/alerts?parkCode=${npsParkCodes.join(",")}`,
            "NPS Alerts API",
            { fetched_at: fetchedAt, license: "public-domain", confidence: "high" },
          ),
        );
        if (!npsRes.ok && npsRes.error) caveats.push(npsRes.error);
      }

      // WSDOT
      let passConditions: MountainPassCondition[] = wsdotRes.data;
      if (passFilter && passFilter.length > 0) {
        const matched: MountainPassCondition[] = [];
        for (const name of passFilter) {
          const m = findPassByName(passConditions, name);
          if (m && !matched.includes(m)) matched.push(m);
        }
        passConditions = matched;
      }
      sources.push(
        makeSource(
          "https://wsdot.wa.gov/Traffic/api/MountainPassConditions/MountainPassConditionsRest.svc/GetMountainPassConditionsAsJson",
          "WSDOT Mountain Pass Conditions",
          { fetched_at: fetchedAt, license: "public-domain", confidence: "high" },
        ),
      );
      if (!wsdotRes.ok && wsdotRes.error) caveats.push(wsdotRes.error);

      // WFIGS perimeters
      const firePerimeters = perimRes.data.features ?? [];
      sources.push(
        makeSource(
          "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0",
          "WFIGS Interagency Perimeters (Current)",
          { fetched_at: fetchedAt, license: "public-domain", confidence: "high" },
        ),
      );
      if (!perimRes.ok && perimRes.error) caveats.push(perimRes.error);

      // WFIGS incidents
      const activeIncidents = incRes.data.features ?? [];
      sources.push(
        makeSource(
          "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0",
          "WFIGS Incident Locations (Current)",
          { fetched_at: fetchedAt, license: "public-domain", confidence: "high" },
        ),
      );
      if (!incRes.ok && incRes.error) caveats.push(incRes.error);

      // InciWeb (we keep it as additional context but it isn't surfaced as a structured field)
      sources.push(
        makeSource("https://inciweb.wildfire.gov/incidents/rss.xml", "InciWeb RSS (PNW filter)", {
          fetched_at: fetchedAt,
          license: "public-domain",
          confidence: "medium",
        }),
      );
      if (!inciwebRes.ok && inciwebRes.error) caveats.push(inciwebRes.error);

      // Always-on caveat for deferred USFS alerts.
      caveats.push(
        "USFS forest-page scraping not yet implemented; check fs.usda.gov manually for forest-specific alerts.",
      );

      const failures = [npsRes, wsdotRes, perimRes, incRes, inciwebRes].filter((r) => !r.ok).length;
      const confidence: Confidence = failures === 0 ? "high" : "medium";

      const passSummary =
        passConditions.length === 0
          ? "no passes"
          : passConditions
              .map((p) => `${p.MountainPassName}: ${p.RoadCondition || "n/a"}`)
              .join("; ");
      const summary =
        `${npsRes.data.data.length} NPS alerts, ${firePerimeters.length} fires within ${radius} km, ` +
        `${activeIncidents.length} active PNW incidents, ${inciwebRes.data.length} InciWeb items; ` +
        `passes: ${passSummary}`;

      const data: ConditionsData = {
        area_id: area?.id ?? null,
        center: { lat: centerLat, lon: centerLon },
        bbox,
        nps_alerts: npsRes.data.data,
        usfs_alerts: [],
        pass_conditions: passConditions,
        fire_perimeters: firePerimeters,
        active_incidents: activeIncidents,
        summary,
      };

      return payloadResponse(ok<ConditionsData>(data, sources, confidence, caveats));
    },
  );
}
