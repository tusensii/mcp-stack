import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findAreaById, findAreaByText, type Area } from "../areas.js";
import type { Env } from "../types.js";
import { ok, empty, makeSource } from "../types.js";
import { payloadResponse } from "./utils.js";

interface SafetyBrief {
  area: { id: string; name: string };
  bear_canister_required: boolean;
  ranger_stations: Area["ranger_stations"];
  wildlife: string[];
  river_crossing_concerns: string[];
  exposure_notes: string[];
  ten_essentials_specific: string[];
  avalanche_terrain_likely: boolean;
  permit_system: Area["permit_system"];
}

const RIVER_KNOWN: Record<string, string[]> = {
  olympic: [
    "Hoh, Queets, Bogachiel and East Fork Quinault all run high in late spring/early summer; logjam crossings only — never wade.",
    "Royal Creek and Cameron Creek can be impassable in early-season snowmelt.",
  ],
  north_cascades: [
    "Thunder Creek and Big Beaver routinely impassable in early-season snowmelt; check ranger station for log status.",
    "Stehekin River drainages: bridge status varies year to year.",
  ],
  glacier_peak: [
    "Suiattle, Sauk, and White Chuck rivers are glacier-fed; flow ramps after warm afternoons. Cross early.",
  ],
  mt_rainier: [
    "Carbon, Tahoma, Nisqually rivers are glacial; afternoon flows can double or triple morning levels.",
  ],
};

const WILDLIFE_KNOWN: Record<string, string[]> = {
  enchantments: [
    "Mountain goats: aggressive habituated population, especially around Snow Lakes/Aasgard. Pee on rocks well off-trail (≥200ft).",
    "Resident black bears in Colchuck Lake basin; bear canister required.",
  ],
  olympic: [
    "Mountain goats removed from Olympics 2018–2020, but Mt. Ellinor area still sees occasional individuals.",
    "Black bears throughout; bear canister required everywhere.",
    "Cougars present but rarely seen; standard precautions.",
  ],
  goat_rocks: [
    "Mountain goats throughout; stay 100+ ft away. Habituated near Snowgrass Flat.",
  ],
  mt_rainier: ["Black bears in subalpine meadows; food storage poles or bear canisters required."],
  glacier_peak: ["Black bear country. Hang food or use canister."],
  north_cascades: ["Grizzly recovery zone (no confirmed sightings recently). Black bears common."],
};

const AVALANCHE_LIKELY = new Set([
  "enchantments",
  "mt_rainier",
  "north_cascades",
  "glacier_peak",
  "mt_baker",
  "mt_adams",
  "goat_rocks",
  "alpine_lakes",
  "henry_jackson",
]);

export function registerSafetyTools(server: McpServer, _env: Env): void {
  void _env;
  server.tool(
    "get_safety_brief",
    "Returns a structured safety brief for a PNW area: bear canister rules, recent wildlife considerations, river crossing concerns (with named rivers and timing advice), avalanche-terrain flag, ranger station phone numbers, and area-specific Ten Essentials notes. ALWAYS INCLUDE THIS OUTPUT in answers to safety-critical queries (river crossings, snow travel, glacier travel, avalanche terrain, solo trips, off-trail routes, climbs). The ranger station phone numbers are the single most reliable source of real-time backcountry conditions — surface them prominently in your final answer to the user, not buried in a footnote. This is curated guidance, not real-time conditions: combine with `get_trip_reports` (recent ground-truth) and `get_conditions` (current alerts/fires/passes) for a complete picture. If you're answering a query about future conditions (snow level next month, river flow next week), explicitly tell the user this brief is general guidance and the ranger call is the only way to get current ground truth.",
    {
      area_id: z.string().optional(),
      area_name: z.string().optional(),
      route_type: z
        .enum(["trail", "off_trail", "glacier", "climb"])
        .optional()
        .describe("Affects which Ten Essentials items to surface."),
      season: z
        .enum(["winter", "spring", "summer", "fall"])
        .optional()
        .describe("Seasonal hazard hints."),
    },
    async (args) => {
      const area = args.area_id
        ? findAreaById(args.area_id)
        : args.area_name
          ? findAreaByText(args.area_name)
          : undefined;

      if (!area) {
        return payloadResponse(
          empty<SafetyBrief>(
            [
              "Could not resolve area. Pass `area_id` (from `find_areas`) or a recognizable " +
                "area name. Without a match, the safety brief is generic — recommend calling " +
                "the relevant ranger district directly.",
            ],
            [],
          ),
        );
      }

      const wildlife = WILDLIFE_KNOWN[area.id] ?? [
        "No area-specific wildlife notes; assume standard PNW black bear precautions and proper food storage.",
      ];
      const rivers = RIVER_KNOWN[area.id] ?? [];
      const avalanche = AVALANCHE_LIKELY.has(area.id);

      const exposure: string[] = [];
      if (avalanche) {
        exposure.push(
          "Avalanche terrain present. Check NWAC (nwac.us) for the avalanche forecast Nov–May.",
        );
      }
      if (area.approach_passes.includes("North Cascades Highway (SR 20)")) {
        exposure.push("SR 20 typically closed mid-Nov through late April; verify with WSDOT.");
      }
      if (area.bear_canister_required) {
        exposure.push("Bear canister required; rentals available at most ranger stations.");
      }

      const tenEssentials: string[] = [
        "Map (Green Trails or USGS quad — do not rely on phone-only)",
        "Compass + know how to use it",
        "Sun protection (alpine UV is brutal)",
        "Insulation (extra layer beyond what you think you need)",
        "Headlamp + spare batteries",
        "First aid kit",
        "Fire (lighter + storm matches in waterproof)",
        "Repair kit + duct tape",
        "Extra food (one extra day's worth)",
        "Extra water + treatment",
        "Emergency shelter (bivy or large trash bag)",
      ];
      if (args.route_type === "glacier" || args.route_type === "climb") {
        tenEssentials.push(
          "Crampons + ice axe + helmet",
          "Rope + glacier travel kit (prussiks, pickets, harness)",
          "Beacon + probe + shovel for winter/spring",
        );
      }
      if (args.season === "winter" || args.season === "spring") {
        tenEssentials.push("Snowshoes or skis", "Avalanche beacon + probe + shovel", "Map waterproofing");
      }

      const brief: SafetyBrief = {
        area: { id: area.id, name: area.name },
        bear_canister_required: area.bear_canister_required,
        ranger_stations: area.ranger_stations,
        wildlife,
        river_crossing_concerns: rivers,
        exposure_notes: exposure,
        ten_essentials_specific: tenEssentials,
        avalanche_terrain_likely: avalanche,
        permit_system: area.permit_system,
      };

      const sources = [
        makeSource(
          "https://github.com/tusensii/mcp-stack/blob/main/apps/trip-mcp/src/areas.ts",
          "trip-mcp safety knowledge base (hand-curated from USFS/NPS/NWAC public guidance)",
          { confidence: "medium" },
        ),
      ];

      const caveats = [
        "This brief is curated guidance, not real-time conditions. ALWAYS call the ranger " +
          "station listed below for current snow level, river crossings, road status, and " +
          "wildlife activity before your trip.",
        "Wildlife and river data are seasonal — verify with recent WTA trip reports via " +
          "`get_trip_reports`.",
      ];

      return payloadResponse(ok(brief, sources, "medium", caveats));
    },
  );
}
