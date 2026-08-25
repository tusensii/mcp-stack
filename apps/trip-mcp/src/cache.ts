/**
 * Tiered TTL cache backed by KV. Tools call `cached(env, key, ttl, fn)`.
 * If KV is missing (local dev), it just calls `fn` every time.
 */

import type { Env } from "./types.js";

export interface CacheOptions<T> {
  /**
   * Return true to leave a value out of the cache.
   *
   * Exists because caching a failed upstream lookup is worse than not
   * caching at all: a single Overpass timeout used to persist as an
   * authoritative-looking empty result for the full 7-day TTL (#93).
   */
  skipCache?: (value: T) => boolean;
}

export async function cached<T>(
  env: Env,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
  options: CacheOptions<T> = {},
): Promise<T> {
  if (!env.CACHE) return fn();
  try {
    const hit = await env.CACHE.get(key, "json");
    if (hit !== null) return hit as T;
  } catch {
    // fall through to fresh fetch
  }
  const value = await fn();
  if (options.skipCache?.(value)) return value;
  try {
    await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch {
    // best-effort cache write
  }
  return value;
}

export const TTL = {
  RIDB_META: 60 * 60 * 24 * 7, // 7d
  RIDB_AVAIL: 60 * 5, // 5m
  NWS_POINT: 60 * 60 * 24 * 90, // 90d
  NWS_FORECAST: 60 * 60, // 1h
  NWS_ALERTS: 60 * 5, // 5m
  WTA_LIST: 60 * 60 * 24, // 24h
  WTA_REPORT: 60 * 60 * 24 * 7, // 7d
  WTA_AREA_LIST: 60 * 60, // 1h
  NPS_ALERTS: 60 * 60, // 1h
  USFS_ALERTS: 60 * 60 * 6, // 6h
  WSDOT_PASS: 60 * 15, // 15m
  WFIGS: 60 * 30, // 30m
  USGS: 60 * 60 * 24 * 30, // 30d
  OSM: 60 * 60 * 24 * 7, // 7d
  WEB: 60 * 60 * 24, // 24h
} as const;
