/**
 * Curated camp + water beta per registry area (issue #84). Data-only
 * schema; overnight-specific by design (day-hike parity means this
 * lives in its own tool, not bolted onto get_route_info).
 *
 * Rules ALWAYS cite a governing source URL — fire and food-storage
 * rules are never stated as bare fact. Bear/wildlife safety content
 * stays in get_safety_brief; permits stay in get_permits — this file
 * references, never duplicates.
 */

export interface NamedCamp {
  name: string;
  elevation_ft?: number;
  note?: string;
}

export interface SourcedRule {
  detail: string;
  /** Governing source (forest order / park regulations page). */
  source_url: string;
}

export interface WaterReliability {
  source: string;
  note: string;
}

export interface Camping {
  regulation_model: "designated_sites_only" | "zone_quota" | "dispersed_with_rules";
  regulation_detail: string;
  named_camps?: NamedCamp[];
  fire_rules: SourcedRule;
  food_storage: SourcedRule & { cross_ref: string };
  /** Late-season reliability notes — curated, LOW confidence. */
  water_reliability?: WaterReliability[];
  permits_pointer: string;
}

const MBS_URL = "https://www.fs.usda.gov/mbs";
const OKAWEN_URL = "https://www.fs.usda.gov/okawen";
const GP_URL = "https://www.fs.usda.gov/giffordpinchot";
const SAFETY_XREF = "see get_safety_brief for bear/wildlife practice — not duplicated here";
const PERMITS_XREF = "see get_permits / get_permit_strategy for permit requirements";

