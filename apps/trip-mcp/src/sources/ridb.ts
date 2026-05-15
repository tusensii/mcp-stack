/**
 * Recreation.gov RIDB API client.
 *
 * RIDB (Recreation Information Database) is the federal recreation API
 * backing recreation.gov. We use it for permit metadata and availability.
 *
 * Auth: `apikey` header. Base URL: https://ridb.recreation.gov/api/v1.
 *
 * Notes on availability endpoints:
 *  - The public RIDB v1 surface focuses on metadata (permits, facilities,
 *    campsites). The granular availability grids that recreation.gov
 *    itself uses live on the (undocumented but stable) endpoints
 *    https://www.recreation.gov/api/permits/{permitId}/availability/month
 *    and https://www.recreation.gov/api/camps/availability/campground/{facilityId}/month.
 *    We try the RIDB-shaped path first and fall back to the recreation.gov
 *    pattern so this client works against either surface as RIDB evolves.
 */

import { createFetchClient, HttpError, RateLimitError } from "@mcp-stack/http-fetch";
import type { FetchClient } from "@mcp-stack/http-fetch";
import { cached, TTL } from "../cache.js";
import { userAgent } from "../tools/utils.js";
import type { Env } from "../types.js";

const RIDB_BASE = "https://ridb.recreation.gov/api/v1";
const RECGOV_BASE = "https://www.recreation.gov/api";

export interface RidbPermit {
  PermitEntranceID?: string;
  PermitEntranceName?: string;
  PermitEntranceDescription?: string;
  FacilityID?: string;
  [key: string]: unknown;
}

export interface RidbFacility {
  FacilityID?: string;
  FacilityName?: string;
  FacilityDescription?: string;
  FacilityTypeDescription?: string;
  [key: string]: unknown;
}

export interface RidbSearchResult {
  permits: RidbPermit[];
  facilities: RidbFacility[];
}

export interface RidbListResponse<T> {
  RECDATA?: T[];
  METADATA?: Record<string, unknown>;
}

/** Loose availability shape — varies by endpoint, defensively typed. */
export interface RidbAvailability {
  source_url: string;
  raw: Record<string, unknown>;
}

/** Friendly result envelope so callers can distinguish "not found" vs "blocked". */
export interface RidbResult<T> {
  ok: boolean;
  status?: number;
  data: T | null;
  error?: string;
}

function makeClient(env: Env, baseUrl: string): FetchClient {
  return createFetchClient({
    baseUrl,
    userAgent: userAgent(env.CONTACT),
    defaultHeaders: {
      apikey: env.RIDB_API_KEY,
      Accept: "application/json",
    },
    timeoutMs: 20_000,
    retries: 1,
  });
}

async function safeJson<T>(client: FetchClient, path: string): Promise<RidbResult<T>> {
  try {
    // Probe raw response first so we can log diagnostics on parse failures.
    const res = await client.fetch(path);
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(res.status, `RIDB ${res.status}`, text.slice(0, 200));
    }
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch (parseErr) {
      console.warn(
        `RIDB non-JSON response for ${path}: status=${res.status} ` +
          `content-type=${res.headers.get("content-type") ?? "?"} ` +
          `body[0:200]=${text.slice(0, 200).replace(/\s+/g, " ")}`,
      );
      return {
        ok: false,
        status: res.status,
        data: null,
        error: `ridb_non_json (status ${res.status}): ${text.slice(0, 120)}`,
      };
    }
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 401 || e.status === 403) {
        return { ok: false, status: e.status, data: null, error: "ridb_auth_failed" };
      }
      if (e.status === 404) {
        return { ok: false, status: 404, data: null, error: "ridb_not_found" };
      }
      return { ok: false, status: e.status, data: null, error: `ridb_http_${e.status}` };
    }
    if (e instanceof RateLimitError) {
      return { ok: false, status: 429, data: null, error: "ridb_rate_limited" };
    }
    return {
      ok: false,
      data: null,
      error: e instanceof Error ? e.message : "ridb_unknown_error",
    };
  }
}

/** Search permits + facilities matching a query string. */
export async function searchPermits(
  env: Env,
  areaName: string,
): Promise<RidbResult<RidbSearchResult>> {
  const key = `ridb:search:${areaName.toLowerCase().trim()}`;
  return cached(env, key, TTL.RIDB_META, async () => {
    const client = makeClient(env, RIDB_BASE);
    const q = encodeURIComponent(areaName);
    const [permitsRes, facilitiesRes] = await Promise.all([
      safeJson<RidbListResponse<RidbPermit>>(client, `/permits?query=${q}&limit=25`),
      safeJson<RidbListResponse<RidbFacility>>(client, `/facilities?query=${q}&limit=25`),
    ]);
    if (!permitsRes.ok && !facilitiesRes.ok) {
      return {
        ok: false,
        status: permitsRes.status ?? facilitiesRes.status,
        data: null,
        error: permitsRes.error ?? facilitiesRes.error,
      };
    }
    return {
      ok: true,
      data: {
        permits: permitsRes.data?.RECDATA ?? [],
        facilities: facilitiesRes.data?.RECDATA ?? [],
      },
    };
  });
}

