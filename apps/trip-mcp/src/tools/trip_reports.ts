/**
 * `get_trip_reports` MCP tool. Aggregates recent WTA trip reports for an
 * area or trail. Confidence is "medium": data is scraped, not contractual,
 * and may be stale up to TTL.WTA_LIST.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import { findAreaById } from "../areas.js";
import { getTripReport, searchTripReports, type TripReportSummary } from "../sources/wta.js";
import { searchRedditReports } from "../sources/reddit.js";
import { searchNwhikersReports } from "../sources/nwhikers.js";
import {
  extractConditions,
  rollupConditions,
  type ExtractedConditions,
  type ReportExtraction,
} from "../extraction.js";
import { payloadResponse, titledTool } from "./utils.js";

/** Detail pages fetched per call in extraction mode (throttled scrape). */
const DETAIL_FETCH_LIMIT = 5;
/** Cap per secondary source — lower-signal than WTA by design. */
const SECONDARY_SOURCE_CAP = 5;

type ReportSource = "wta" | "nwhikers" | "reddit";

interface MergedReport extends TripReportSummary {
  source: ReportSource;
  conditions?: ExtractedConditions;
  /** "detail" = full report page + WTA conditions table; "blurb" = listing snippet only. */
  extraction_source?: "detail" | "blurb";
}

