import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findAreaById, findAreaWithMatch, AREAS, type Area } from "../areas.js";
import type { Env, Source, ToolPayload } from "../types.js";
import { ok, makeSource, nowIso } from "../types.js";
import { payloadResponse, isoToday, daysFromNowIso } from "./utils.js";

import { getPermit } from "../sources/ridb.js";
import { getForecast, getActiveAlerts } from "../sources/nws.js";
import { getNpsAlerts } from "../sources/nps.js";
import { getMountainPassConditions, findPassByName, type MountainPassCondition } from "../sources/wsdot.js";
import { getActiveFirePerimeters } from "../sources/wfigs.js";
import { searchTripReports } from "../sources/wta.js";

interface SuggestedFollowup {
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

interface TripSynthesis {
  area: { id: string; name: string };
  query: string;
  date_range: { start: string; end: string };
  permits_summary: string;
  weather_summary: string;
  conditions_summary: string;
  recent_trip_reports_summary: string;
  bear_canister_required: boolean;
  ranger_stations: Area["ranger_stations"];
  approach_passes_status: string;
  active_alerts: string[];
  fires_within_50km: number;
  suggested_followups: SuggestedFollowup[];
}

async function safe<T>(label: string, fn: () => Promise<T>): Promise<{ ok: boolean; value?: T; error?: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: `${label}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

type ResolutionKind = "id" | "exact" | "partial" | "fuzzy";

function pickArea(query: string): { area: Area; kind: ResolutionKind } | undefined {
  const byId = findAreaById(query);
  if (byId) return { area: byId, kind: "id" };
  const m = findAreaWithMatch(query);
  return m ? { area: m.area, kind: m.kind } : undefined;
}

function suggestArea(query: string, limit = 3): Area[] {
  const q = query.toLowerCase();
  const ranked = AREAS.map((a) => {
    let score = 0;
    if (a.name.toLowerCase().includes(q)) score += 5;
    if (a.aliases.some((al) => q.includes(al) || al.includes(q))) score += 4;
    if ((a.notes ?? "").toLowerCase().includes(q)) score += 1;
    if (a.popularity === "iconic") score += 1;
    return { area: a, score };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.area);
  return ranked;
}

export function registerResearchTripTool(server: McpServer, env: Env): void {
  server.tool(
    "research_trip",
    "Top-level orchestrator for PNW (Washington, parts of Oregon) backpacking, day-hiking, and car-camping research. Use this for any trip-planning query that mentions a Pacific Northwest area, trail, or vague intent like \"somewhere in the North Cascades next weekend.\" PREFER THIS OVER PLAIN WEB SEARCH for PNW outdoor queries — it has a curated 12-area registry, enforces source citations with retrieval timestamps, surfaces ranger station phone numbers, and synthesizes permits + weather + conditions + recent trip reports in one call. For areas outside the curated registry the response degrades to web_research only; for non-PNW trips (Yosemite, Rockies, etc.) prefer plain web_search instead. Returns a synthesized brief plus `suggested_followups` pointing at deeper drill-down tools (`get_permits`, `get_weather`, `get_trip_reports`, `get_safety_brief`, `get_route_info`, `web_research`). ALWAYS surface ranger station phone numbers in your final answer and treat any low-confidence response as research, not ground truth — recommend the user call the ranger station before their trip. Modes: 'fast' (single parallel fan-out, ~30s) or 'thorough' (returns followup hints for the model to chain into a multi-call answer).",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Natural-language trip description, e.g. 'Enchantments late August for 3 nights' " +
            "or 'somewhere in the North Cascades next weekend, intermediate'. Required " +
            "unless `area_id` is provided.",
        ),
      area_id: z
        .string()
        .optional()
        .describe(
          "Explicit area ID from `find_areas`. Either query or area_id must be provided.",
        ),
      start_date: z.string().optional().describe("YYYY-MM-DD; default today."),
      end_date: z.string().optional().describe("YYYY-MM-DD; default today + 7d."),
      mode: z.enum(["fast", "thorough"]).optional().describe("Default 'fast'."),
    },
    async (args) => {
      const start = args.start_date ?? isoToday();
      const end = args.end_date ?? daysFromNowIso(7);
      const mode = args.mode ?? "fast";

      if (!args.query && !args.area_id) {
        return payloadResponse(
          ok(
            { resolution: "missing_input" as const },
            [],
            "low",
            ["Provide either `query` (free-text) or `area_id` (from find_areas)."],
          ),
        );
      }
      const explicit = args.area_id ? findAreaById(args.area_id) : undefined;
      const picked: { area: Area; kind: ResolutionKind } | undefined = explicit
        ? { area: explicit, kind: "id" }
        : args.query
          ? pickArea(args.query)
          : undefined;
      const area = picked?.area;
      const matchKind = picked?.kind;
      const exactMatch = matchKind === "id" || matchKind === "exact";
      const sources: Source[] = [];
      const queryStr = args.query ?? "";

      if (!area) {
        const candidates = queryStr ? suggestArea(queryStr) : [];
        const data = {
          resolution: "ambiguous" as const,
          query: queryStr,
          candidate_areas: candidates.map((a) => ({
            id: a.id,
            name: a.name,
            popularity: a.popularity,
            drive_hours_from_seattle: a.drive_hours_from_seattle,
            permit_system: a.permit_system,
          })),
          suggested_followups: candidates.map((a) => ({
            tool: "research_trip",
            args: { query: queryStr, area_id: a.id, start_date: start, end_date: end, mode },
            reason: `Re-run with area_id='${a.id}'`,
          })),
        };
        sources.push(
          makeSource(
            "https://github.com/tusensii/mcp-stack/blob/main/apps/trip-mcp/src/areas.ts",
            "trip-mcp areas registry",
            { confidence: "medium" },
          ),
        );
        return payloadResponse(
          ok(data, sources, "low", [
            "Area could not be uniquely resolved. Pick one of the candidates and re-run, " +
              "or call `find_areas` to browse the registry.",
          ]),
        );
      }

      const { lat, lon } = area.centroid;
      const caveats: string[] = [];

      const [
        permitResults,
        forecastResult,
        alertsResult,
        npsAlertsResult,
        passesResult,
        firesResult,
        reportsResult,
      ] = await Promise.all([
        Promise.all(
          (area.rec_gov_permit_ids ?? []).map((id) =>
            safe(`ridb:${id}`, () => getPermit(env, id)),
          ),
        ),
        safe("nws.forecast", () => getForecast(env, lat, lon)),
        safe("nws.alerts", () => getActiveAlerts(env, lat, lon)),
        area.nps_park_code
          ? safe("nps.alerts", () => getNpsAlerts(env, [area.nps_park_code!]))
          : Promise.resolve({ ok: true, value: null }),
        area.approach_passes.length > 0
          ? safe("wsdot.passes", () => getMountainPassConditions(env))
          : Promise.resolve({ ok: true, value: null }),
        safe("wfigs.fires", () =>
          getActiveFirePerimeters(env, [lon - 0.6, lat - 0.5, lon + 0.6, lat + 0.5]),
        ),
        safe("wta.reports", async () => {
          // WTA's `title=` filter matches against trip-report titles which
          // use HIKE NAMES (e.g. "Image Lake", "Spider Gap"), not wilderness
          // names. For an area like Glacier Peak Wilderness, the bare name
          // returns nothing. Try the area name first (stripped of parens),
          // then fall back to the most distinctive alias if zero results.
          const stripParens = (s: string) => s.replace(/\([^)]*\)/g, "").trim();
          const primary = stripParens(area.name);
          let reports = await searchTripReports(env, primary, 8);
          if (reports.length === 0 && area.aliases.length > 0) {
            // Pick the first alias that isn't a near-duplicate of the name
            // and is distinctive enough (≥6 chars, not generic).
            const distinctive = area.aliases.find(
              (a) =>
                a.length >= 6 &&
                !primary.toLowerCase().includes(a.toLowerCase()) &&
                !a.toLowerCase().includes(primary.toLowerCase()),
            );
            if (distinctive) {
              reports = await searchTripReports(env, distinctive, 8);
            }
          }
          return reports;
        }),
      ]);

      // Permits
      const permitDetails = permitResults
        .map((r, i) => ({ ok: r.ok, value: r.value, id: area.rec_gov_permit_ids?.[i] }))
        .filter((r) => r.ok && r.value);
      const permitsSummary =
        area.permit_system === "rec_gov_lottery"
          ? `Lottery system. ${permitDetails.length} permit record(s) on Recreation.gov. See area notes for application windows and historical odds.`
          : area.permit_system === "rec_gov_reservation"
            ? `Reservation system on Recreation.gov. ${permitDetails.length} permit record(s) found.`
            : area.permit_system === "self_issued"
              ? "Self-issued at trailhead kiosk. No advance reservation needed; Northwest Forest Pass / America the Beautiful Pass required for parking."
              : "No permit required.";
      if (area.rec_gov_permit_ids?.length && permitDetails.length === 0) {
        caveats.push(
          "Could not fetch RIDB permit metadata — RIDB_API_KEY may be missing or upstream is down. " +
            "Run `get_permits` for direct results.",
        );
      }
      permitDetails.forEach((p) => {
        if (p.id) {
          sources.push(
            makeSource(
              `https://www.recreation.gov/permits/${p.id}`,
              `Recreation.gov permit ${p.id}`,
              { license: "CC-BY", confidence: "high" },
            ),
          );
        }
      });

      // Weather
      let weatherSummary = "Forecast unavailable.";
      if (forecastResult.ok && forecastResult.value) {
        const forecast = forecastResult.value as { periods?: Array<{ name?: string; shortForecast?: string; temperature?: number }> } | { properties?: { periods?: Array<{ name?: string; shortForecast?: string; temperature?: number }> } };
        const periods =
          (forecast as { periods?: Array<{ name?: string; shortForecast?: string; temperature?: number }> }).periods ??
          (forecast as { properties?: { periods?: Array<{ name?: string; shortForecast?: string; temperature?: number }> } }).properties?.periods ??
          [];
        const pick = periods.slice(0, 4);
        weatherSummary = pick
          .map((p) => `${p.name ?? "?"}: ${p.shortForecast ?? "?"} (${p.temperature ?? "?"}°F)`)
          .join(" | ") || "Forecast unavailable.";
        sources.push(
          makeSource(`https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}`, "NWS forecast", {
            license: "Public Domain",
            confidence: "high",
          }),
        );
      } else {
        caveats.push(
          `NWS forecast unavailable${forecastResult.ok ? "" : ` (${forecastResult.error})`}. Mountain valley forecasts may not capture pass-elevation differences anyway.`,
        );
      }

      // Active NWS alerts
      const activeAlerts: string[] = [];
      if (alertsResult.ok && alertsResult.value) {
        const data = alertsResult.value as { features?: Array<{ properties?: { headline?: string; event?: string } }> };
        for (const f of data.features ?? []) {
          const h = f.properties?.headline ?? f.properties?.event;
          if (h) activeAlerts.push(h);
        }
      }

      // NPS alerts
      const npsAlerts: string[] = [];
      if (npsAlertsResult.ok && npsAlertsResult.value) {
        const data = npsAlertsResult.value as { data?: Array<{ title?: string; category?: string }> };
        for (const a of data.data ?? []) {
          if (a.title) npsAlerts.push(`[${a.category ?? "alert"}] ${a.title}`);
        }
        if (area.nps_park_code) {
          sources.push(
            makeSource(
              `https://www.nps.gov/${area.nps_park_code}/learn/news/index.htm`,
              `NPS ${area.nps_park_code.toUpperCase()} alerts`,
              { license: "Public Domain", confidence: "high" },
            ),
          );
        }
      }

      // Mountain passes — distinguish three states clearly so downstream
      // readers (Claude, the user) don't conflate "no passes configured"
      // with "WSDOT call failed". Earlier versions silently swallowed the
      // 401, returning "area has no approach passes" for Glacier Peak.
      let passesStatus: string;
      if (area.approach_passes.length === 0) {
        passesStatus = "No approach pass status to report (area has no approach passes).";
      } else if (!passesResult.ok || !passesResult.value) {
        const passErr =
          "error" in passesResult && typeof passesResult.error === "string"
            ? passesResult.error
            : "empty response";
        passesStatus =
          `Configured passes (${area.approach_passes.join(", ")}): WSDOT fetch failed — ${passErr}. ` +
          "Check wsdot.wa.gov/travel/real-time/mountainpasses directly.";
        caveats.push(
          `WSDOT mountain pass status unavailable for ${area.approach_passes.join(", ")}: ${passErr}.`,
        );
      } else {
        const allPasses = passesResult.value as MountainPassCondition[];
        const matched: MountainPassCondition[] = area.approach_passes
          .map((name) => findPassByName(allPasses, name))
          .filter((p): p is MountainPassCondition => p !== undefined && p !== null);
        passesStatus =
          matched.length === 0
            ? `Approach pass(es) ${area.approach_passes.join(", ")} listed but no WSDOT name match — verify directly at wsdot.wa.gov/travel/.`
            : matched
                .map(
                  (p) =>
                    `${p.MountainPassName ?? "?"}: ${p.RoadCondition ?? "?"} (${p.WeatherCondition ?? "?"})${p.TravelAdvisoryActive ? " [advisory active]" : ""}`,
                )
                .join(" | ");
        sources.push(
          makeSource("https://wsdot.wa.gov/travel/real-time/mountainpasses", "WSDOT mountain passes", {
            license: "Public Domain",
            confidence: "high",
          }),
        );
      }

      // Fires
      let firesCount = 0;
      if (firesResult.ok && firesResult.value) {
        const data = firesResult.value as { features?: unknown[] };
        firesCount = (data.features ?? []).length;
        sources.push(
          makeSource(
            "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0",
            "WFIGS active fire perimeters",
            { license: "Public Domain", confidence: "high" },
          ),
        );
      }

      // Trip reports
      let reportsSummary = "No recent trip reports found.";
      if (reportsResult.ok && reportsResult.value && Array.isArray(reportsResult.value)) {
        const reports = reportsResult.value as Array<{ title?: string; date_hiked?: string; url?: string }>;
        const top = reports.slice(0, 3);
        reportsSummary =
          top.length > 0
            ? top.map((r) => `${r.date_hiked ?? "?"}: ${r.title ?? "?"} (${r.url ?? ""})`).join(" || ")
            : "No recent trip reports found.";
        if (top.length > 0) {
          sources.push(
            makeSource("https://www.wta.org/go-outside/trip-reports", "WTA trip reports", {
              license: "All rights reserved (WTA) — used with attribution",
              confidence: "medium",
            }),
          );
        }
      }

      const allActiveAlerts = [...activeAlerts, ...npsAlerts];
      const conditionsSummary = `${allActiveAlerts.length} active alert(s); ${firesCount} active fire perimeter(s) within ~50km. Approach passes: ${passesStatus}`;

      const followups: SuggestedFollowup[] = [];
      if (mode === "thorough" || activeAlerts.length > 0 || firesCount > 0) {
        followups.push({
          tool: "get_conditions",
          args: { area_id: area.id },
          reason: "Drill into specific alert/fire/closure details.",
        });
      }
      if (area.permit_system.startsWith("rec_gov")) {
        followups.push({
          tool: "get_permits",
          args: { area_id: area.id },
          reason: "Verify permit availability windows and current rules.",
        });
        followups.push({
          tool: "check_availability",
          args: { permit_id: area.rec_gov_permit_ids?.[0], start_date: start, end_date: end },
          reason: "Check live availability for the requested date range.",
        });
      }
      followups.push({
        tool: "get_trip_reports",
        args: { area_id: area.id, since_days: 30 },
        reason: "Fresh ground-truth on snow level, water sources, blowdowns from recent visitors.",
      });
      followups.push({
        tool: "get_safety_brief",
        args: { area_id: area.id },
        reason: "Bear canisters, river crossings, ranger station phone numbers.",
      });
      if (mode === "thorough") {
        followups.push({
          tool: "web_research",
          args: { query: `${area.name} conditions ${start}`, use_default_sites: true },
          reason: "PNW outdoor community sources for any nuance not covered by WTA.",
        });
        followups.push({
          tool: "get_route_info",
          args: { area_id: area.id },
          reason: "Trailhead coords, OSM trails/water, elevation.",
        });
      }

      const synthesis: TripSynthesis = {
        area: { id: area.id, name: area.name },
        query: queryStr,
        date_range: { start, end },
        permits_summary: permitsSummary + (area.notes ? ` — ${area.notes}` : ""),
        weather_summary: weatherSummary,
        conditions_summary: conditionsSummary,
        recent_trip_reports_summary: reportsSummary,
        bear_canister_required: area.bear_canister_required,
        ranger_stations: area.ranger_stations,
        approach_passes_status: passesStatus,
        active_alerts: allActiveAlerts,
        fires_within_50km: firesCount,
        suggested_followups: followups,
      };

      // Per-source failure list — earlier versions collapsed to a count
      // ("1 upstream source(s) failed") which leaks no diagnostic info.
      const sourceResults: Array<{ label: string; result: { ok: boolean; error?: string } }> = [
        { label: "nws.forecast", result: forecastResult },
        { label: "nws.alerts", result: alertsResult },
        { label: "nps.alerts", result: npsAlertsResult },
        { label: "wsdot.passes", result: passesResult },
        { label: "wfigs.fires", result: firesResult },
        { label: "wta.reports", result: reportsResult },
      ];
      for (let i = 0; i < permitResults.length; i++) {
        const r = permitResults[i];
        const id = area.rec_gov_permit_ids?.[i] ?? "?";
        sourceResults.push({
          label: `ridb.permit:${id}`,
          result: { ok: Boolean(r?.ok), error: r?.error },
        });
      }
      const failures = sourceResults.filter((s) => !s.result.ok);
      const failureCount = failures.length;
      const confidence: "high" | "medium" | "low" = !exactMatch
        ? "low"
        : failureCount === 0
          ? "high"
          : failureCount <= 2
            ? "medium"
            : "low";
      if (!exactMatch && matchKind) {
        const label =
          matchKind === "partial" ? "partial substring" : "fuzzy token";
        caveats.push(
          `Area resolution was a ${label} match ("${queryStr}" → ${area.name}). ` +
            "Re-run with explicit area_id if this is the wrong area.",
        );
      }
      if (failureCount > 0) {
        const labels = failures
          .map((f) => `${f.label}${f.result.error ? ` (${f.result.error})` : ""}`)
          .join(", ");
        caveats.push(`Upstream source failures: ${labels}.`);
      }
      caveats.push(
        "This is research, not ground truth. Conditions change rapidly. Before your trip: " +
          "(1) call the ranger station listed below, (2) re-check NWS within 24h of departure, " +
          "(3) file a trip plan with someone who isn't on the trip.",
      );

      sources.push(
        makeSource(
          "https://github.com/tusensii/mcp-stack/blob/main/apps/trip-mcp/src/areas.ts",
          "trip-mcp areas registry",
          { fetched_at: nowIso(), confidence: "medium" },
        ),
      );

      return payloadResponse(ok<TripSynthesis>(synthesis, sources, confidence, caveats));
    },
  );
}

// Re-export for testing convenience.
export type { TripSynthesis, SuggestedFollowup };
export type { ToolPayload };
