import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AREAS, findAreaById, findAreaWithMatch, type Area } from "../areas.js";
import type { Env } from "../types.js";
import { ok, makeSource } from "../types.js";
import { payloadResponse } from "./utils.js";

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

export function registerFindAreasTools(server: McpServer, _env: Env): void {
  void _env;
  server.tool(
    "find_areas",
    "Resolve free-text area queries to canonical area records from the curated PNW registry (currently 12 hand-curated areas: Enchantments, Mt Rainier, North Cascades NP, Olympic NP, Glacier Peak Wilderness, Pasayten, Alpine Lakes Wilderness, Henry M. Jackson Wilderness, Goat Rocks, Mt St Helens, Mt Adams, Mt Baker). Returns area IDs that all other tools accept as `area_id`. This is the right first call for any vague PNW query like \"somewhere in the North Cascades\" or when you're not sure of the canonical area name. For areas outside the registry the response is empty — fall back to `web_research` for the trip details and use `get_weather` with explicit lat/lon. Match types: \"Exact name/alias match\" (high confidence), \"Substring/partial match\" (medium confidence — verify the resolved area is what the user actually meant before relying on it). If the resolved area looks wrong given the user's full query, surface that to the user and re-query with a more distinctive term.",
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

      const sources = [
        makeSource(
          "https://github.com/tusensii/mcp-stack/blob/main/apps/trip-mcp/src/areas.ts",
          "trip-mcp canonical PNW areas registry (hand-curated)",
          { confidence: "medium" },
        ),
      ];

      const caveats: string[] = [];
      if (results.length === 0) {
        caveats.push(
          "No areas matched. The registry covers ~12 high-value PNW destinations. " +
            "For obscure routes, call `web_research` directly.",
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
          ? "low"
          : matchKind === "id" || matchKind === "exact"
            ? "high"
            : "medium";
      return payloadResponse(
        ok({ results, total_in_registry: AREAS.length }, sources, confidence, caveats),
      );
    },
  );
}