const argsShape = {
  area_id: z
    .string()
    .optional()
    .describe("Canonical PNW area id (e.g. 'enchantments'). See find_areas."),
  area_name: z
    .string()
    .optional()
    .describe("Free-text area name; used as the search query if no area_id."),
  trail_name: z
    .string()
    .optional()
    .describe("Specific trail/hike name. Takes precedence as the query."),
  since_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe("Filter reports to those hiked within this many days. Default 60."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max reports to return. Default 15."),
  extract_conditions: z
    .boolean()
    .default(false)
    .describe(
      "Attach a structured conditions block (snow/snow line, blowdowns, road, bugs, water, crowding) per report plus a cross-report rollup. Heuristic keyword extraction (low confidence) — absent fields are null, never inferred. Fetches up to 5 full report pages (slower on cold cache).",
    ),
  include_secondary_sources: z
    .boolean()
    .default(true)
    .describe(
      "Also query NWHikers and Reddit (r/WashingtonHikers, r/PNWhiking) as lower-signal secondary sources — capped at 5 each, ranked after WTA, labeled per-report via `source`. Both are best-effort: either may be unreachable from server-side clients (named caveat when so).",
    ),
};

export function registerTripReportTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_trip_reports",
    "Reading recent trip reports…",
    "Returns recent Washington Trails Association (WTA) trip reports for a PNW area or trail. Trip reports are user-submitted observations of actual conditions (snow level, water sources, blowdowns, road status, bug pressure) and are the single best source of recent ground-truth for WA hikes — better than AllTrails for this use case. Scraped from wta.org with attribution; cache may be up to 24h stale (medium confidence). Use `area_id` from `find_areas` when available; if no reports come back for the area name, the orchestrator will retry with the most distinctive alias (e.g., \"Image Lake\" instead of \"Glacier Peak Wilderness\"). PNW only — for non-WA trips this tool will return empty; fall back to `web_research`. If a report mentions a road closure, blowdown, or condition that contradicts an official source (e.g., USFS says trail open, report says blocked), surface BOTH to the user and recommend they call the ranger station to resolve.",
    argsShape,
    async ({
      area_id,
      area_name,
      trail_name,
      since_days,
      limit,
      extract_conditions,
      include_secondary_sources,
    }) => {
      const sinceDays = since_days ?? 60;
      const max = limit ?? 15;

      // Resolve query: trail_name > area (id-resolved name) > area_name.
      // For area names with parenthetical qualifiers like
      // "Enchantments (Alpine Lakes Wilderness)", WTA's `title=` query
      // does substring matching against trip-report titles which never
      // contain the parens. Strip them for a more permissive match.
      const stripParens = (s: string) => s.replace(/\([^)]*\)/g, "").trim();
      let query: string | null = null;
      if (trail_name && trail_name.trim()) {
        query = trail_name.trim();
      } else if (area_id) {
        const area = findAreaById(area_id);
        query = area ? stripParens(area.name) : area_id;
      } else if (area_name && area_name.trim()) {
        query = stripParens(area_name);
      }

      if (!query) {
        return payloadResponse(
          empty<{ reports: TripReportSummary[]; query_used: string }>([
            "Provide one of: area_id, area_name, or trail_name.",
          ]),
        );
      }

      const sources = [
        makeSource("https://wta.org", "Washington Trails Association", {
          license: "Washington Trails Association — content used with attribution",
          confidence: "medium",
        }),
      ];
      const secondaryCaveats: string[] = [];

      const [wtaReports, redditRes, nwhikersRes] = await Promise.all([
        searchTripReports(env, query, max),
        include_secondary_sources
          ? searchRedditReports(env, query, SECONDARY_SOURCE_CAP)
          : Promise.resolve({ reports: [], errors: [] }),
        include_secondary_sources
          ? searchNwhikersReports(env, query, SECONDARY_SOURCE_CAP)
          : Promise.resolve({ reports: [], errors: [] }),
      ]);
      secondaryCaveats.push(...redditRes.errors, ...nwhikersRes.errors);

      // Filter by since_days when we have a parseable date.
      const cutoffMs = Date.now() - sinceDays * 86_400_000;
      const withinWindow = (dateStr: string | null) => {
        if (!dateStr) return true; // keep undated rather than drop silently
        const t = Date.parse(dateStr);
        return Number.isNaN(t) ? true : t >= cutoffMs;
      };

      // WTA always ranks first; secondary sources are capped and labeled.
      const filtered: MergedReport[] = wtaReports
        .filter((r) => withinWindow(r.date_hiked))
        .map((r) => ({ ...r, source: "wta" as const }));
      if (include_secondary_sources) {
        for (const r of nwhikersRes.reports.filter((n) => withinWindow(n.date_posted))) {
          filtered.push({
            source: "nwhikers",
            title: r.title,
            url: r.url,
            author: null,
            hike_name: null,
            date_hiked: r.date_posted,
            conditions_blurb: null,
          });
        }
        for (const r of redditRes.reports.filter((p) => withinWindow(p.date_posted))) {
          filtered.push({
            source: "reddit",
            title: `[r/${r.subreddit}] ${r.title}`,
            url: r.url,
            author: r.author,
            hike_name: null,
            date_hiked: r.date_posted,
            conditions_blurb: r.blurb,
          });
        }
        if (nwhikersRes.reports.length > 0) {
          sources.push(
            makeSource("https://www.nwhikers.net/forums/", "NWHikers.net forums", {
              license: "NWHikers.net — content used with attribution",
              confidence: "low",
            }),
          );
        }
        if (redditRes.reports.length > 0) {
          sources.push(
            makeSource(
              "https://www.reddit.com/r/WashingtonHikers/",
              "Reddit (r/WashingtonHikers, r/PNWhiking)",
              { license: "user-generated content, linked with attribution", confidence: "low" },
            ),
          );
        }
      }

      if (filtered.length === 0) {
        return payloadResponse(
          empty<{ reports: MergedReport[]; query_used: string }>(
            [
              `No PNW trip reports found in the last ${sinceDays} days for this query — try a broader area or check WTA directly`,
              ...secondaryCaveats,
            ],
            sources,
          ),
        );
      }

      const caveats = [
        "WTA data is scraped (no SLA); fields may be missing if site markup changed.",
        "Reports without a parseable hike date are kept in results.",
        ...secondaryCaveats,
      ];
      if (include_secondary_sources) {
        caveats.push(
          "NWHikers/Reddit results are lower-signal than WTA (no structured conditions, looser topicality) — treat as leads to read, not extracted fact.",
        );
      }

      if (!extract_conditions) {
        return payloadResponse(
          ok({ reports: filtered, query_used: query }, sources, "medium", caveats),
        );
      }

      // Extraction mode: fetch full pages for the first few WTA reports
      // (the WTA conditions table + body are far higher-signal than the
      // listing blurb); everything else extracts from title+blurb only.
      let wtaDetailBudget = DETAIL_FETCH_LIMIT;
      const withConditions: MergedReport[] = await Promise.all(
        filtered.map(async (r): Promise<MergedReport> => {
          let text = [r.title, r.conditions_blurb].filter(Boolean).join("\n");
          let extractionSource: "detail" | "blurb" = "blurb";
          if (r.source === "wta" && wtaDetailBudget > 0) {
            wtaDetailBudget--;
            try {
              const detail = await getTripReport(env, r.url);
              if (detail) {
                extractionSource = "detail";
                const condTable = Object.entries(detail.conditions)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n");
                text = [r.title, condTable, detail.body, r.conditions_blurb]
                  .filter(Boolean)
                  .join("\n");
              }
            } catch {
              // fall back to blurb extraction
            }
          }
          return { ...r, conditions: extractConditions(text), extraction_source: extractionSource };
        }),
      );

      const extractions: ReportExtraction[] = withConditions.map((r) => ({
        url: r.url,
        title: r.title,
        date_hiked: r.date_hiked,
        conditions: r.conditions!,
      }));

      caveats.push(
        "Condition extraction is heuristic keyword matching (low confidence): absent fields mean the report didn't clearly mention them, not that conditions are absent. Read the cited reports before relying on a specific claim.",
        `Full-page extraction covers the first ${Math.min(DETAIL_FETCH_LIMIT, withConditions.length)} reports; the rest are extracted from listing blurbs only (see per-report extraction_source).`,
      );

      return payloadResponse(
        ok(
          {
            reports: withConditions,
            query_used: query,
            conditions_rollup: rollupConditions(extractions),
            extraction: { method: "heuristic", confidence: "low" as const },
          },
          sources,
          "medium",
          caveats,
        ),
      );
    },
  );
}
