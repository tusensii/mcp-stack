import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AREAS, findAreaById, findAreaWithMatch, type Area } from "../areas.js";
import type { Env, Source } from "../types.js";
import { ok, makeSource, nowIso } from "../types.js";
import { getHikeDetail, searchHikes } from "../sources/wta.js";
import { payloadResponse, titledTool } from "./utils.js";

/**
 * Off-registry record synthesized from WTA's hiking guide when the
 * curated registry has no match. Per-request only — never added to the
 * registry, and carries no `area_id` (downstream tools must be called
 * with this record's lat/lon).
 */
interface WtaFallbackRecord {
  source: "wta_fallback";
  name: string;
  lat: number;
  lon: number;
  length_miles: number | null;
  elevation_gain_ft: number | null;
  highest_point_ft: number | null;
  region: string | null;
  wta_url: string;
  alternates: Array<{ hike_name: string; url: string; region: string | null }>;
}

/**
 * Resolve an off-registry query against WTA's hiking guide (3,500+ WA
 * trails). Scrape-backed, so this fails soft: any error or missing
 * coordinate degrades to null and the caller keeps the empty-registry
 * behavior.
 */
async function wtaFallback(env: Env, query: string): Promise<WtaFallbackRecord | null> {
  try {
    const hits = await searchHikes(env, query);
    const top = hits[0];
    if (!top) return null;
    const detail = await getHikeDetail(env, top.url);
    if (!detail || detail.lat === null || detail.lon === null) return null;
    return {
      source: "wta_fallback",
      name: detail.hike_name ?? top.hike_name,
      lat: detail.lat,
      lon: detail.lon,
      length_miles: detail.length_miles ?? top.length_miles,
      elevation_gain_ft: detail.gain_ft ?? top.gain_ft,
      highest_point_ft: detail.highest_point_ft,
      region: detail.region ?? top.region,
      wta_url: detail.url,
      alternates: hits.slice(1, 4).map((h) => ({
        hike_name: h.hike_name,
        url: h.url,
        region: h.region,
      })),
    };
  } catch (e) {
    console.warn("[find_areas.wtaFallback] failed:", (e as Error).message);
    return null;
  }
}

interface AreaSummary {
  id: string;
  name: string;
  jurisdiction: Area["jurisdiction"];
  permit_system: Area["permit_system"];
  drive_hours_from_seattle: number;
  popularity: Area["popularity"];
  centroid: Area["centroid"];
  bear_canister_required: boolean;
  approach_passes: string[];
  notes?: string;
  match_reason?: string;
}

function summarize(area: Area, match_reason?: string): AreaSummary {
  return {
    id: area.id,
    name: area.name,
    jurisdiction: area.jurisdiction,
    permit_system: area.permit_system,
    drive_hours_from_seattle: area.drive_hours_from_seattle,
    popularity: area.popularity,
    centroid: area.centroid,
    bear_canister_required: area.bear_canister_required,
    approach_passes: area.approach_passes,
    notes: area.notes,
    match_reason,
  };
}

