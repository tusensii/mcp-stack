/**
 * get_permit_strategy: the strategic layer over get_permits — realistic
 * acquisition paths, walk-up beta, cancellation patterns, plus an
 * optional live availability probe for reservation-system areas.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import { findAreaById, type RangerStation } from "../areas.js";
import { PERMIT_STRATEGIES, type PermitStrategy } from "../permit_strategy.js";
import { getPermitAvailability } from "../sources/ridb.js";
import { payloadResponse, titledTool } from "./utils.js";

const ODDS_CAVEAT =
  "Odds and windows are historical/approximate (year noted where known) and shift yearly — recreation.gov and the ranger station are authoritative.";

interface LiveAvailability {
  attempted: boolean;
  permit_id?: string;
  month?: string;
  available_days?: number;
  days_seen?: number;
  source_url?: string;
  note: string;
}

/**
 * Generic month summary over recreation.gov/RIDB availability grids.
 * Shapes vary by permit; walk the object tree for date-keyed entries
 * carrying a numeric `remaining`. Returns null when nothing matched —
 * callers degrade to the check_availability pointer, never guess.
 */
export function summarizeAvailability(
  raw: unknown,
  monthPrefix: string,
): { available_days: number; days_seen: number } | null {
  const perDate = new Map<string, number>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const dateM = key.match(/^(\d{4}-\d{2}-\d{2})/);
      if (dateM && dateM[1]!.startsWith(monthPrefix) && value && typeof value === "object") {
        const rec = value as Record<string, unknown>;
        const remaining =
          typeof rec.remaining === "number"
            ? rec.remaining
            : typeof rec.quota_usage_by_member_daily === "number"
              ? rec.quota_usage_by_member_daily
              : null;
        if (remaining !== null) {
          const date = dateM[1]!;
          perDate.set(date, Math.max(perDate.get(date) ?? 0, remaining));
          continue;
        }
      }
      visit(value);
    }
  };
  visit(raw);
  if (perDate.size === 0) return null;
  let available = 0;
  for (const remaining of perDate.values()) {
    if (remaining > 0) available++;
  }
  return { available_days: available, days_seen: perDate.size };
}

function lastDayOfMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map((s) => Number.parseInt(s, 10));
  const last = new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).getUTCDate();
  return `${yyyyMm}-${String(last).padStart(2, "0")}`;
}

interface PermitStrategyData {
  area_id: string;
  area_name: string;
  permit_system: string;
  strategy: PermitStrategy | null;
  live_availability?: LiveAvailability;
  ranger_stations: RangerStation[];
}

export function registerPermitStrategyTools(server: McpServer, env: Env): void {
  titledTool(
    server,
    "get_permit_strategy",
    "Working out permit strategy…",
    "The strategic layer over get_permits: ordered, realistic acquisition paths per area ({method, window, odds_context, effort, notes}) — lotteries, unclaimed-date releases, continuation lotteries, walk-up hold-backs, day-use workarounds, off-season windows — plus walk_up_beta (which ranger stations issue, when lines form), cancellation_beta, and zone_notes. Self-issued areas return the simple truth (kiosk permit, no strategy needed) rather than padding. All odds are historical/approximate and shift yearly — recreation.gov + ranger stations are authoritative (contacts included). With `target_month` (YYYY-MM) on a reservation-system area, a live recreation.gov availability probe summarizes how many days currently show openings (degrades to a check_availability pointer when the grid shape is unreadable).",
    {
      area_id: z.string().describe("Registry area id (e.g. 'enchantments')."),
      target_month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional()
        .describe("YYYY-MM — adds a live availability summary for reservation-system areas."),
    },
    async ({ area_id, target_month }) => {
      const area = findAreaById(area_id);
      if (!area) {
        return payloadResponse(empty<PermitStrategyData>([`Unknown area_id: ${area_id}`]));
      }

      const sources = [
        makeSource(
          "https://github.com/tusensii/mcp-stack/blob/main/apps/trip-mcp/src/permit_strategy.ts",
          "trip-mcp curated permit-strategy registry",
          { confidence: "medium" },
        ),
      ];
      const caveats = [ODDS_CAVEAT];
      const strategy = PERMIT_STRATEGIES[area_id] ?? null;
      if (!strategy) {
        caveats.push(`No curated strategy for ${area_id} yet — explicit empty status; see get_permits for the raw permit records.`);
      }

      let live: LiveAvailability | undefined;
      if (target_month && area.permit_system.startsWith("rec_gov")) {
        const permitId = area.rec_gov_permit_ids?.[0];
        if (!permitId) {
          live = { attempted: false, note: "No rec.gov permit id in the registry for this area." };
        } else {
          try {
            const res = await getPermitAvailability(
              env,
              permitId,
              `${target_month}-01`,
              lastDayOfMonth(target_month),
            );
            if (res.ok && res.data) {
              const summary = summarizeAvailability(res.data.raw, target_month);
              live = {
                attempted: true,
                permit_id: permitId,
                month: target_month,
                source_url: res.data.source_url,
                ...(summary
                  ? {
                      available_days: summary.available_days,
                      days_seen: summary.days_seen,
                      note: `${summary.available_days} of ${summary.days_seen} ${target_month} days currently show availability (any division/site; shapes vary — use check_availability for the full grid).`,
                    }
                  : {
                      note: "Availability grid fetched but its shape wasn't summarizable — use check_availability for the raw grid rather than trusting a guessed count.",
                    }),
              };
            } else {
              live = { attempted: true, permit_id: permitId, month: target_month, note: `availability probe failed: ${res.error ?? "unknown"}` };
              caveats.push(`live_availability: ${res.error ?? "upstream failure"} — strategy data unaffected.`);
            }
          } catch (e) {
            live = { attempted: true, permit_id: permitId, month: target_month, note: `availability probe failed: ${e instanceof Error ? e.message : String(e)}` };
            caveats.push("live_availability probe failed — strategy data unaffected.");
          }
          sources.push(
            makeSource("https://www.recreation.gov/", "Recreation.gov availability", {
              license: "public",
              confidence: "medium",
            }),
          );
        }
      } else if (target_month) {
        live = {
          attempted: false,
          note: `${area_id} is ${area.permit_system} — no reservation grid to probe.`,
        };
      }

      const data: PermitStrategyData = {
        area_id,
        area_name: area.name,
        permit_system: area.permit_system,
        strategy,
        ...(live ? { live_availability: live } : {}),
        ranger_stations: area.ranger_stations,
      };
      return payloadResponse(ok(data, sources, strategy ? "medium" : "low", caveats));
    },
  );
}
