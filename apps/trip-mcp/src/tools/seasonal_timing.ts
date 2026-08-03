/**
 * get_seasonal_timing: curated typical-year windows (melt-out, larches,
 * wildflowers, bugs, crossing peak, crowds) per registry area. Pure
 * curation — no upstream calls; confidence capped at medium with a
 * standing typical-year caveat.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env, ToolPayload } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import { findAreaById } from "../areas.js";
import { SEASONAL, type Seasonal, type SeasonalWindow } from "../seasonal.js";
import { payloadResponse, titledTool } from "./utils.js";

const TYPICAL_YEAR_CAVEAT =
  "Typical-year windows — actual timing swings ±2–3 weeks with snowpack. Verify against current snow levels (get_weather freezing levels) and recent trip reports before planning around any window.";

/** Day-of-year (1-366) for an "MM-DD" string; non-leap calendar. */
export function dayOfYear(mmdd: string): number {
  const [mm, dd] = mmdd.split("-").map((s) => Number.parseInt(s, 10));
  const cumDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return (cumDays[(mm ?? 1) - 1] ?? 0) + (dd ?? 1);
}

/**
 * Does a window overlap the interest period for `month` — that month
 * plus a ~6-week lookahead? Used by the optional month filter.
 */
export function windowRelevantToMonth(window: SeasonalWindow, month: number): boolean {
  const interestStart = dayOfYear(`${String(month).padStart(2, "0")}-01`);
  const interestEnd = interestStart + 72; // month (~31d) + ~6 weeks
  const s = dayOfYear(window.start);
  const e = dayOfYear(window.end);
  const overlaps = (from: number, to: number) => s <= to && e >= from;
  // Handle lookahead wrapping past year end by also testing shifted +365.
  return overlaps(interestStart, interestEnd) || overlaps(interestStart - 365, interestEnd - 365);
}

function filterByMonth(seasonal: Seasonal, month: number): Seasonal {
  const keepWindow = (w: SeasonalWindow | undefined) =>
    w && windowRelevantToMonth(w, month) ? w : undefined;
  const out: Seasonal = {
    bug_pressure: seasonal.bug_pressure,
    ...(seasonal.crowds ? { crowds: seasonal.crowds } : {}),
    ...(seasonal.notes ? { notes: seasonal.notes } : {}),
  };
  const snowFree = keepWindow(seasonal.snow_free_typical);
  if (snowFree) out.snow_free_typical = snowFree;
  const larch = keepWindow(seasonal.larch_window);
  if (larch) out.larch_window = larch;
  const flowers = keepWindow(seasonal.wildflower_peak);
  if (flowers) out.wildflower_peak = flowers;
  const crossings = keepWindow(seasonal.stream_crossing_peak);
  if (crossings) out.stream_crossing_peak = crossings;
  return out;
}

interface SeasonalTimingData {
  area_id: string;
  area_name: string;
  month_filter: number | null;
  seasonal: Seasonal | null;
  framing: string;
}

export function registerSeasonalTimingTools(server: McpServer, env: Env): void {
  void env;
  titledTool(
    server,
    "get_seasonal_timing",
    "Checking seasonal windows…",
    "Curated typical-year timing windows for a registry area: snow_free_typical (melt-out → first persistent snow), larch_window (areas where larches are a real draw: Enchantments, North Cascades, Pasayten), wildflower_peak, bug_pressure by month, stream_crossing_peak (snowmelt high water — pairs with get_river_conditions), and crowds. Windows are MM-DD ranges for a TYPICAL year and swing ±2–3 weeks with snowpack — never present one as a guarantee; cross-check recent trip reports. Optional `month` (1–12) filters to windows active that month or starting within ~6 weeks. Areas without curated data return an explicit empty status. Registry-curated data (low-to-medium confidence) — WTA-fallback areas are not covered.",
    {
      area_id: z.string().describe("Registry area id (e.g. 'enchantments')."),
      month: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("Filter to windows active this month or starting within ~6 weeks."),
    },
    async ({ area_id, month }) => {
      const area = findAreaById(area_id);
      if (!area) {
        return payloadResponse(
          empty<SeasonalTimingData>([
            `Unknown area_id: ${area_id}. Seasonal timing is registry-curated — WTA-fallback areas are not covered; try recent trip reports via get_trip_reports instead.`,
          ]),
        );
      }

      const seasonal = SEASONAL[area_id];
      const sources = [
        makeSource(
          "https://github.com/tusensii/mcp-stack/blob/main/apps/trip-mcp/src/seasonal.ts",
          "trip-mcp curated seasonal registry (WTA seasonal guidance + guidebook consensus)",
          { confidence: "low" },
        ),
      ];

      if (!seasonal) {
        const data: SeasonalTimingData = {
          area_id,
          area_name: area.name,
          month_filter: month ?? null,
          seasonal: null,
          framing: "no curated seasonal data for this area yet",
        };
        return payloadResponse(
          ok(data, sources, "low", [
            `No curated seasonal data for ${area_id} yet — an explicit empty status, not an error. Use get_trip_reports for current conditions.`,
            TYPICAL_YEAR_CAVEAT,
          ]),
        );
      }

      const filtered = typeof month === "number" ? filterByMonth(seasonal, month) : seasonal;
      const data: SeasonalTimingData = {
        area_id,
        area_name: area.name,
        month_filter: month ?? null,
        seasonal: filtered,
        framing: "typical-year windows (curated); confidence medium at best",
      };
      return payloadResponse(
        ok<SeasonalTimingData>(data, sources, "medium", [TYPICAL_YEAR_CAVEAT]) as ToolPayload<SeasonalTimingData>,
      );
    },
  );
}
