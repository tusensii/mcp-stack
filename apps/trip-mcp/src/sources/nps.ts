/**
 * National Park Service (developer.nps.gov) client.
 *
 * Auth: NPS accepts the API key in either the `Authorization` header or
 * `X-Api-Key` header. We use `X-Api-Key` per task spec.
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { userAgent } from "../tools/utils.js";

const BASE_URL = "https://developer.nps.gov/api/v1";

function client(env: Env) {
  return createFetchClient({
    baseUrl: BASE_URL,
    userAgent: userAgent(env.CONTACT),
    defaultHeaders: {
      "X-Api-Key": env.NPS_API_KEY,
      Accept: "application/json",
    },
    timeoutMs: 15_000,
    retries: 1,
  });
}

export interface NpsAlert {
  id?: string;
  url?: string;
  title?: string;
  parkCode?: string;
  description?: string;
  category?: string;
  lastIndexedDate?: string;
}

export interface NpsAlertsResponse {
  data: NpsAlert[];
  total: number;
}

interface RawAlertsResponse {
  total?: string | number;
  data?: NpsAlert[];
}

export async function getNpsAlerts(
  env: Env,
  parkCodes: string[],
): Promise<NpsAlertsResponse> {
  const codes = parkCodes
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
  const key = `nps:alerts:${codes}`;
  return cached(env, key, TTL.NPS_ALERTS, async () => {
    const c = client(env);
    const path = `/alerts?parkCode=${encodeURIComponent(codes)}&limit=50`;
    const res = await c.json<RawAlertsResponse>(path);
    return {
      data: res.data ?? [],
      total: typeof res.total === "string" ? Number.parseInt(res.total, 10) || 0 : res.total ?? 0,
    };
  });
}

export interface NpsPark {
  id?: string;
  url?: string;
  fullName?: string;
  parkCode?: string;
  description?: string;
  designation?: string;
  states?: string;
  latLong?: string;
  weatherInfo?: string;
  directionsInfo?: string;
  [key: string]: unknown;
}

interface RawParksResponse {
  total?: string | number;
  data?: NpsPark[];
}

export async function getNpsPark(env: Env, parkCode: string): Promise<NpsPark | null> {
  const code = parkCode.trim().toLowerCase();
  const key = `nps:park:${code}`;
  return cached(env, key, TTL.RIDB_META, async () => {
    const c = client(env);
    const path = `/parks?parkCode=${encodeURIComponent(code)}`;
    const res = await c.json<RawParksResponse>(path);
    return res.data?.[0] ?? null;
  });
}
