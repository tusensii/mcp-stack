/**
 * OSRM demo-server routing (issue #85 live drive times). Keyless, but
 * explicitly NO SLA and rate-limited — acceptable for personal use with
 * the caveat surfaced; degrade to the curated static estimate on any
 * failure. No Google/Mapbox keys by design.
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { userAgent } from "../tools/utils.js";

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

interface OsrmResponse {
  code?: string;
  routes?: Array<{ duration?: number; distance?: number }>;
}

export interface DriveEstimate {
  duration_min: number;
  distance_mi: number;
}

export async function getDriveTime(
  env: Env,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Promise<DriveEstimate | null> {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const key = `osrm:${r3(from.lat)},${r3(from.lon)}:${r3(to.lat)},${r3(to.lon)}`;
  return cached(env, key, TTL.USFS_ALERTS, async () => {
    const c = createFetchClient({
      userAgent: userAgent(env.CONTACT),
      defaultHeaders: { Accept: "application/json" },
      timeoutMs: 10_000,
      retries: 1,
    });
    const url = `${OSRM_URL}/${r3(from.lon)},${r3(from.lat)};${r3(to.lon)},${r3(to.lat)}?overview=false`;
    const res = await c.json<OsrmResponse>(url);
    const route = res.routes?.[0];
    if (res.code !== "Ok" || !route || typeof route.duration !== "number") return null;
    return {
      duration_min: Math.round(route.duration / 60),
      distance_mi: Math.round(((route.distance ?? 0) / 1609.344) * 10) / 10,
    };
  });
}
