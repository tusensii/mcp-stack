/**
 * get_weather: NWS-backed point forecast, alerts, and AFD summary.
 * Resolves either an explicit lat/lon or a known PNW area_id.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Confidence, Env, Source, ToolPayload } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import { findAreaById } from "../areas.js";
import {
  getActiveAlerts,
  getAreaForecastDiscussion,
  getForecast,
  getHourlyForecast,
  getPoint,
  type NwsAlert,
  type NwsForecastPeriod,
} from "../sources/nws.js";
import {
  OPEN_METEO_ATTRIBUTION,
  getPointForecast,
  type OpenMeteoDaily,
  type OpenMeteoHourly,
} from "../sources/openmeteo.js";
import { payloadResponse, roundCoord, titledTool } from "./utils.js";

interface ElevationAdjustedBlock {
  provider: "open-meteo";
  /** Elevation the caller asked the model to correct to. */
  elevation_ft: number;
  /** Elevation the model actually applied (echoed back by the API). */
  model_elevation_ft: number;
  daily: OpenMeteoDaily[];
  hourly?: OpenMeteoHourly[];
}

interface WeatherData {
  location: {
    lat: number;
    lon: number;
    area_id?: string;
    area_name?: string;
    grid: string;
    forecast_office: string;
  };
  daily: NwsForecastPeriod[];
  hourly?: NwsForecastPeriod[];
  alerts: NwsAlert[];
  afd_summary: string;
  /** Present only when `elevation_ft` was supplied. */
  elevation_adjusted?: ElevationAdjustedBlock;
}

const STANDARD_CAVEATS = [
  "NWS forecast confidence drops materially past 72 hours.",
  "Point forecasts use valley-floor or grid-cell elevation; mountain passes and high alpine basins on a route may experience materially colder temps, more precip, and stronger wind than the valley reading.",
];

function summarizeAfd(productText: string): string {
  if (!productText) return "";
  // Pull the SYNOPSIS or first non-header block; fall back to first 800 chars.
  const synopsisMatch = productText.match(/\.SYNOPSIS\.\.\.([\s\S]*?)(?:\n&&|\.[A-Z ]+\.\.\.)/);
  if (synopsisMatch && synopsisMatch[1]) {
    return synopsisMatch[1].trim().slice(0, 1200);
  }
  return productText.trim().slice(0, 800);
}

