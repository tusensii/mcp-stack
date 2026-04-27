import { createFetchClient, type FetchClient } from "@mcp-stack/http-fetch";
import { getIdToken, type AuthEnv } from "./auth.js";

// Base URLs — sourced from otf_api/api/client.py
export const API_CO = "https://api.orangetheory.co";   // member info, studio geo search
export const API_IO = "https://api.orangetheory.io";   // classes v1, bookings v2

// Android app User-Agent — matches what the Python lib sends (otf_api/api/client.py HEADERS)
const UA = "okhttp/4.12.0";

export class OtfApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "OtfApiError";
  }
}

// One shared fetch client per isolate. http-fetch's `retries: 1` matches the
// previous "retry once on 5xx" behavior; UA injection and per-call timeout are
// handled inside the package.
let cachedHttp: FetchClient | null = null;
function getHttp(): FetchClient {
  if (cachedHttp) return cachedHttp;
  cachedHttp = createFetchClient({
    userAgent: UA,
    defaultHeaders: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    retries: 1,
  });
  return cachedHttp;
}

async function doFetch(
  url: string,
  init: RequestInit,
  env: AuthEnv,
): Promise<unknown> {
  const { idToken } = await getIdToken(env);
  const http = getHttp();

  // Authorization is per-call (token rotates) so it's never a default header.
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${idToken}`);

  const resp = await http.fetch(url, { ...init, headers });

  if (!resp.ok) {
    let body: unknown;
    try { body = await resp.json(); } catch { body = {}; }
    const b = body as Record<string, unknown>;
    const code = (b["code"] ?? b["__type"] ?? "") as string;
    const msg = (b["message"] ?? b["Message"] ?? resp.statusText) as string;

    // Map known codes — sourced from otf_api/api/client.py _map_http_error
    if (resp.status === 404) throw new OtfApiError(404, `Not found: ${url}`);
    if (code === "BOOKING_ALREADY_BOOKED") throw new OtfApiError(409, "Class is already booked", code);
    if (code === "BOOKING_CANCELED") throw new OtfApiError(409, "Booking is already cancelled", code);
    if (code === "AlreadyBookedError" || (b["data"] as Record<string,unknown>)?.["errorCode"] === "603") {
      throw new OtfApiError(409, "Class is already booked", "ALREADY_BOOKED");
    }
    if ((b["data"] as Record<string,unknown>)?.["errorCode"] === "602") {
      throw new OtfApiError(400, "Class is outside the scheduling window", "OUTSIDE_WINDOW");
    }

    throw new OtfApiError(resp.status, `OTF API error ${resp.status}: ${msg}`, code);
  }

  if (resp.status === 204 || resp.headers.get("content-length") === "0") return null;
  return resp.json();
}

export function buildUrl(base: string, path: string, params?: Record<string, string | number | boolean | string[]>): string {
  const url = new URL(path, base);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

export async function otfGet<T>(
  base: string,
  path: string,
  env: AuthEnv,
  params?: Record<string, string | number | boolean | string[]>,
): Promise<T> {
  const url = buildUrl(base, path, params);
  return doFetch(url, { method: "GET" }, env) as Promise<T>;
}

export async function otfPost<T>(
  base: string,
  path: string,
  env: AuthEnv,
  body: unknown,
): Promise<T> {
  const url = buildUrl(base, path);
  return doFetch(url, { method: "POST", body: JSON.stringify(body) }, env) as Promise<T>;
}

export async function otfDelete(
  base: string,
  path: string,
  env: AuthEnv,
): Promise<void> {
  const url = buildUrl(base, path);
  await doFetch(url, { method: "DELETE" }, env);
}
