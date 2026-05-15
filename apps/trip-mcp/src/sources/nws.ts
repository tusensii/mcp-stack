/**
 * National Weather Service (api.weather.gov) client.
 *
 * NWS requires no auth, but DOES require a User-Agent header
 * identifying the caller. They serve GeoJSON. Lat/lon should be
 * rounded to 4 decimals or NWS may return a 301 to a canonical
 * point URL.
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { roundCoord, userAgent } from "../tools/utils.js";

const BASE_URL = "https://api.weather.gov";

function client(env: Env) {
  return createFetchClient({
    baseUrl: BASE_URL,
    userAgent: userAgent(env.CONTACT),
    defaultHeaders: { Accept: "application/geo+json" },
    timeoutMs: 10_000,
    retries: 1,
  });
}

export interface NwsPoint {
  gridId: string;
  gridX: number;
  gridY: number;
  forecastZone: string;
  fireWeatherZone: string;
  forecastOffice: string;
  /** Absolute URL to the daily forecast endpoint. */
  forecastUrl: string;
  /** Absolute URL to the hourly forecast endpoint. */
  forecastHourlyUrl: string;
}

interface PointsResponse {
  properties?: {
    gridId?: string;
    gridX?: number;
    gridY?: number;
    forecastZone?: string;
    fireWeatherZone?: string;
    forecastOffice?: string;
    forecast?: string;
    forecastHourly?: string;
    cwa?: string;
  };
}

function lastSegment(url: string | undefined): string {
  if (!url) return "";
  const parts = url.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export async function getPoint(env: Env, lat: number, lon: number): Promise<NwsPoint> {
  const rlat = roundCoord(lat);
  const rlon = roundCoord(lon);
  const key = `nws:point:${rlat},${rlon}`;
  return cached(env, key, TTL.NWS_POINT, async () => {
    const c = client(env);
    const res = await c.json<PointsResponse>(`/points/${rlat},${rlon}`);
    const p = res.properties ?? {};
    return {
      gridId: p.gridId ?? p.cwa ?? "",
      gridX: p.gridX ?? 0,
      gridY: p.gridY ?? 0,
      forecastZone: lastSegment(p.forecastZone),
      fireWeatherZone: lastSegment(p.fireWeatherZone),
      forecastOffice: lastSegment(p.forecastOffice) || (p.cwa ?? p.gridId ?? ""),
      forecastUrl: p.forecast ?? "",
      forecastHourlyUrl: p.forecastHourly ?? "",
    };
  });
}

export interface NwsForecastPeriod {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast: string;
  probabilityOfPrecipitation?: number | null;
}

interface ForecastResponse {
  properties?: {
    updated?: string;
    periods?: NwsForecastPeriod[];
  };
}

export interface NwsForecast {
  updated: string;
  periods: NwsForecastPeriod[];
}

async function fetchForecastUrl(env: Env, url: string): Promise<NwsForecast> {
  const c = client(env);
  const res = await c.json<ForecastResponse>(url);
  const periods = (res.properties?.periods ?? []).map((p) => ({
    number: p.number,
    name: p.name,
    startTime: p.startTime,
    endTime: p.endTime,
    isDaytime: p.isDaytime,
    temperature: p.temperature,
    temperatureUnit: p.temperatureUnit,
    windSpeed: p.windSpeed,
    windDirection: p.windDirection,
    shortForecast: p.shortForecast,
    detailedForecast: p.detailedForecast,
    probabilityOfPrecipitation:
      typeof p.probabilityOfPrecipitation === "object" && p.probabilityOfPrecipitation !== null
        ? (p.probabilityOfPrecipitation as { value?: number | null }).value ?? null
        : (p.probabilityOfPrecipitation as number | null | undefined) ?? null,
  }));
  return { updated: res.properties?.updated ?? "", periods };
}

export async function getForecast(env: Env, lat: number, lon: number): Promise<NwsForecast> {
  const point = await getPoint(env, lat, lon);
  if (!point.forecastUrl) return { updated: "", periods: [] };
  const rlat = roundCoord(lat);
  const rlon = roundCoord(lon);
  const key = `nws:forecast:${rlat},${rlon}`;
  return cached(env, key, TTL.NWS_FORECAST, () => fetchForecastUrl(env, point.forecastUrl));
}

export async function getHourlyForecast(env: Env, lat: number, lon: number): Promise<NwsForecast> {
  const point = await getPoint(env, lat, lon);
  if (!point.forecastHourlyUrl) return { updated: "", periods: [] };
  const rlat = roundCoord(lat);
  const rlon = roundCoord(lon);
  const key = `nws:forecast-hourly:${rlat},${rlon}`;
  return cached(env, key, TTL.NWS_FORECAST, () => fetchForecastUrl(env, point.forecastHourlyUrl));
}

export interface NwsAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string;
  description: string;
  instruction: string;
  effective: string;
  expires: string;
  areaDesc: string;
  sent: string;
}

interface AlertsResponse {
  features?: Array<{
    id?: string;
    properties?: Partial<NwsAlert>;
  }>;
}

export async function getActiveAlerts(env: Env, lat: number, lon: number): Promise<NwsAlert[]> {
  const rlat = roundCoord(lat);
  const rlon = roundCoord(lon);
  const key = `nws:alerts:${rlat},${rlon}`;
  return cached(env, key, TTL.NWS_ALERTS, async () => {
    const c = client(env);
    const res = await c.json<AlertsResponse>(`/alerts/active?point=${rlat},${rlon}`);
    return (res.features ?? []).map((f) => ({
      id: f.id ?? f.properties?.id ?? "",
      event: f.properties?.event ?? "",
      severity: f.properties?.severity ?? "",
      urgency: f.properties?.urgency ?? "",
      certainty: f.properties?.certainty ?? "",
      headline: f.properties?.headline ?? "",
      description: f.properties?.description ?? "",
      instruction: f.properties?.instruction ?? "",
      effective: f.properties?.effective ?? "",
      expires: f.properties?.expires ?? "",
      areaDesc: f.properties?.areaDesc ?? "",
      sent: f.properties?.sent ?? "",
    }));
  });
}

export interface NwsAfd {
  id: string;
  issuanceTime: string;
  productText: string;
  office: string;
}

interface AfdListResponse {
  "@graph"?: Array<{
    "@id"?: string;
    id?: string;
    issuanceTime?: string;
    issuingOffice?: string;
  }>;
}

interface AfdProductResponse {
  id?: string;
  issuanceTime?: string;
  productText?: string;
  issuingOffice?: string;
}

export async function getAreaForecastDiscussion(
  env: Env,
  office: string,
): Promise<NwsAfd | null> {
  if (!office) return null;
  const key = `nws:afd:${office}`;
  return cached(env, key, TTL.NWS_FORECAST, async () => {
    const c = client(env);
    const list = await c.json<AfdListResponse>(
      `/products/types/AFD/locations/${office}`,
    );
    const items = list["@graph"] ?? [];
    if (items.length === 0) return null;
    // Newest first: API returns descending by issuanceTime; pick first.
    const newest = items[0];
    const productId = newest?.id ?? lastSegment(newest?.["@id"]);
    if (!productId) return null;
    const prod = await c.json<AfdProductResponse>(`/products/${productId}`);
    return {
      id: prod.id ?? productId,
      issuanceTime: prod.issuanceTime ?? newest?.issuanceTime ?? "",
      productText: prod.productText ?? "",
      office: prod.issuingOffice ?? office,
    };
  });
}
