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
import {
  extractConditions,
  rollupConditions,
  type ExtractedConditions,
  type ReportExtraction,
} from "../extraction.js";
import { payloadResponse, titledTool } from "./utils.js";

/** Detail pages fetched per call in extraction mode (throttled scrape). */
const DETAIL_FETCH_LIMIT = 5;

interface ReportWithConditions extends TripReportSummary {
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
};

export function registerTripReportTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_trip_reports",
    "Reading recent trip reports…",
    "Returns recent Washington Trails Association (WTA) trip reports for a PNW area or trail. Trip reports are user-submitted observations of actual conditions (snow level, water sources, blowdowns, road status, bug pressure) and are the single best source of recent ground-truth for WA hikes — better than AllTrails for this use case. Scraped from wta.org with attribution; cache may be up to 24h stale (medium confidence). Use `area_id` from `find_areas` when available; if no reports come back for the area name, the orchestrator will retry with the most distinctive alias (e.g., \"Image Lake\" instead of \"Glacier Peak Wilderness\"). PNW only — for non-WA trips this tool will return empty; fall back to `web_research`. If a report mentions a road closure, blowdown, or condition that contradicts an official source (e.g., USFS says trail open, report says blocked), surface BOTH to the user and recommend they call the ranger station to resolve.",
    argsShape,
    async ({ area_id, area_name, trail_name, since_days, limit, extract_conditions }) => {
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

      const source = makeSource("https://wta.org", "Washington Trails Association", {
        license: "Washington Trails Association — content used with attribution",
        confidence: "medium",
      });

      const reports = await searchTripReports(env, query, max);

      // Filter by since_days when we have a parseable date_hiked.
      const cutoffMs = Date.now() - sinceDays * 86_400_000;
      const filtered = reports.filter((r) => {
        if (!r.date_hiked) return true; // keep undated rather than drop silently
        const t = Date.parse(r.date_hiked);
        return Number.isNaN(t) ? true : t >= cutoffMs;
      });

      if (filtered.length === 0) {
        return payloadResponse(
          empty<{ reports: TripReportSummary[]; query_used: string }>(
            [
              `No PNW trip reports found in the last ${sinceDays} days for this query — try a broader area or check WTA directly`,
            ],
            [source],
          ),
        );
      }

      const caveats = [
        "WTA data is scraped (no SLA); fields may be missing if site markup changed.",
        "Reports without a parseable hike date are kept in results.",
      ];

      if (!extract_conditions) {
        return payloadResponse(
          ok({ reports: filtered, query_used: query }, [source], "medium", caveats),
        );
      }

      // Extraction mode: fetch full pages for the first few reports (the
      // WTA conditions table + body are far higher-signal than the
      // listing blurb); the rest extract from title+blurb only.
      const withConditions: ReportWithConditions[] = await Promise.all(
        filtered.map(async (r, i): Promise<ReportWithConditions> => {
          let text = [r.title, r.conditions_blurb].filter(Boolean).join("\n");
          let extractionSource: "detail" | "blurb" = "blurb";
          if (i < DETAIL_FETCH_LIMIT) {
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
          [source],
          "medium",
          caveats,
        ),
      );
    },
  );
}