export function registerWeatherTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_weather",
    "Checking mountain weather…",
    "Returns NWS forecast (daily + optional hourly), active alerts, and the latest Area Forecast Discussion for a point. Either supply `area_id` (resolves to that area's centroid) or explicit lat/lon. Use this to assess go/no-go for a backpacking trip. NWS point forecasts cannot distinguish elevations within a ~2.5 km grid cell — a trailhead and a basin 2,600 ft above it get the identical forecast. Pass `elevation_ft` (e.g. from get_elevation_profile) to ALSO get an `elevation_adjusted` block: an Open-Meteo forecast with the model's hypsometric altitude correction applied at that elevation, including freezing_level_height in feet — directly useful for snow-level questions. The adjusted block is a model correction, not a mountain-station observation, and precipitation type/amount remain grid-scale. The NWS payload is never replaced — alerts and the AFD narrative have no Open-Meteo equivalent. CRITICAL CAVEATS to surface in your answer: (1) forecast confidence drops materially past 72 hours — for trips further out, recommend re-checking within 24h of departure; (2) for any backcountry go/no-go decision involving snow, river crossings, or storms, surface the ranger station phone from `get_safety_brief` alongside this forecast — the ranger has real-time ground truth the forecast doesn't. The Area Forecast Discussion (include_afd: true, default) contains the meteorologist's narrative confidence assessment and is often the most useful field — quote it when relevant.",
    {
      lat: z.number().min(-90).max(90).optional().describe("Latitude (decimal). Ignored if area_id is supplied."),
      lon: z.number().min(-180).max(180).optional().describe("Longitude (decimal). Ignored if area_id is supplied."),
      area_id: z.string().optional().describe("Known PNW area id (e.g. 'enchantments'); overrides lat/lon."),
      days: z.number().int().min(1).max(7).default(7).describe("Forecast horizon in days (max 7)."),
      include_alerts: z.boolean().default(true).describe("Fetch active NWS alerts for the point."),
      include_afd: z.boolean().default(true).describe("Fetch the latest Area Forecast Discussion."),
      include_hourly: z.boolean().default(false).describe("Include the hourly forecast (large)."),
      elevation_ft: z
        .number()
        .min(-500)
        .max(15000)
        .optional()
        .describe(
          "Target elevation in feet. When set, adds an `elevation_adjusted` Open-Meteo block with altitude-corrected temperatures and freezing level; NWS output is unchanged.",
        ),
    },
    async ({ lat, lon, area_id, days, include_alerts, include_afd, include_hourly, elevation_ft }) => {
      let resolvedLat: number | undefined = lat;
      let resolvedLon: number | undefined = lon;
      let areaName: string | undefined;

      if (area_id) {
        const area = findAreaById(area_id);
        if (!area) {
          return payloadResponse(
            empty<WeatherData>([`Unknown area_id: ${area_id}`]),
          );
        }
        resolvedLat = area.centroid.lat;
        resolvedLon = area.centroid.lon;
        areaName = area.name;
      }

      if (typeof resolvedLat !== "number" || typeof resolvedLon !== "number") {
        return payloadResponse(
          empty<WeatherData>(["Must provide either area_id or both lat and lon."]),
        );
      }

      const rlat = roundCoord(resolvedLat);
      const rlon = roundCoord(resolvedLon);

      try {
        const point = await getPoint(env, rlat, rlon);

        const wantAdjusted = typeof elevation_ft === "number";
        const [forecast, hourly, alerts, afd, adjustedResult] = await Promise.all([
          getForecast(env, rlat, rlon).catch(() => null),
          include_hourly ? getHourlyForecast(env, rlat, rlon).catch(() => null) : Promise.resolve(null),
          include_alerts ? getActiveAlerts(env, rlat, rlon).catch(() => [] as NwsAlert[]) : Promise.resolve([] as NwsAlert[]),
          include_afd && point.forecastOffice
            ? getAreaForecastDiscussion(env, point.forecastOffice).catch(() => null)
            : Promise.resolve(null),
          wantAdjusted
            ? getPointForecast(env, {
                lat: rlat,
                lon: rlon,
                elevationM: elevation_ft! / 3.28084,
                days,
              }).then(
                (f) => ({ ok: true as const, forecast: f }),
                (e: unknown) => ({
                  ok: false as const,
                  error: e instanceof Error ? e.message : String(e),
                }),
              )
            : Promise.resolve(null),
        ]);

        // 7-day forecast = up to 14 periods (day+night). Trim to days*2.
        const maxPeriods = days * 2;
        const dailyPeriods = (forecast?.periods ?? []).slice(0, maxPeriods);
        const hourlyPeriods = hourly?.periods?.slice(0, days * 24);

        const sources: Source[] = [];
        sources.push(
          makeSource(
            `https://api.weather.gov/points/${rlat},${rlon}`,
            "NWS point metadata",
            { license: "public domain (US Govt)", confidence: "high" },
          ),
        );
        if (forecast) {
          sources.push(
            makeSource(
              `https://api.weather.gov/gridpoints/${point.gridId}/${point.gridX},${point.gridY}/forecast`,
              "NWS daily forecast",
              { license: "public domain (US Govt)", confidence: "high", fetched_at: forecast.updated || undefined },
            ),
          );
        }
        if (hourly) {
          sources.push(
            makeSource(
              `https://api.weather.gov/gridpoints/${point.gridId}/${point.gridX},${point.gridY}/forecast/hourly`,
              "NWS hourly forecast",
              { license: "public domain (US Govt)", confidence: "high", fetched_at: hourly.updated || undefined },
            ),
          );
        }
        if (include_alerts) {
          sources.push(
            makeSource(
              `https://api.weather.gov/alerts/active?point=${rlat},${rlon}`,
              "NWS active alerts",
              { license: "public domain (US Govt)", confidence: "high" },
            ),
          );
        }
        if (afd) {
          sources.push(
            makeSource(
              `https://api.weather.gov/products/${afd.id}`,
              `NWS Area Forecast Discussion (${afd.office})`,
              {
                license: "public domain (US Govt)",
                confidence: "high",
                fetched_at: afd.issuanceTime || undefined,
              },
            ),
          );
        }

        let adjusted: ElevationAdjustedBlock | undefined;
        let adjustedError: string | undefined;
        if (adjustedResult) {
          if (adjustedResult.ok) {
            adjusted = {
              provider: "open-meteo",
              elevation_ft: Math.round(elevation_ft!),
              model_elevation_ft: adjustedResult.forecast.model_elevation_ft,
              daily: adjustedResult.forecast.daily,
              ...(include_hourly
                ? { hourly: adjustedResult.forecast.hourly.slice(0, days * 24) }
                : {}),
            };
            sources.push(
              makeSource(
                "https://open-meteo.com/en/docs",
                OPEN_METEO_ATTRIBUTION,
                { license: "CC BY 4.0", confidence: "medium" },
              ),
            );
          } else {
            adjustedError = `open_meteo_forecast: ${adjustedResult.error} — elevation_adjusted block unavailable; NWS payload unaffected.`;
          }
        }

        // Confidence: high if alert data is fresh (<1h), otherwise medium.
        let confidence: Confidence = "medium";
        if (include_alerts && alerts.length > 0) {
          const newestSent = alerts
            .map((a) => Date.parse(a.sent))
            .filter((t) => !Number.isNaN(t))
            .reduce((max, t) => (t > max ? t : max), 0);
          if (newestSent > 0 && Date.now() - newestSent < 60 * 60 * 1000) {
            confidence = "high";
          }
        } else if (forecast && forecast.updated) {
          const updatedAt = Date.parse(forecast.updated);
          if (!Number.isNaN(updatedAt) && Date.now() - updatedAt < 60 * 60 * 1000) {
            confidence = "high";
          }
        }

        const data: WeatherData = {
          location: {
            lat: rlat,
            lon: rlon,
            area_id: area_id,
            area_name: areaName,
            grid: `${point.gridId} ${point.gridX},${point.gridY}`,
            forecast_office: point.forecastOffice,
          },
          daily: dailyPeriods,
          ...(hourlyPeriods ? { hourly: hourlyPeriods } : {}),
          alerts,
          afd_summary: afd ? summarizeAfd(afd.productText) : "",
          ...(adjusted ? { elevation_adjusted: adjusted } : {}),
        };

        // With an adjusted block present, swap the generic "mountains may be
        // colder" caveat for a specific description of what the block models.
        const caveats = adjusted
          ? [
              STANDARD_CAVEATS[0]!,
              `elevation_adjusted block models temperature at ${adjusted.elevation_ft} ft (Open-Meteo hypsometric correction; medium confidence — a model adjustment, not a station observation). Precipitation type/amount are still grid-scale.`,
            ]
          : [...STANDARD_CAVEATS];
        if (!forecast) caveats.push("NWS daily forecast unavailable.");
        if (include_afd && !afd) caveats.push("Area Forecast Discussion unavailable.");
        if (adjustedError) caveats.push(adjustedError);

        const payload: ToolPayload<WeatherData> = ok(data, sources, confidence, caveats);
        return payloadResponse(payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return payloadResponse(
          empty<WeatherData>([`NWS unreachable: ${msg}`, ...STANDARD_CAVEATS]),
        );
      }
    },
  );
}
