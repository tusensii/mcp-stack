/**
 * NWAC avalanche forecasts via the National Avalanche Center's
 * avalanche.org v2 public API (keyless; the same API nwac.us's own site
 * consumes — informally documented, so parsing is defensive and any
 * failure degrades to a caveat pointing at nwac.us).
 *
 * Endpoints (verified live 2026-08-02):
 *  - map-layer: zone polygons + current danger + off_season flag
 *  - product?type=forecast&center_id=NWAC&zone_id=N: full forecast
 *    (danger by elevation band, problems, discussion). Off-season this
 *    returns a "summary" product (spring/fall statement).
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { userAgent } from "../tools/utils.js";

const MAP_LAYER_URL = "https://api.avalanche.org/v2/public/products/map-layer/NWAC";
const PRODUCT_URL = "https://api.avalanche.org/v2/public/product";

export const DANGER_LABELS: Record<number, string> = {
  1: "Low",
  2: "Moderate",
  3: "Considerable",
  4: "High",
  5: "Extreme",
};

export function dangerLabel(level: number | null): string {
  if (level === null || level < 1) return "No Rating";
  return DANGER_LABELS[level] ?? "No Rating";
}

function client(env: Env) {
  return createFetchClient({
    userAgent: userAgent(env.CONTACT),
    defaultHeaders: { Accept: "application/json" },
    timeoutMs: 15_000,
    retries: 1,
  });
}

export interface NwacZone {
  zone_id: number;
  name: string;
  off_season: boolean;
  danger: string;
  danger_level: number;
  link: string;
  travel_advice: string | null;
  /** MultiPolygon rings in [lon, lat] order, flattened to outer rings. */
  rings: Array<Array<[number, number]>>;
}

interface MapLayerFeature {
  id?: number;
  properties?: {
    name?: string;
    off_season?: boolean;
    danger?: string;
    danger_level?: number;
    link?: string;
    travel_advice?: string;
  };
  geometry?: { type?: string; coordinates?: unknown };
}

interface MapLayerResponse {
  features?: MapLayerFeature[];
}

function extractRings(geometry: MapLayerFeature["geometry"]): Array<Array<[number, number]>> {
  if (!geometry?.coordinates) return [];
  const rings: Array<Array<[number, number]>> = [];
  const coords = geometry.coordinates as unknown[];
  const pushRing = (ring: unknown) => {
    if (Array.isArray(ring) && ring.length > 2 && Array.isArray(ring[0])) {
      rings.push(ring as Array<[number, number]>);
    }
  };
  if (geometry.type === "Polygon") {
    pushRing(coords[0]);
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of coords) {
      if (Array.isArray(poly)) pushRing((poly as unknown[])[0]);
    }
  }
  return rings;
}

export async function getNwacZones(env: Env): Promise<NwacZone[]> {
  const key = "nwac:zones";
  return cached(env, key, TTL.USFS_ALERTS, async () => {
    const res = await client(env).json<MapLayerResponse>(MAP_LAYER_URL);
    return (res.features ?? [])
      .filter((f) => typeof f.id === "number" && f.properties?.name)
      .map((f) => ({
        zone_id: f.id!,
        name: f.properties!.name!,
        off_season: Boolean(f.properties?.off_season),
        danger: f.properties?.danger ?? "no rating",
        danger_level: f.properties?.danger_level ?? -1,
        link: f.properties?.link ?? "https://nwac.us/",
        travel_advice: f.properties?.travel_advice ?? null,
        rings: extractRings(f.geometry),
      }));
  });
}

/** Ray-casting point-in-polygon over [lon, lat] rings. */
export function pointInRings(
  lat: number,
  lon: number,
  rings: Array<Array<[number, number]>>,
): boolean {
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]![0];
      const yi = ring[i]![1];
      const xj = ring[j]![0];
      const yj = ring[j]![1];
      const intersects =
        yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

export interface NwacDangerBand {
  valid_day: string;
  band: "below_treeline" | "near_treeline" | "above_treeline";
  danger_level: number | null;
  danger_label: string;
}

export interface NwacProblem {
  name: string | null;
  likelihood: string | null;
  aspects_elevations: string[];
  size: string | null;
}

export interface NwacForecast {
  product_type: string | null;
  published_time: string | null;
  expires_time: string | null;
  bottom_line: string | null;
  hazard_discussion: string | null;
  danger_by_band: NwacDangerBand[];
  problems: NwacProblem[];
}

interface RawProduct {
  product_type?: string;
  published_time?: string;
  expires_time?: string;
  bottom_line?: string | null;
  hazard_discussion?: string | null;
  travel_advice?: string | null;
  danger?: Array<{
    lower?: number | null;
    middle?: number | null;
    upper?: number | null;
    valid_day?: string;
  }>;
  forecast_avalanche_problems?: Array<{
    name?: string;
    likelihood?: string;
    location?: string[];
    size?: string | string[];
  }>;
}

function stripHtml(s: string | null | undefined): string | null {
  if (!s) return null;
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function bandLevel(v: number | null | undefined): number | null {
  return typeof v === "number" && v >= 0 ? v : null;
}

export async function getNwacForecast(env: Env, zoneId: number): Promise<NwacForecast | null> {
  const key = `nwac:product:${zoneId}`;
  return cached(env, key, TTL.NWS_FORECAST, async () => {
    const url = `${PRODUCT_URL}?type=forecast&center_id=NWAC&zone_id=${zoneId}`;
    const res = await client(env).fetch(url);
    if (!res.ok) throw new Error(`nwac_http_${res.status}`);
    const text = await res.text();
    if (!text || text === "null") return null;
    let raw: RawProduct;
    try {
      raw = JSON.parse(text) as RawProduct;
    } catch {
      throw new Error("nwac_non_json");
    }

    const danger_by_band: NwacDangerBand[] = [];
    for (const d of raw.danger ?? []) {
      const day = d.valid_day ?? "current";
      const entries: Array<[NwacDangerBand["band"], number | null | undefined]> = [
        ["below_treeline", d.lower],
        ["near_treeline", d.middle],
        ["above_treeline", d.upper],
      ];
      for (const [band, v] of entries) {
        const level = bandLevel(v);
        danger_by_band.push({
          valid_day: day,
          band,
          danger_level: level,
          danger_label: dangerLabel(level),
        });
      }
    }

    return {
      product_type: raw.product_type ?? null,
      published_time: raw.published_time ?? null,
      expires_time: raw.expires_time ?? null,
      bottom_line: stripHtml(raw.bottom_line),
      hazard_discussion: stripHtml(raw.hazard_discussion),
      danger_by_band,
      problems: (raw.forecast_avalanche_problems ?? []).map((p) => ({
        name: p.name ?? null,
        likelihood: p.likelihood ?? null,
        aspects_elevations: Array.isArray(p.location) ? p.location : [],
        size: Array.isArray(p.size) ? p.size.join("–") : (p.size ?? null),
      })),
    };
  });
}