export const CAMPING: Record<string, Camping> = {
  enchantments: {
    regulation_model: "zone_quota",
    regulation_detail:
      "Overnight permit zones (Core, Snow, Colchuck, Stuart, Eightmile); camp only in your permitted zone, established sites only in the Core.",
    named_camps: [
      { name: "Core zone established sites (Perfection/Inspiration basin)", elevation_ft: 7000, note: "durable-surface sites; no site reservations — first-come within the zone" },
      { name: "Snow Lakes / Nada Lake sites", elevation_ft: 5400 },
      { name: "Colchuck Lake sites", elevation_ft: 5600 },
    ],
    fire_rules: {
      detail: "Campfires prohibited throughout the Enchantment Permit Area and above 5,000 ft in the Alpine Lakes Wilderness.",
      source_url: OKAWEN_URL,
    },
    food_storage: {
      detail: "Bear canisters REQUIRED for overnight stays in the permit area.",
      source_url: OKAWEN_URL,
      cross_ref: SAFETY_XREF,
    },
    water_reliability: [
      { source: "Core zone tarns/lakes", note: "reliable all season (alpine lakes)" },
      { source: "Aasgard Pass ascent", note: "dry climb after early-season snowmelt — carry from Colchuck" },
      { source: "Snow Creek between Nada and the trailhead", note: "reliable but silty stretches late season" },
    ],
    permits_pointer: PERMITS_XREF,
  },
  mt_rainier: {
    regulation_model: "designated_sites_only",
    regulation_detail:
      "Trailside camping only in designated wilderness camps (itinerary locked to your permit); limited cross-country zones by special arrangement.",
    named_camps: [
      { name: "Summerland", elevation_ft: 5900 },
      { name: "Indian Bar", elevation_ft: 5100 },
      { name: "Mystic Camp", elevation_ft: 5700 },
      { name: "Klapatche Park", elevation_ft: 5500 },
    ],
    fire_rules: {
      detail: "Wood fires prohibited in the Mount Rainier wilderness (stoves only).",
      source_url: "https://www.nps.gov/mora/planyourvisit/wilderness-camping.htm",
    },
    food_storage: {
      detail: "Food storage poles/boxes at most designated camps; canisters recommended elsewhere and required for winter camping.",
      source_url: "https://www.nps.gov/mora/planyourvisit/wilderness-camping.htm",
      cross_ref: SAFETY_XREF,
    },
    water_reliability: [
      { source: "Designated camps", note: "nearly all sit near reliable water (that's why they're there); Klapatche's lake gets stagnant late season — treat carefully" },
    ],
    permits_pointer: PERMITS_XREF,
  },
  north_cascades: {
    regulation_model: "designated_sites_only",
    regulation_detail:
      "Designated camps (trailside) plus permitted cross-country zones; itinerary fixed by permit.",
    named_camps: [
      { name: "Sahale Glacier Camp", elevation_ft: 7600, note: "highest designated camp in the park; wind-exposed rock rings" },
      { name: "Pelton Basin", elevation_ft: 4800 },
      { name: "Thunder Basin camps", elevation_ft: 3200 },
    ],
    fire_rules: {
      detail: "Fires only in provided fire grates at low-elevation camps; prohibited in cross-country zones and above ~4,000 ft in most of the park.",
      source_url: "https://www.nps.gov/noca/planyourvisit/wilderness-trip-planner.htm",
    },
    food_storage: {
      detail: "Bear canisters required in cross-country zones and strongly encouraged everywhere; some camps have bear boxes.",
      source_url: "https://www.nps.gov/noca/planyourvisit/wilderness-trip-planner.htm",
      cross_ref: SAFETY_XREF,
    },
    permits_pointer: PERMITS_XREF,
  },
  olympic: {
    regulation_model: "zone_quota",
    regulation_detail:
      "Quota zones with mixed designated sites (Seven Lakes Basin, Royal Basin) and dispersed zones elsewhere; coast has its own site rules.",
    fire_rules: {
      detail: "Fires prohibited above 3,500 ft parkwide and in several named basins; coast fires only below high-tide line where allowed.",
      source_url: "https://www.nps.gov/olym/planyourvisit/wilderness-regulations.htm",
    },
    food_storage: {
      detail: "Bear canisters required parkwide for wilderness camping (coast included — raccoons are the coast menace).",
      source_url: "https://www.nps.gov/olym/planyourvisit/wilderness-regulations.htm",
      cross_ref: SAFETY_XREF,
    },
    water_reliability: [
      { source: "Coast strips", note: "creek mouths reliable but tannic; carry capacity between named creeks in dry stretches" },
      { source: "High Divide / Seven Lakes", note: "lake water reliable; ridge stretches dry late season" },
    ],
    permits_pointer: PERMITS_XREF,
  },
  glacier_peak: {
    regulation_model: "dispersed_with_rules",
    regulation_detail:
      "Dispersed camping with standard wilderness rules: 100 ft from water and trails, durable surfaces, existing sites preferred.",
    fire_rules: {
      detail: "Fires discouraged above subalpine and prohibited within 100 ft of water; seasonal total bans common (check get_conditions).",
      source_url: MBS_URL,
    },
    food_storage: {
      detail: "No canister requirement; proper hangs or canisters expected — habituated bears around Image Lake historically.",
      source_url: MBS_URL,
      cross_ref: SAFETY_XREF,
    },
    water_reliability: [
      { source: "Image Lake", note: "reliable, but the ridge approach from Suiattle is a long dry climb late season" },
      { source: "White Chuck basin", note: "glacial sources silty — prefer clear tributaries" },
    ],
    permits_pointer: PERMITS_XREF,
  },
  pasayten: {
    regulation_model: "dispersed_with_rules",
    regulation_detail: "Dispersed camping, 100-ft rules; stock parties have additional grazing rules.",
    fire_rules: {
      detail: "Fires generally allowed below treeline outside ban periods; prohibited in some heavily-used basins (posted).",
      source_url: OKAWEN_URL,
    },
    food_storage: {
      detail: "No canister requirement; hangs expected — this is grizzly-adjacent country by designation if not by sightings.",
      source_url: OKAWEN_URL,
      cross_ref: SAFETY_XREF,
    },
    water_reliability: [
      { source: "Boundary Trail high stretches", note: "long dry sections late season — tank up at named lakes" },
    ],
    permits_pointer: PERMITS_XREF,
  },
  alpine_lakes: {
    regulation_model: "dispersed_with_rules",
    regulation_detail:
      "Dispersed with 100-ft rules; several popular lakes have posted no-camping shorelines or designated-site clusters (e.g. Snow Lake).",
    fire_rules: {
      detail: "No fires above 5,000 ft in the Alpine Lakes Wilderness; many lake basins posted no-fire at any elevation.",
      source_url: MBS_URL,
    },
    food_storage: {
      detail: "No canister requirement outside the Enchantment Permit Area; hangs or canisters expected.",
      source_url: MBS_URL,
      cross_ref: SAFETY_XREF,
    },
    permits_pointer: PERMITS_XREF,
  },
  henry_jackson: {
    regulation_model: "dispersed_with_rules",
    regulation_detail: "Dispersed with 100-ft rules; Blanca Lake has heavily-impacted posted sites — use existing ones.",
    fire_rules: {
      detail: "Fires prohibited at Blanca Lake and above 4,000 ft in posted basins.",
      source_url: MBS_URL,
    },
    food_storage: {
      detail: "No canister requirement; hangs expected.",
      source_url: MBS_URL,
      cross_ref: SAFETY_XREF,
    },
    permits_pointer: PERMITS_XREF,
  },
  goat_rocks: {
    regulation_model: "dispersed_with_rules",
    regulation_detail:
      "Dispersed with 100-ft rules; Shoe Lake basin CLOSED to camping (restoration); Snowgrass Flat camping restricted to posted sites.",
    fire_rules: {
      detail: "No fires in the Shoe Lake basin or above 5,000 ft; seasonal bans common.",
      source_url: GP_URL,
    },
    food_storage: {
      detail: "No canister requirement; hangs expected — mountain goats are the real camp raiders (salt).",
      source_url: GP_URL,
      cross_ref: SAFETY_XREF,
    },
    water_reliability: [
      { source: "Knife's Edge / PCT crest", note: "bone dry — last reliable water at Snowgrass side creeks or Elk Pass snowfields early season" },
      { source: "Snowgrass Flat creeks", note: "reliable all season" },
    ],
    permits_pointer: PERMITS_XREF,
  },
  mt_st_helens: {
    regulation_model: "zone_quota",
    regulation_detail:
      "Mount Margaret Backcountry: designated sites by permit only. Climbing route: no camping above treeline on the south side (day climbs); dispersed camping outside the restricted monument zones.",
    named_camps: [
      { name: "Mount Margaret backcountry camps (Dome, Ridge, etc.)", note: "tiny quota, book like a lottery" },
    ],
    fire_rules: {
      detail: "No fires in the Mount Margaret Backcountry or the blast zone.",
      source_url: GP_URL,
    },
    food_storage: {
      detail: "Hangs/canisters expected; no formal requirement.",
      source_url: GP_URL,
      cross_ref: SAFETY_XREF,
    },
    water_reliability: [
      { source: "Loowit Trail circuit", note: "notoriously dry — long waterless stretches on pumice; plan carries and verify seasonal sources in trip reports" },
      { source: "Mount Margaret ridge camps", note: "most are DRY camps — carry from lakes below" },
    ],
    permits_pointer: PERMITS_XREF,
  },
  mt_adams: {
    regulation_model: "dispersed_with_rules",
    regulation_detail: "Dispersed with 100-ft rules; South Climb camps concentrate at Lunch Counter on durable rock.",
    fire_rules: {
      detail: "No fires above 7,000 ft (Cascades Volcano Pass zone); seasonal bans below.",
      source_url: GP_URL,
    },
    food_storage: {
      detail: "No canister requirement; hangs expected below treeline.",
      source_url: GP_URL,
      cross_ref: SAFETY_XREF,
    },
    water_reliability: [
      { source: "South Climb above Morrison Creek", note: "snowmelt only — after the snowfields recede it is a dry route; melt or carry" },
      { source: "Round-the-Mountain meadows", note: "seasonal creeks fade by late Aug in dry years" },
    ],
    permits_pointer: PERMITS_XREF,
  },
  mt_baker: {
    regulation_model: "dispersed_with_rules",
    regulation_detail: "Dispersed with 100-ft rules; heather meadows areas have posted site restrictions.",
    fire_rules: {
      detail: "Fires prohibited in the heather zones (Chain Lakes, Park Butte) — stoves only.",
      source_url: MBS_URL,
    },
    food_storage: {
      detail: "No canister requirement; hangs expected.",
      source_url: MBS_URL,
      cross_ref: SAFETY_XREF,
    },
    permits_pointer: PERMITS_XREF,
  },
};
