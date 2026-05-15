/**
 * WSDOT Traveler Information API — Mountain Pass Conditions.
 *
 * Auth: AccessCode query parameter. No header auth.
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { userAgent } from "../tools/utils.js";

const ENDPOINT =
  "https://wsdot.wa.gov/Traffic/api/MountainPassConditions/MountainPassConditionsRest.svc/GetMountainPassConditionsAsJson";

export interface MountainPassCondition {
  MountainPassId: number;
  MountainPassName: string;
  TravelAdvisoryActive: boolean;
  RoadCondition: string;
  TemperatureInFahrenheit: number | null;
  ElevationInFeet: number;
  WeatherCondition: string;
  RestrictionOne: { RestrictionText?: string; TravelDirection?: string } | null;
  RestrictionTwo: { RestrictionText?: string; TravelDirection?: string } | null;
  DateUpdated: string;
}

interface RawPassCondition {
  MountainPassId?: number;
  MountainPassName?: string;
  TravelAdvisoryActive?: boolean;
  RoadCondition?: string;
  TemperatureInFahrenheit?: number | null;
  ElevationInFeet?: number;
  WeatherCondition?: string;
  RestrictionOne?: { RestrictionText?: string; TravelDirection?: string } | null;
  RestrictionTwo?: { RestrictionText?: string; TravelDirection?: string } | null;
  DateUpdated?: string;
}

function client(env: Env) {
  return createFetchClient({
    userAgent: userAgent(env.CONTACT),
    defaultHeaders: { Accept: "application/json" },
    timeoutMs: 15_000,
    retries: 1,
  });
}

export async function getMountainPassConditions(env: Env): Promise<MountainPassCondition[]> {
  const key = "wsdot:passes";
  return cached(env, key, TTL.WSDOT_PASS, async () => {
    const c = client(env);
    const url = `${ENDPOINT}?AccessCode=${encodeURIComponent(env.WSDOT_API_KEY)}`;
    // Probe raw first so we can log diagnostics on auth/format failures.
    const rawRes = await c.fetch(url);
    const text = await rawRes.text();
    if (!rawRes.ok) {
      const keyHint = env.WSDOT_API_KEY
        ? `present(len=${env.WSDOT_API_KEY.length})`
        : "MISSING";
      console.warn(
        `WSDOT ${rawRes.status} ${rawRes.statusText} key=${keyHint} ` +
          `body[0:300]=${text.slice(0, 300).replace(/\s+/g, " ")}`,
      );
      throw new Error(`wsdot_http_${rawRes.status}`);
    }
    let res: RawPassCondition[];
    try {
      res = JSON.parse(text) as RawPassCondition[];
    } catch {
      console.warn(
        `WSDOT non-JSON response: status=${rawRes.status} content-type=${rawRes.headers.get("content-type") ?? "?"} body[0:300]=${text.slice(0, 300).replace(/\s+/g, " ")}`,
      );
      throw new Error("wsdot_non_json");
    }
    return (res ?? []).map((p) => ({
      MountainPassId: p.MountainPassId ?? 0,
      MountainPassName: p.MountainPassName ?? "",
      TravelAdvisoryActive: Boolean(p.TravelAdvisoryActive),
      RoadCondition: p.RoadCondition ?? "",
      TemperatureInFahrenheit:
        typeof p.TemperatureInFahrenheit === "number" ? p.TemperatureInFahrenheit : null,
      ElevationInFeet: p.ElevationInFeet ?? 0,
      WeatherCondition: p.WeatherCondition ?? "",
      RestrictionOne: p.RestrictionOne ?? null,
      RestrictionTwo: p.RestrictionTwo ?? null,
      DateUpdated: p.DateUpdated ?? "",
    }));
  });
}

/** Case-insensitive fuzzy `contains` match across pass names. */
export function findPassByName(
  passes: MountainPassCondition[],
  name: string,
): MountainPassCondition | undefined {
  const q = name.toLowerCase().trim();
  if (!q) return undefined;
  return passes.find((p) => {
    const n = p.MountainPassName.toLowerCase();
    return n === q || n.includes(q) || q.includes(n);
  });
}
