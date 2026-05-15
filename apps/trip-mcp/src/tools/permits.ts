/**
 * Permit tools: `get_permits` (metadata) and `check_availability` (grid).
 *
 * Both register on a shared McpServer. They synthesize Recreation.gov
 * permit metadata from our hand-curated Area registry plus live RIDB
 * lookups, returning a `ToolPayload` so Claude has uniform sources/caveats.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Area } from "../areas.js";
import { findAreaById, findAreaByText } from "../areas.js";
import {
  getPermit,
  getPermitAvailability,
  type RidbPermit,
} from "../sources/ridb.js";
import type { Confidence, Env, Source, ToolPayload } from "../types.js";
import { empty, makeSource, nowIso, ok } from "../types.js";
import { payloadResponse } from "./utils.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface PermitInfo {
  permit_id: string;
  name: string | null;
  description: string | null;
  rec_gov_url: string;
  ridb_url: string;
  application_window: string | null;
  fees_note: string | null;
  lottery_odds: string | null;
}

interface GetPermitsData {
  area_id: string;
  area_name: string;
  permit_system: Area["permit_system"];
  permits: PermitInfo[];
  ranger_stations: Area["ranger_stations"];
  notes: string | null;
}

function confidenceFromAge(seconds: number): Confidence {
  return seconds < 3600 ? "high" : "medium";
}

function resolveArea(args: {
  area_id?: string;
  area_name?: string;
  trail_name?: string;
}): Area | undefined {
  if (args.area_id) {
    const a = findAreaById(args.area_id);
    if (a) return a;
  }
  if (args.area_name) {
    const a = findAreaByText(args.area_name);
    if (a) return a;
  }
  if (args.trail_name) return findAreaByText(args.trail_name);
  return undefined;
}

function permitInfoFromMeta(
  permitId: string,
  meta: RidbPermit | null,
  area: Area,
): PermitInfo {
  const recUrl = `https://www.recreation.gov/permits/${permitId}`;
  const ridbUrl = `https://ridb.recreation.gov/api/v1/permits/${permitId}`;
  return {
    permit_id: permitId,
    name:
      (typeof meta?.PermitEntranceName === "string" && meta.PermitEntranceName) ||
      (typeof meta?.FacilityName === "string" && (meta.FacilityName as string)) ||
      null,
    description:
      (typeof meta?.PermitEntranceDescription === "string" &&
        (meta.PermitEntranceDescription as string)) ||
      (typeof meta?.FacilityDescription === "string" && (meta.FacilityDescription as string)) ||
      null,
    rec_gov_url: recUrl,
    ridb_url: ridbUrl,
    application_window: area.notes ?? null,
    fees_note: null,
    lottery_odds: null,
  };
}

function selfIssuedPayload(area: Area): ToolPayload<GetPermitsData> {
  const data: GetPermitsData = {
    area_id: area.id,
    area_name: area.name,
    permit_system: area.permit_system,
    permits: [],
    ranger_stations: area.ranger_stations,
    notes:
      area.notes ??
      "Self-issued wilderness permit at the trailhead. Northwest Forest Pass typically required for parking.",
  };
  const sources: Source[] = [
    makeSource(
      "https://www.fs.usda.gov/visit/passes-permits",
      "USFS Passes & Permits",
      { confidence: "medium" },
    ),
  ];
  return ok(data, sources, "medium", [
    "Self-issued area: no online reservation needed. Confirm trailhead pass requirements with the listed ranger station.",
  ]);
}

export function registerPermitTools(server: McpServer, env: Env): void {
  server.tool(
    "get_permits",
    "Returns Recreation.gov permit metadata for a PNW backpacking area: permit name, recreation.gov URL, application window dates, fees, lottery context, and historical odds where known (Enchantments Core Zone <5%, Snow Zone ~15%, etc.). For self-issued USFS wilderness areas (Glacier Peak, Pasayten, Henry M. Jackson) returns a static USFS pointer plus the local ranger station phone — there is no advance reservation system to query. If you already have an `area_id` from `find_areas` or a prior tool call in this conversation, pass it directly. Use this BEFORE `check_availability` to confirm the permit system is `rec_gov_lottery` or `rec_gov_reservation` — `check_availability` is meaningless for self-issued areas.",
    {
      area_id: z.string().optional().describe("Canonical area id, e.g. 'enchantments', 'mt_rainier'."),
      area_name: z.string().optional().describe("Free-text area name; resolved via aliases."),
      trail_name: z.string().optional().describe("Trail name to match against area aliases."),
    },
    async (args) => {
      const area = resolveArea(args);
      if (!area) {
        return payloadResponse(
          empty<GetPermitsData>([
            "No matching area. Provide one of area_id, area_name, or trail_name that maps to a known PNW area.",
          ]),
        );
      }

      if (area.permit_system === "self_issued" || area.permit_system === "none") {
        return payloadResponse(selfIssuedPayload(area));
      }

      const ids = area.rec_gov_permit_ids ?? [];
      if (ids.length === 0) {
        return payloadResponse(
          empty<GetPermitsData>(
            [
              `Area '${area.id}' uses ${area.permit_system} but no rec_gov_permit_ids are registered.`,
            ],
            [
              makeSource(
                "https://www.recreation.gov/",
                "Recreation.gov",
                { confidence: "low" },
              ),
            ],
          ),
        );
      }

      const fetchedAt = nowIso();
      const results = await Promise.all(ids.map((id) => getPermit(env, id)));
      const permits: PermitInfo[] = [];
      const caveats: string[] = [];
      const sources: Source[] = [];
      let anyOk = false;

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i] as string;
        const r = results[i];
        if (!r) continue;
        const meta = r.ok ? r.data : null;
        if (r.ok) anyOk = true;
        if (!r.ok) {
          // RIDB doesn't expose permit-by-public-ID consistently — IDs from
          // www.recreation.gov URLs don't always map to RIDB's `/permits/{id}`
          // path, which returns the recreation.gov landing HTML. The curated
          // `area.notes` field is the authoritative source for application
          // windows / fees / lottery odds, so don't alarm-caveat here.
          if (r.error === "ridb_auth_failed") {
            caveats.push("RIDB API key rejected — permit metadata is stale.");
          } else if (r.error === "ridb_rate_limited") {
            caveats.push("RIDB rate-limited; metadata may be stale.");
          }
          // Other RIDB failures (404, non-JSON, network) are silent — registry
          // notes already cover what users actually need.
        }
        permits.push(permitInfoFromMeta(id, meta, area));
        sources.push(
          makeSource(
            `https://www.recreation.gov/permits/${id}`,
            `Recreation.gov permit ${id}`,
            { fetched_at: fetchedAt, confidence: r.ok ? "high" : "low" },
          ),
        );
      }

      const data: GetPermitsData = {
        area_id: area.id,
        area_name: area.name,
        permit_system: area.permit_system,
        permits,
        ranger_stations: area.ranger_stations,
        notes: area.notes ?? null,
      };

      // The curated registry is authoritative. RIDB enrichment, when it
      // works, bumps confidence from "medium" to "high"; when it fails the
      // registry data is still trustworthy.
      const confidence: Confidence = anyOk ? "high" : "medium";
      return payloadResponse(ok(data, sources, confidence, caveats));
    },
  );

  server.tool(
    "check_availability",
    "Checks live Recreation.gov permit availability for a date range. ONLY meaningful for `rec_gov_lottery` and `rec_gov_reservation` permit systems — call `get_permits` first to confirm the area uses one of these systems and to obtain the permit_id. For `self_issued` areas (Glacier Peak, Pasayten, most USFS wilderness) skip this tool entirely and use `get_permits` for the kiosk and ranger pointer. Returns the raw availability grid plus a one-line summary. Note: lottery permits (e.g., Enchantments 233273, 445863) may not return live availability through this endpoint because lotteries aren't \"availability\" in the campsite-grid sense — for lottery odds and windows, the `area.notes` from `find_areas` carries the curated context.",
    {
      permit_id: z.string().describe("RIDB permit id, e.g. '233273' for the Enchantments."),
      start_date: z.string().regex(ISO_DATE).describe("YYYY-MM-DD inclusive start."),
      end_date: z.string().regex(ISO_DATE).describe("YYYY-MM-DD inclusive end."),
      party_size: z.number().int().min(1).max(50).optional().describe("Optional party size hint."),
    },
    async ({ permit_id, start_date, end_date, party_size }) => {
      if (start_date > end_date) {
        return payloadResponse(
          empty<unknown>(["start_date must be on or before end_date."]),
        );
      }

      const fetchedAt = nowIso();
      const res = await getPermitAvailability(env, permit_id, start_date, end_date);
      const recGovUrl = `https://www.recreation.gov/permits/${permit_id}`;

      if (!res.ok || !res.data) {
        const caveat =
          res.error === "ridb_not_found"
            ? `Permit ${permit_id} not found.`
            : res.error === "ridb_rate_limited"
              ? "Recreation.gov rate-limited — try again in a minute."
              : res.error === "ridb_auth_failed"
                ? "RIDB API key rejected."
                : `Availability fetch failed: ${res.error ?? "unknown"}.`;
        return payloadResponse(
          empty<unknown>(
            [caveat],
            [makeSource(recGovUrl, `Recreation.gov permit ${permit_id}`, { confidence: "low" })],
          ),
        );
      }

      const ageSeconds = Math.max(
        0,
        Math.round((Date.now() - new Date(fetchedAt).getTime()) / 1000),
      );
      const summary =
        `Availability fetched for permit ${permit_id} ${start_date}..${end_date}` +
        (party_size ? ` (party_size=${party_size})` : "") +
        ". Inspect grid for per-day quotas.";

      const data = {
        permit_id,
        start_date,
        end_date,
        party_size: party_size ?? null,
        summary,
        availability: res.data.raw,
      };

      const sources: Source[] = [
        makeSource(res.data.source_url, "RIDB / Recreation.gov availability", {
          fetched_at: fetchedAt,
          confidence: confidenceFromAge(ageSeconds),
        }),
        makeSource(recGovUrl, `Recreation.gov permit ${permit_id}`, {
          fetched_at: fetchedAt,
          confidence: "high",
        }),
      ];

      return payloadResponse(
        ok(data, sources, confidenceFromAge(ageSeconds), [
          "Availability changes minute-to-minute; cached up to 5 minutes.",
        ]),
      );
    },
  );
}
