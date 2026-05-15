/**
 * USGS clients:
 *  - 3DEP point elevation via EPQS (Elevation Point Query Service).
 *  - NHD (National Hydrography Dataset) flowlines via ArcGIS feature service.
 *
 * Both are public, no auth. Self-throttle on the elevation profile loop
 * since each point is one HTTP round-trip.
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { roundCoord, userAgent } from "../tools/utils.js";

const EPQS_URL = "https://epqs.nationalmap.gov/v1/json";
const NHD_FLOWLINE_URL =
  "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query";

const PROFILE_MAX_POINTS = 50;
const PROFILE_THROTTLE_MS = 200;

function client(env: Env) {
  return createFetchClient({
    userAgent: userAgent(env.CONTACT),
    defaultHeaders: { Accept: "application/json" },
    timeoutMs: 15_000,
    retries: 1,
  });
}

export interface ElevationPoint {
  elevation_ft: number;
  lat: number;
  lon: number;
}

interface EpqsResponse {
  value?: number | string | null;
  // Older endpoints used { USGS_Elevation_Point_Query_Service: { Elevation_Query: { Elevation } } }
  USGS_Elevation_Point_Query_Service?: {
    Elevation_Query?: { Elevation?: number | string };
  };
}

function parseElevation(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return Number.NaN;
}

export async function getElevation(
  env: Env,
  lat: number,
  lon: number,
): Promise<ElevationPoint> {
  const rlat = roundCoord(lat);
  const rlon = roundCoord(lon);
  const key = `usgs:elev:${rlat},${rlon}`;
  return cached(env, key, TTL.USGS, async () => {
    const c = client(env);
    const url = `${EPQS_URL}?x=${rlon}&y=${rlat}&units=Feet&output=json`;
    try {
      const res = await c.json<EpqsResponse>(url);
      let elev = parseElevation(res.value);
      if (!Number.isFinite(elev)) {
        elev = parseElevation(
          res.USGS_Elevation_Point_Query_Service?.Elevation_Query?.Elevation,
        );
      }
      return {
        elevation_ft: Number.isFinite(elev) ? elev : Number.NaN,
        lat: rlat,
        lon: rlon,
      };
    } catch {
      return { elevation_ft: Number.NaN, lat: rlat, lon: rlon };
    }
  });
}

export interface ElevationProfile {
  profile: ElevationPoint[];
  gain_ft: number;
  loss_ft: number;
  max_ft: number;
  min_ft: number;
}

export async function getElevationProfile(
  env: Env,
  points: Array<{ lat: number; lon: number }>,
): Promise<ElevationProfile> {
  const limited = points.slice(0, PROFILE_MAX_POINTS);
  const profile: ElevationPoint[] = [];
  for (let i = 0; i < limited.length; i++) {
    const p = limited[i]!;
    if (i > 0) {
      await new Promise<void>((r) => setTimeout(r, PROFILE_THROTTLE_MS));
    }
    const ep = await getElevation(env, p.lat, p.lon);
    profile.push(ep);
  }

  const validElevs = profile.map((p) => p.elevation_ft).filter((n) => Number.isFinite(n));
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!.elevation_ft;
    const b = profile[i]!.elevation_ft;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const d = b - a;
    if (d > 0) gain += d;
    else loss += -d;
  }
  return {
    profile,
    gain_ft: Math.round(gain),
    loss_ft: Math.round(loss),
    max_ft: validElevs.length > 0 ? Math.max(...validElevs) : Number.NaN,
    min_ft: validElevs.length > 0 ? Math.min(...validElevs) : Number.NaN,
  };
}

export interface NhdStream {
  id: string;
  name: string;
  ftype?: number;
  fcode?: number;
  /** Approximate length of the flowline geometry in meters, when supplied by the service. */
  length_km?: number;
}

interface NhdFeatureServiceResponse {
  features?: Array<{
    attributes?: {
      OBJECTID?: number;
      GNIS_NAME?: string;
      gnis_name?: string;
      Permanent_Identifier?: string;
      permanent_identifier?: string;
      FType?: number;
      ftype?: number;
      FCode?: number;
      fcode?: number;
      LengthKM?: number;
      lengthkm?: number;
    };
  }>;
}

/** Find NHD flowlines (streams/rivers) within `radius_m` of (lat, lon). */
export async function findNearbyStreams(
  env: Env,
  lat: number,
  lon: number,
  radius_m = 500,
): Promise<NhdStream[]> {
  const rlat = roundCoord(lat);
  const rlon = roundCoord(lon);
  const key = `usgs:nhd:${rlat},${rlon}:${radius_m}`;
  return cached(env, key, TTL.USGS, async () => {
    const c = client(env);
    const params = new URLSearchParams({
      f: "json",
      where: "1=1",
      geometry: JSON.stringify({
        x: rlon,
        y: rlat,
        spatialReference: { wkid: 4326 },
      }),
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: String(radius_m),
      units: "esriSRUnit_Meter",
      outFields: "OBJECTID,GNIS_NAME,Permanent_Identifier,FType,FCode,LengthKM",
      returnGeometry: "false",
    });
    try {
      const res = await c.json<NhdFeatureServiceResponse>(
        `${NHD_FLOWLINE_URL}?${params.toString()}`,
      );
      return (res.features ?? []).map((f) => {
        const a = f.attributes ?? {};
        const result: NhdStream = {
          id: String(a.Permanent_Identifier ?? a.permanent_identifier ?? a.OBJECTID ?? ""),
          name: a.GNIS_NAME ?? a.gnis_name ?? "",
        };
        const ftype = a.FType ?? a.ftype;
        const fcode = a.FCode ?? a.fcode;
        const len = a.LengthKM ?? a.lengthkm;
        if (typeof ftype === "number") result.ftype = ftype;
        if (typeof fcode === "number") result.fcode = fcode;
        if (typeof len === "number") result.length_km = len;
        return result;
      });
    } catch {
      return [];
    }
  });
}