/** Fetch metadata for a single permit by ID. */
export async function getPermit(env: Env, permitId: string): Promise<RidbResult<RidbPermit>> {
  const key = `ridb:permit:${permitId}`;
  return cached(env, key, TTL.RIDB_META, async () => {
    const client = makeClient(env, RIDB_BASE);
    // RIDB returns either a single record or {RECDATA:[...]} — handle both.
    const res = await safeJson<RidbPermit | RidbListResponse<RidbPermit>>(
      client,
      `/permits/${encodeURIComponent(permitId)}`,
    );
    if (!res.ok || !res.data) return { ...res, data: null };
    const raw = res.data as RidbPermit | RidbListResponse<RidbPermit>;
    const record =
      "RECDATA" in raw && Array.isArray(raw.RECDATA) ? raw.RECDATA[0] : (raw as RidbPermit);
    return { ok: true, data: record ?? null };
  });
}

/**
 * Permit availability. Tries the RIDB-shaped path first, then falls back
 * to the recreation.gov month endpoint pattern. The grid shape differs
 * between the two — callers should treat `raw` as opaque.
 */
export async function getPermitAvailability(
  env: Env,
  permitId: string,
  startDate: string,
  endDate: string,
): Promise<RidbResult<RidbAvailability>> {
  const key = `ridb:permit_avail:${permitId}:${startDate}:${endDate}`;
  return cached(env, key, TTL.RIDB_AVAIL, async () => {
    const ridb = makeClient(env, RIDB_BASE);
    const ridbPath = `/permits/${encodeURIComponent(permitId)}/availability/${startDate}/${endDate}`;
    const ridbRes = await safeJson<Record<string, unknown>>(ridb, ridbPath);
    if (ridbRes.ok && ridbRes.data) {
      return {
        ok: true,
        data: { source_url: `${RIDB_BASE}${ridbPath}`, raw: ridbRes.data },
      };
    }

    // Fallback: recreation.gov month-grid endpoint. Uses YYYY-MM-01 ISO
    // timestamps as the `start_date` query param and returns a month at a
    // time. We pass the requested startDate's first-of-month as a best
    // effort; callers narrow down client-side.
    const monthStart = `${startDate.slice(0, 7)}-01T00:00:00.000Z`;
    const recPath = `/permits/${encodeURIComponent(permitId)}/availability/month?start_date=${encodeURIComponent(monthStart)}`;
    const recClient = makeClient(env, RECGOV_BASE);
    const recRes = await safeJson<Record<string, unknown>>(recClient, recPath);
    if (recRes.ok && recRes.data) {
      return {
        ok: true,
        data: { source_url: `${RECGOV_BASE}${recPath}`, raw: recRes.data },
      };
    }
    return {
      ok: false,
      status: ridbRes.status ?? recRes.status,
      data: null,
      error: ridbRes.error ?? recRes.error ?? "ridb_avail_unavailable",
    };
  });
}

/** Campground availability — same fallback strategy as permit availability. */
export async function getCampgroundAvailability(
  env: Env,
  facilityId: string,
  startDate: string,
  endDate: string,
): Promise<RidbResult<RidbAvailability>> {
  const key = `ridb:camp_avail:${facilityId}:${startDate}:${endDate}`;
  return cached(env, key, TTL.RIDB_AVAIL, async () => {
    const ridb = makeClient(env, RIDB_BASE);
    const ridbPath = `/facilities/${encodeURIComponent(facilityId)}/availability/${startDate}/${endDate}`;
    const ridbRes = await safeJson<Record<string, unknown>>(ridb, ridbPath);
    if (ridbRes.ok && ridbRes.data) {
      return {
        ok: true,
        data: { source_url: `${RIDB_BASE}${ridbPath}`, raw: ridbRes.data },
      };
    }

    const monthStart = `${startDate.slice(0, 7)}-01T00:00:00.000Z`;
    const recPath = `/camps/availability/campground/${encodeURIComponent(facilityId)}/month?start_date=${encodeURIComponent(monthStart)}`;
    const recClient = makeClient(env, RECGOV_BASE);
    const recRes = await safeJson<Record<string, unknown>>(recClient, recPath);
    if (recRes.ok && recRes.data) {
      return {
        ok: true,
        data: { source_url: `${RECGOV_BASE}${recPath}`, raw: recRes.data },
      };
    }
    return {
      ok: false,
      status: ridbRes.status ?? recRes.status,
      data: null,
      error: ridbRes.error ?? recRes.error ?? "ridb_avail_unavailable",
    };
  });
}
