/**
 * get_access_status: trailhead-reachability — per-access-road status by
 * managing agency (WSDOT passes / NPS alerts / USFS alerts-page mention
 * scan) plus drive time (curated static, or live OSRM on request).
 * Supersedes get_conditions' never-implemented usfs_alerts stub for the
 * road-status slice.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Confidence, Env, Source, ToolPayload } from "../types.js";
import { empty, makeSource, nowIso, ok } from "../types.js";
import { findAreaById, type RangerStation } from "../areas.js";
import { ACCESS_ROADS, NAMED_ORIGINS, type AccessRoad } from "../access_roads.js";
import { APPROACHES } from "../approach.js";
import { findPassByName, getMountainPassConditions } from "../sources/wsdot.js";
import { getNpsAlerts, type NpsAlert } from "../sources/nps.js";
import { findRoadMention, forestAlertsUrl, getForestAlertsText } from "../sources/usfs.js";
import { getDriveTime } from "../sources/osrm.js";
import { payloadResponse, titledTool } from "./utils.js";

type RoadStatus =
  | "open"
  | "advisory"
  | "mentioned_in_alerts"
  | "no_current_alerts"
  | "unknown";

interface RoadReport {
  name: string;
  manager: AccessRoad["manager"];
  status: RoadStatus;
  detail: string | null;
  source_url: string;
  as_of: string;
  note?: string;
}

interface DriveTime {
  origin: string;
  mode: "static_curated" | "live_osrm";
  duration_min: number | null;
  distance_mi?: number;
  note: string;
}

interface AccessStatusData {
  area_id: string;
  area_name: string;
  roads: RoadReport[];
  drive_time: DriveTime | null;
  ranger_stations: RangerStation[];
}

const STALE_CAVEAT =
  "Forest-road data is often stale at every source — the ranger district phone is the only real-time ground truth for gates and washouts.";

function resolveOrigin(origin: string): { lat: number; lon: number; label: string } | null {
  const named = NAMED_ORIGINS[origin.toLowerCase().trim()];
  if (named) return { ...named, label: origin.toLowerCase().trim() };
  const m = origin.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = Number.parseFloat(m[1]!);
    const lon = Number.parseFloat(m[2]!);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon, label: `${lat},${lon}` };
  }
  return null;
}

function npsRoadAlerts(alerts: NpsAlert[], roadName: string): NpsAlert[] {
  const tokens = roadName
    .toLowerCase()
    .split(/[\s/()–-]+/)
    .filter((t) => t.length >= 4 && !["road", "pass", "highway"].includes(t));
  return alerts.filter((a) => {
    const hay = `${a.title ?? ""} ${a.description ?? ""}`.toLowerCase();
    return tokens.some((t) => hay.includes(t));
  });
}

export function registerAccessStatusTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_access_status",
    "Checking road access…",
    "Trailhead reachability for a registry area: every mapped access road returns {status, detail, source_url, as_of} — never silent absence. Resolution by managing agency: state highways via WSDOT pass conditions (open/advisory); NPS park roads via NPS alerts (road-matching alerts surfaced, else no_current_alerts); USFS forest roads via a mention-scan of the forest's alerts page — 'mentioned_in_alerts' carries the snippet, and 'unknown' explicitly means NO information, NOT that the road is open (absence of an alert proves nothing; call the ranger district — contacts included). DRIVE TIME: impersonal `origin` parameter (named city — seattle default, everett/tacoma/bellingham/portland — or 'lat,lon'); static curated minutes by default, `live: true` for OSRM demo-server routing to the area centroid (no SLA, clearly labeled; centroid ≠ trailhead). Supersedes get_conditions' empty usfs_alerts stub for road status.",
    {
      area_id: z.string().describe("Registry area id (e.g. 'glacier_peak')."),
      origin: z
        .string()
        .default("seattle")
        .describe("Drive-time origin: named city (seattle/everett/tacoma/bellingham/portland) or 'lat,lon'. Default seattle."),
      live: z
        .boolean()
        .default(false)
        .describe("Route the drive time live via the OSRM demo server (no SLA) instead of the curated static estimate."),
    },
    async ({ area_id, origin, live }) => {
      const area = findAreaById(area_id);
      if (!area) {
        return payloadResponse(empty<AccessStatusData>([`Unknown area_id: ${area_id}`]));
      }
      const roads = ACCESS_ROADS[area_id];
      if (!roads || roads.length === 0) {
        return payloadResponse(
          empty<AccessStatusData>([`No access-road mapping for ${area_id} yet.`]),
        );
      }

      const fetchedAt = nowIso();
      const caveats: string[] = [STALE_CAVEAT];
      const sources: Source[] = [];

      // Fetch each upstream at most once, isolated.
      const needsWsdot = roads.some((r) => r.manager === "wsdot");
      const npsCodes = [...new Set(roads.map((r) => r.nps_park_code).filter((c): c is string => Boolean(c)))];
      const forestSlugs = [...new Set(roads.map((r) => r.usfs_forest_slug).filter((s): s is string => Boolean(s)))];

      const [wsdotResult, npsResults, forestTexts] = await Promise.all([
        needsWsdot
          ? getMountainPassConditions(env).then(
              (passes) => ({ ok: true as const, passes }),
              (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
            )
          : Promise.resolve(null),
        Promise.all(
          npsCodes.map(async (code) => {
            try {
              return { code, alerts: (await getNpsAlerts(env, [code])).data, ok: true };
            } catch (e) {
              return { code, alerts: [] as NpsAlert[], ok: false, error: e instanceof Error ? e.message : String(e) };
            }
          }),
        ),
        Promise.all(
          forestSlugs.map(async (slug) => ({ slug, text: await getForestAlertsText(env, slug) })),
        ),
      ]);

      if (wsdotResult && !wsdotResult.ok) {
        caveats.push(`wsdot_passes: ${wsdotResult.error} — WSDOT-managed roads report unknown.`);
      }
      for (const n of npsResults) {
        if (!n.ok) caveats.push(`nps_alerts (${n.code}): ${"error" in n ? n.error : "failed"} — NPS-managed roads report unknown.`);
      }
      for (const f of forestTexts) {
        if (f.text === null) {
          caveats.push(`usfs_alerts_page (${f.slug}): fetch failed — that forest's roads report unknown.`);
        }
      }

      const reports: RoadReport[] = roads.map((road): RoadReport => {
        const base = { name: road.name, manager: road.manager, as_of: fetchedAt, ...(road.note ? { note: road.note } : {}) };
        if (road.manager === "wsdot") {
          const url = "https://wsdot.wa.gov/travel/real-time/mountainpasses";
          if (wsdotResult?.ok) {
            const pass = road.wsdot_pass_name ? findPassByName(wsdotResult.passes, road.wsdot_pass_name) : undefined;
            if (pass) {
              const restricted =
                pass.TravelAdvisoryActive ||
                Boolean(pass.RestrictionOne?.RestrictionText && !/no restriction/i.test(pass.RestrictionOne.RestrictionText));
              return {
                ...base,
                status: restricted ? "advisory" : "open",
                detail:
                  `${pass.RoadCondition || "conditions unreported"}` +
                  (pass.RestrictionOne?.RestrictionText ? `; ${pass.RestrictionOne.RestrictionText}` : ""),
                source_url: url,
                as_of: pass.DateUpdated || fetchedAt,
              };
            }
            return { ...base, status: "unknown", detail: "pass not found in the WSDOT feed (some highways are unlisted off-season)", source_url: url };
          }
          return { ...base, status: "unknown", detail: "WSDOT feed unavailable", source_url: url };
        }
        if (road.manager === "nps") {
          const parkUrl = `https://www.nps.gov/${road.nps_park_code ?? ""}/planyourvisit/conditions.htm`;
          const parkRes = npsResults.find((n) => n.code === road.nps_park_code);
          if (parkRes?.ok) {
            const matches = npsRoadAlerts(parkRes.alerts, road.name);
            if (matches.length > 0) {
              return {
                ...base,
                status: "mentioned_in_alerts",
                detail: matches.map((m) => m.title).filter(Boolean).join(" | ").slice(0, 400),
                source_url: matches[0]?.url || parkUrl,
              };
            }
            return { ...base, status: "no_current_alerts", detail: "no road-matching alerts in the NPS feed (verify seasonal schedules separately)", source_url: parkUrl };
          }
          return { ...base, status: "unknown", detail: "NPS alerts unavailable", source_url: parkUrl };
        }
        // usfs
        const slug = road.usfs_forest_slug ?? "";
        const pageUrl = forestAlertsUrl(slug);
        const forest = forestTexts.find((f) => f.slug === slug);
        if (forest?.text) {
          const mention = findRoadMention(forest.text, road.name);
          if (mention) {
            return { ...base, status: "mentioned_in_alerts", detail: mention, source_url: pageUrl };
          }
          return {
            ...base,
            status: "unknown",
            detail: "no mention on the forest alerts page — NOT confirmation the road is open; call the ranger district",
            source_url: pageUrl,
          };
        }
        return { ...base, status: "unknown", detail: "forest alerts page unavailable", source_url: pageUrl };
      });

      // Sources per consulted upstream.
      if (needsWsdot) {
        sources.push(
          makeSource("https://wsdot.wa.gov/travel/real-time/mountainpasses", "WSDOT Mountain Pass Conditions", {
            license: "public-domain",
            confidence: "high",
            fetched_at: fetchedAt,
          }),
        );
      }
      for (const code of npsCodes) {
        sources.push(
          makeSource(`https://developer.nps.gov/api/v1/alerts?parkCode=${code}`, "NPS Alerts API", {
            license: "public-domain",
            confidence: "high",
            fetched_at: fetchedAt,
          }),
        );
      }
      for (const slug of forestSlugs) {
        sources.push(
          makeSource(forestAlertsUrl(slug), `USFS forest alerts page (${slug})`, {
            license: "public-domain",
            confidence: "low",
            fetched_at: fetchedAt,
          }),
        );
      }

      // Drive time.
      let driveTime: DriveTime | null = null;
      const resolved = resolveOrigin(origin);
      if (!resolved) {
        caveats.push(`Unrecognized origin "${origin}" — use a named city (${Object.keys(NAMED_ORIGINS).join(", ")}) or 'lat,lon'. Drive time omitted.`);
      } else if (live) {
        try {
          const est = await getDriveTime(env, resolved, area.centroid);
          if (est) {
            driveTime = {
              origin: resolved.label,
              mode: "live_osrm",
              duration_min: est.duration_min,
              distance_mi: est.distance_mi,
              note: "OSRM demo server (no SLA); routed to the area CENTROID, not a specific trailhead — treat as approximate.",
            };
            sources.push(
              makeSource("https://router.project-osrm.org/", "OSRM demo server (OpenStreetMap routing)", {
                license: "ODbL",
                confidence: "medium",
                fetched_at: fetchedAt,
              }),
            );
          } else {
            caveats.push("osrm: routing failed — falling back to the curated static estimate.");
          }
        } catch (e) {
          caveats.push(`osrm: ${e instanceof Error ? e.message : String(e)} — falling back to the curated static estimate.`);
        }
      }
      if (!driveTime && resolved) {
        const corridors = APPROACHES[area_id] ?? [];
        const mins = corridors
          .map((c) => c.drive_time_from_seattle_min)
          .filter((v): v is number => typeof v === "number");
        driveTime = {
          origin: resolved.label,
          mode: "static_curated",
          duration_min: mins.length > 0 ? Math.min(...mins) : null,
          note:
            resolved.label === "seattle"
              ? "curated typical no-traffic estimate from Seattle (shortest corridor); pass live: true for routed time"
              : "curated estimates are Seattle-based — for a different origin pass live: true for a routed time",
        };
      }

      const anyResolved = reports.some((r) => r.status !== "unknown");
      const data: AccessStatusData = {
        area_id,
        area_name: area.name,
        roads: reports,
        drive_time: driveTime,
        ranger_stations: area.ranger_stations,
      };
      const confidence: Confidence = anyResolved ? "medium" : "low";
      const payload: ToolPayload<AccessStatusData> = ok(data, sources, confidence, caveats);
      return payloadResponse(payload);
    },
  );
}
