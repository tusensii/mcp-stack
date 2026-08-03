/**
 * get_approach_info: curated approach logistics per registry area —
 * last gas / real gear / supplies / food, cell coverage, road notes,
 * typical drive time. Registry curation by design (no live place APIs).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../types.js";
import { empty, makeSource, ok } from "../types.js";
import { findAreaById } from "../areas.js";
import { APPROACHES, type ApproachCorridor } from "../approach.js";
import { payloadResponse, titledTool } from "./utils.js";

const STANDING_CAVEATS = [
  "Store hours and stock change — call ahead before counting on any single stop (small-town stores keep seasonal hours).",
  "Cell coverage entries are anecdotal community knowledge and carrier-dependent — treat as low confidence.",
  "Road notes are curated, not live — verify current gate/washout status via get_access_status or the ranger district.",
];

interface ApproachInfoData {
  area_id: string;
  area_name: string;
  corridors: ApproachCorridor[] | null;
}

export function registerApproachInfoTools(server: McpServer, env: Env): void {
  void env;
  titledTool(
    server,
    "get_approach_info",
    "Checking approach logistics…",
    "Curated approach logistics for a registry area, by corridor (areas with multiple entrances list each): last_gas, last_real_gear (the last store with actual technical gear — usually much closer to the city than assumed), last_supplies (with honest notes on what small stores realistically stock — hardware stores often carry rain gear), last_food, cell_coverage (anecdotal, low confidence), road_notes (seasonal gates, washouts, clearance), and a typical no-traffic drive_time_from_seattle_min (static curation; get_access_status offers live routing). Registry-curated only — WTA-fallback areas return an explicit no-data status. Data-only registry in src/approach.ts; corrections and new corridors are data edits.",
    {
      area_id: z.string().describe("Registry area id (e.g. 'glacier_peak')."),
    },
    async ({ area_id }) => {
      const area = findAreaById(area_id);
      if (!area) {
        return payloadResponse(
          empty<ApproachInfoData>([
            `Unknown area_id: ${area_id}. Approach info is registry-curated — WTA-fallback areas are not covered.`,
          ]),
        );
      }

      const sources = [
        makeSource(
          "https://github.com/tusensii/mcp-stack/blob/main/apps/trip-mcp/src/approach.ts",
          "trip-mcp curated approach registry",
          { confidence: "medium" },
        ),
      ];
      const corridors = APPROACHES[area_id];
      if (!corridors || corridors.length === 0) {
        return payloadResponse(
          ok<ApproachInfoData>(
            { area_id, area_name: area.name, corridors: null },
            sources,
            "low",
            [
              `No curated approach data for ${area_id} yet — explicit empty status, not an error.`,
              ...STANDING_CAVEATS,
            ],
          ),
        );
      }

      return payloadResponse(
        ok<ApproachInfoData>(
          { area_id, area_name: area.name, corridors },
          sources,
          "medium",
          STANDING_CAVEATS,
        ),
      );
    },
  );
}
