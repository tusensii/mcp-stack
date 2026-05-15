/**
 * Wildland Fire Interagency Geospatial Services (WFIGS) ArcGIS Feature Service.
 *
 * Public, no auth. Two endpoints used:
 *  - WFIGS_Interagency_Perimeters_Current (active fire polygons)
 *  - WFIGS_Incident_Locations_Current (incident point/metadata)
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { userAgent } from "../tools/utils.js";

const PERIMETERS_URL =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query";
const INCIDENTS_URL =
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query";

/** Pacific Northwest default bounding box: WA + OR + ID. */
export const PNW_BBOX: [number, number, number, number] = [-125, 42, -116, 49.5];

export interface ArcgisFeature {
  attributes?: Record<string, unknown>;
  geometry?: Record<string, unknown>;
}

export interface ArcgisQueryResponse {
  features?: ArcgisFeature[];
  exceededTransferLimit?: boolean;
  error?: { code?: number; message?: string };
}

function client(env: Env) {
  return createFetchClient({
    userAgent: userAgent(env.CONTACT),
    defaultHeaders: { Accept: "application/json" },
    timeoutMs: 20_000,
    retries: 1,
  });
}

export async function getActiveFirePerimeters(
  env: Env,
  bbox?: [number, number, number, number],
): Promise<ArcgisQueryResponse> {
  const box = bbox ?? PNW_BBOX;
  const key = `wfigs:perimeters:${box.join(",")}`;
  return cached(env, key, TTL.WFIGS, async () => {
    const c = client(env);
    const params = new URLSearchParams({
      f: "json",
      where: "1=1",
      outFields: "*",
      geometryType: "esriGeometryEnvelope",
      geometry: box.join(","),
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outSR: "4326",
    });
    const url = `${PERIMETERS_URL}?${params.toString()}`;
    return c.json<ArcgisQueryResponse>(url);
  });
}

export async function getActiveIncidents(env: Env): Promise<ArcgisQueryResponse> {
  const key = "wfigs:incidents:pnw";
  return cached(env, key, TTL.WFIGS, async () => {
    const c = client(env);
    // Filter to WA/OR/ID by POOState — narrows from full national set.
    const where = "IncidentTypeCategory='WF' AND POOState IN ('US-WA','US-OR','US-ID')";
    const params = new URLSearchParams({
      f: "json",
      where,
      outFields: "IncidentName,DailyAcres,PercentContained,FireDiscoveryDateTime,POOState",
    });
    const url = `${INCIDENTS_URL}?${params.toString()}`;
    return c.json<ArcgisQueryResponse>(url);
  });
}
