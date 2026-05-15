/**
 * OpenStreetMap Overpass API client.
 *
 * Overpass is a community-run service. We are conservative:
 *  - Self-throttle to <=1 req/sec per Worker isolate.
 *  - Cache aggressively (TTL.OSM = 7d) — trail/parking geometry rarely changes.
 *  - Always identify ourselves with a descriptive User-Agent.
 *  - Defensive parsing — return empty arrays on any failure.
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { roundCoord, userAgent } from "../tools/utils.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** Bounding box [minLon, minLat, maxLon, maxLat]. */
export type Bbox = [number, number, number, number];

export interface OsmTrail {
  id: string;
  name: string;
  surface: string;
  length_m_estimate: number;
}

export interface OsmTrailhead {
  id: string;
  lat: number;
  lon: number;
  name: string;
  capacity?: number;
}

export interface OsmWaterSource {
  id: string;
  kind: "spring" | "drinking_water" | "water" | "stream" | "river" | "waterway";
  lat?: number;
  lon?: number;
  name?: string;
  /** For ways/relations (rivers, streams), the full polyline so callers
   *  can compute minimum distance to a point of interest. Without this,
   *  a river crossing a bbox collapses to its first vertex which may be
   *  miles from the trailhead. */
  geometry?: Array<{ lat: number; lon: number }>;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  /** Set when query uses `out center;` for ways/relations. */
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  members?: unknown[];
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

// --- Self-throttle (module-scoped) ---------------------------------------
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise<void>((r) => setTimeout(r, wait));
  }
  lastRequestAt = Date.now();
}

function client(env: Env) {
  return createFetchClient({
    userAgent: userAgent(env.CONTACT),
    defaultHeaders: { Accept: "application/json" },
    timeoutMs: 30_000,
    retries: 1,
  });
}

async function runOverpass(env: Env, query: string): Promise<OverpassElement[]> {
  await throttle();
  const c = client(env);
  try {
    const res = await c.fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return [];
    const json = (await res.json()) as OverpassResponse;
    return Array.isArray(json.elements) ? json.elements : [];
  } catch {
    return [];
  }
}

/** Round bbox for cache key stability. */
function bboxKey(b: Bbox): string {
  return b.map((n) => roundCoord(n, 3)).join(",");
}

/** Convert [minLon, minLat, maxLon, maxLat] → Overpass `(s,w,n,e)` tuple. */
function bboxAsSwne(b: Bbox): string {
  const [minLon, minLat, maxLon, maxLat] = b;
  // Overpass wants south,west,north,east
  return `${minLat},${minLon},${maxLat},${maxLon}`;
}

/** Haversine distance in meters between two lat/lon points. */
function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
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

function geomLengthM(geom: Array<{ lat: number; lon: number }> | undefined): number {
  if (!geom || geom.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < geom.length; i++) {
    total += haversineM(geom[i - 1]!, geom[i]!);
  }
  return Math.round(total);
}

// --- Public API ----------------------------------------------------------

export async function findTrails(env: Env, bbox: Bbox): Promise<OsmTrail[]> {
  const key = `osm:trails:${bboxKey(bbox)}`;
  return cached(env, key, TTL.OSM, async () => {
    const swne = bboxAsSwne(bbox);
    const query =
      `[out:json][timeout:25];` +
      `(` +
      `way["highway"~"path|footway|track"]["foot"!~"no"](${swne});` +
      `relation["route"="hiking"](${swne});` +
      `);` +
      `out tags geom;`;
    const elements = await runOverpass(env, query);
    return elements.map((el) => ({
      id: `${el.type}/${el.id}`,
      name: el.tags?.name ?? el.tags?.ref ?? "",
      surface: el.tags?.surface ?? el.tags?.["trail_visibility"] ?? "",
      length_m_estimate: geomLengthM(el.geometry),
    }));
  });
}

export async function findTrailheads(env: Env, bbox: Bbox): Promise<OsmTrailhead[]> {
  const key = `osm:trailheads:${bboxKey(bbox)}`;
  return cached(env, key, TTL.OSM, async () => {
    const swne = bboxAsSwne(bbox);
    // Broaden the trailhead query: many real PNW trailheads are tagged
    // simply `amenity=parking` (without `hiking=yes`) at the end of a
    // forest road, or `highway=trailhead`, or `tourism=information`
    // without `information=trailhead`. The earlier narrow query missed
    // the Suiattle River trailhead at the end of FR-49, which is just
    // `amenity=parking`.
    const query =
      `[out:json][timeout:25];` +
      `(` +
      `node["amenity"="parking"]["hiking"="yes"](${swne});` +
      `node["amenity"="parking"]["access"!="private"]["access"!="no"](${swne});` +
      `way["amenity"="parking"]["access"!="private"]["access"!="no"](${swne});` +
      `node["highway"="trailhead"](${swne});` +
      `node["tourism"="information"](${swne});` +
      `);` +
      `out tags center;`;
    const elements = await runOverpass(env, query);
    return elements
      .map((el) => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (typeof lat !== "number" || typeof lon !== "number") return null;
        const cap = el.tags?.capacity;
        const result: OsmTrailhead = {
          id: `${el.type}/${el.id}`,
          lat,
          lon,
          name: el.tags?.name ?? el.tags?.["operator"] ?? "",
        };
        const n = cap ? Number.parseInt(cap, 10) : NaN;
        if (!Number.isNaN(n)) result.capacity = n;
        return result;
      })
      .filter((t): t is OsmTrailhead => t !== null);
  });
}

export async function findWaterSources(env: Env, bbox: Bbox): Promise<OsmWaterSource[]> {
  const key = `osm:water:${bboxKey(bbox)}`;
  return cached(env, key, TTL.OSM, async () => {
    const swne = bboxAsSwne(bbox);
    const query =
      `[out:json][timeout:25];` +
      `(` +
      `node["natural"="spring"](${swne});` +
      `node["amenity"="drinking_water"](${swne});` +
      `way["natural"="water"](${swne});` +
      `way["waterway"~"stream|river"](${swne});` +
      `);` +
      `out tags geom;`;
    const elements = await runOverpass(env, query);
    return elements.map((el) => {
      const tags = el.tags ?? {};
      let kind: OsmWaterSource["kind"] = "waterway";
      if (tags.natural === "spring") kind = "spring";
      else if (tags.amenity === "drinking_water") kind = "drinking_water";
      else if (tags.natural === "water") kind = "water";
      else if (tags.waterway === "stream") kind = "stream";
      else if (tags.waterway === "river") kind = "river";

      let lat = el.lat;
      let lon = el.lon;
      if ((lat === undefined || lon === undefined) && el.geometry && el.geometry.length > 0) {
        const first = el.geometry[0]!;
        lat = first.lat;
        lon = first.lon;
      }

      const out: OsmWaterSource = {
        id: `${el.type}/${el.id}`,
        kind,
      };
      if (typeof lat === "number") out.lat = lat;
      if (typeof lon === "number") out.lon = lon;
      if (tags.name) out.name = tags.name;
      if (el.geometry && el.geometry.length > 0) out.geometry = el.geometry;
      return out;
    });
  });
}