export function registerFindAreasTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "find_areas",
    "Finding wilderness areas…",
    "Resolve free-text area queries to canonical area records from the curated PNW registry (currently 12 hand-curated areas: Enchantments, Mt Rainier, North Cascades NP, Olympic NP, Glacier Peak Wilderness, Pasayten, Alpine Lakes Wilderness, Henry M. Jackson Wilderness, Goat Rocks, Mt St Helens, Mt Adams, Mt Baker). Returns area IDs that all other tools accept as `area_id`. This is the right first call for any vague PNW query like \"somewhere in the North Cascades\" or when you're not sure of the canonical area name. Registry matches always take precedence. When the registry has NO match for a named query, the tool attempts a WTA hiking-guide fallback and, on success, returns a `wta_fallback` record (name, trailhead lat/lon, mileage, elevation gain, highest point, WTA URL) at medium-or-lower confidence. Fallback records have NO `area_id` — call downstream tools (get_weather, get_conditions, get_route_info, profile tools) with the record's lat/lon instead. If the WTA lookup also fails, fall back to `web_research`. Match types: \"Exact name/alias match\" (high confidence), \"Substring/partial match\" (medium confidence — verify the resolved area is what the user actually meant before relying on it). If the resolved area looks wrong given the user's full query, surface that to the user and re-query with a more distinctive term.",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Free-text query — e.g. 'enchantments', 'glacier peak', 'rainier wonderland'. " +
            "Matches against canonical names and aliases.",
        ),
      max_drive_hours: z
        .number()
        .optional()
        .describe("Max driving hours from Seattle. Default no limit."),
      needs_permit: z
        .enum(["any", "required", "none", "self_issued_ok"])
        .optional()
        .describe(
          "'required' = recreation.gov reservation/lottery; 'none' = no permit; " +
            "'self_issued_ok' = self-issued kiosk permits OK; 'any' = no filter (default).",
        ),
      popularity: z
        .enum(["any", "iconic", "well_known", "moderate", "obscure"])
        .optional()
        .describe("Filter by popularity bucket. Default 'any'."),
      limit: z.number().int().min(1).max(20).optional().describe("Max results (default 10)."),
    },
    async (args) => {
      const limit = args.limit ?? 10;
      const popularity = args.popularity ?? "any";
      const needsPermit = args.needs_permit ?? "any";
      const maxDrive = args.max_drive_hours ?? Infinity;

      let pool: { area: Area; match_reason?: string }[];
      let matchKind: "id" | "exact" | "partial" | "fuzzy" | "none" = "none";
      if (args.query) {
        const byId = findAreaById(args.query);
        if (byId) {
          pool = [{ area: byId, match_reason: "Direct id match" }];
          matchKind = "id";
        } else {
          const match = findAreaWithMatch(args.query);
          if (match) {
            const reason =
              match.kind === "exact"
                ? "Exact name/alias match"
                : match.kind === "partial"
                  ? `Partial substring match (score ${match.score}; could mean a different area — verify)`
                  : `Fuzzy token match (score ${match.score}; verify before relying on it)`;
            pool = [{ area: match.area, match_reason: reason }];
            matchKind = match.kind;
          } else {
            pool = [];
          }
        }
      } else {
        pool = AREAS.map((area) => ({ area }));
      }

      const filtered = pool.filter(({ area }) => {
        if (area.drive_hours_from_seattle > maxDrive) return false;
        if (popularity !== "any" && area.popularity !== popularity) return false;
        if (needsPermit === "required" && !area.permit_system.startsWith("rec_gov")) return false;
        if (needsPermit === "none" && area.permit_system !== "none") return false;
        if (needsPermit === "self_issued_ok") {
          if (area.permit_system !== "self_issued" && area.permit_system !== "none") return false;
        }
        return true;
      });

      const results = filtered.slice(0, limit).map(({ area, match_reason }) =>
        summarize(area, match_reason),
      );

      const sources: Source[] = [
        makeSource(
          "https://github.com/tusensii/mcp-stack/blob/main/apps/trip-mcp/src/areas.ts",
          "trip-mcp canonical PNW areas registry (hand-curated)",
          { confidence: "medium" },
        ),
      ];

      const caveats: string[] = [];

      // Off-registry fallback: only when a named query resolved to nothing
      // in the registry (filter-driven empties are answers, not misses).
      let fallback: WtaFallbackRecord | null = null;
      if (args.query && pool.length === 0) {
        fallback = await wtaFallback(env, args.query);
        if (fallback) {
          sources.push(
            makeSource(fallback.wta_url, "Washington Trails Association hiking guide", {
              license: "Washington Trails Association — content used with attribution",
              confidence: "medium",
              fetched_at: nowIso(),
            }),
          );
          caveats.push(
            "Result is a WTA hiking-guide fallback (scraped, medium confidence at best), not a registry area. " +
              "It has no area_id — pass its lat/lon to downstream tools. Verify it matches the intended trail via the wta_url.",
          );
        }
      }

      if (results.length === 0 && !fallback) {
        caveats.push(
          "No areas matched. The registry covers ~12 high-value PNW destinations, and the " +
            "WTA hiking-guide fallback found nothing usable. For obscure routes, call `web_research` directly.",
        );
      }
      if (matchKind === "partial") {
        caveats.push(
          "Match was a partial substring (e.g. 'alpine lake' → 'Alpine Lakes Wilderness'). " +
            "These often resolve correctly but can land on a sibling area — verify before " +
            "drilling into permits / weather.",
        );
      } else if (matchKind === "fuzzy") {
        caveats.push(
          "Match was fuzzy (token overlap only); the registry returned its best guess but did " +
            "NOT find an exact alias. Verify the area is what you meant before drilling in.",
        );
      }

      const confidence: "high" | "medium" | "low" =
        results.length === 0
          ? fallback
            ? "medium"
            : "low"
          : matchKind === "id" || matchKind === "exact"
            ? "high"
            : "medium";
      return payloadResponse(
        ok(
          {
            results,
            total_in_registry: AREAS.length,
            ...(fallback ? { wta_fallback: fallback } : {}),
          },
          sources,
          confidence,
          caveats,
        ),
      );
    },
  );
}
