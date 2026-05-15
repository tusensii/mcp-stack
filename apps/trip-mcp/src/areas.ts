/**
 * Canonical PNW area registry. Hand-curated table of the high-value
 * backpacking destinations a Seattle-based user actually goes to.
 * Each entry has the metadata downstream tools need: lat/lon centroid,
 * jurisdiction, permit-system pointer, NPS/USFS unit codes, approach
 * pass(es), and ranger-station contacts.
 *
 * This is the source of truth for `find_areas` and the seed for
 * lookup-by-name in every other tool.
 */

import type { LatLon } from "./types.js";

export type Jurisdiction = "NPS" | "USFS" | "STATE" | "BLM";
export type PermitSystem =
  | "rec_gov_lottery"
  | "rec_gov_reservation"
  | "rec_gov_walkup_mix"
  | "self_issued"
  | "none";

export interface RangerStation {
  name: string;
  phone: string;
  hours?: string;
}

export interface Area {
  id: string;
  name: string;
  aliases: string[];
  centroid: LatLon;
  jurisdiction: Jurisdiction;
  unit: string; // e.g. "MORA", "NOCA", "OLYM", "MBS", "OWNF"
  /** NPS API parkCode if applicable. */
  nps_park_code?: string;
  /** RIDB facility/permit IDs known for this area. */
  rec_gov_permit_ids?: string[];
  permit_system: PermitSystem;
  approach_passes: string[]; // WSDOT pass names
  bear_canister_required: boolean;
  popularity: "iconic" | "well_known" | "moderate" | "obscure";
  drive_hours_from_seattle: number;
  ranger_stations: RangerStation[];
  notes?: string;
  /** Forest Service forest slug for alert page scraping. */
  usfs_forest_slug?: string;
}

export const AREAS: Area[] = [
  {
    id: "enchantments",
    name: "Enchantments (Alpine Lakes Wilderness)",
    aliases: ["enchantments", "the enchantments", "core enchantment zone", "snow lakes", "stuart lake", "colchuck", "aasgard"],
    centroid: { lat: 47.4733, lon: -120.7867 },
    jurisdiction: "USFS",
    unit: "OWNF",
    rec_gov_permit_ids: ["233273", "445863"],
    permit_system: "rec_gov_lottery",
    approach_passes: ["Stevens Pass", "Snoqualmie Pass"],
    bear_canister_required: true,
    popularity: "iconic",
    drive_hours_from_seattle: 2.75,
    ranger_stations: [
      { name: "Leavenworth Ranger Station (Wenatchee River RD)", phone: "(509) 548-2550" },
    ],
    usfs_forest_slug: "okawen",
    notes:
      "Advanced lottery Feb 15–Mar 1; results ~Mar 15; unclaimed permits release Apr 1. " +
      "Core Zone <5%, Snow Zone ~15%, Colchuck/Stuart higher. Daily Lottery via geofenced " +
      "mobile app for walk-up permits. Bear canister required.",
  },
  {
    id: "mt_rainier",
    name: "Mount Rainier National Park",
    aliases: ["rainier", "mount rainier", "wonderland trail", "spray park", "summerland"],
    centroid: { lat: 46.853, lon: -121.7603 },
    jurisdiction: "NPS",
    unit: "MORA",
    nps_park_code: "mora",
    rec_gov_permit_ids: ["4675317"],
    permit_system: "rec_gov_reservation",
    approach_passes: ["Cayuse Pass", "Chinook Pass", "White Pass"],
    bear_canister_required: false,
    popularity: "iconic",
    drive_hours_from_seattle: 2.5,
    ranger_stations: [
      { name: "Wilderness Information Center (Longmire)", phone: "(360) 569-6650" },
      { name: "White River Wilderness Info Center", phone: "(360) 569-6670" },
    ],
    notes:
      "Wilderness permit required year-round. Early-Access Lottery Feb 10–Mar 3 (2026); " +
      "general on-sale Apr 25; reservable through Oct 12. 2/3 advance, 1/3 walk-up. " +
      "Wonderland Trail demand outstrips supply.",
  },
  {
    id: "north_cascades",
    name: "North Cascades National Park",
    aliases: ["north cascades", "noca", "cascade pass", "sahale", "thunder creek", "stehekin"],
    centroid: { lat: 48.7718, lon: -121.2985 },
    jurisdiction: "NPS",
    unit: "NOCA",
    nps_park_code: "noca",
    rec_gov_permit_ids: ["4675322"],
    permit_system: "rec_gov_reservation",
    approach_passes: ["North Cascades Highway (SR 20)", "Stevens Pass"],
    bear_canister_required: false,
    popularity: "iconic",
    drive_hours_from_seattle: 2.75,
    ranger_stations: [
      { name: "Wilderness Information Center (Marblemount)", phone: "(360) 854-7245" },
    ],
    notes:
      "60% reservable / 40% walk-up. Early-Access Lottery Mar 2–Mar 13 (2026); general " +
      "on-sale Apr 29; reservable through Oct 10. SR 20 typically closed mid-Nov to mid-late April.",
  },
  {
    id: "olympic",
    name: "Olympic National Park",
    aliases: ["olympic", "olym", "high divide", "seven lakes basin", "royal basin", "enchanted valley", "ozette", "shi shi"],
    centroid: { lat: 47.8021, lon: -123.6044 },
    jurisdiction: "NPS",
    unit: "OLYM",
    nps_park_code: "olym",
    rec_gov_permit_ids: ["4098362"],
    permit_system: "rec_gov_reservation",
    approach_passes: [],
    bear_canister_required: true,
    popularity: "iconic",
    drive_hours_from_seattle: 3.0,
    ranger_stations: [
      { name: "Wilderness Information Center (Port Angeles)", phone: "(360) 565-3100" },
    ],
    notes:
      "Wilderness camping permit required year-round. Summer season (May 15–Oct 15) " +
      "releases Apr 15 7AM PT. No early-access lottery. Bear canisters required everywhere. " +
      "High-demand quota areas: Sol Duc/7 Lakes, Royal Basin, Grand Valley, Lake Constance, " +
      "Upper Lena, Flapjack, Cape Alava.",
  },
  {
    id: "glacier_peak",
    name: "Glacier Peak Wilderness",
    aliases: ["glacier peak", "image lake", "spider gap", "buck creek pass", "white pass loop"],
    centroid: { lat: 48.1117, lon: -121.1144 },
    jurisdiction: "USFS",
    unit: "MBS",
    permit_system: "self_issued",
    approach_passes: ["Stevens Pass"],
    bear_canister_required: false,
    popularity: "well_known",
    drive_hours_from_seattle: 3.0,
    ranger_stations: [
      { name: "Darrington Ranger Station", phone: "(360) 436-1155" },
      { name: "Glacier Public Service Center (Mt Baker RD)", phone: "(360) 599-2714" },
    ],
    usfs_forest_slug: "mbs",
    notes:
      "Self-issued wilderness permits at trailheads. Northwest Forest Pass required for " +
      "trailhead parking. FR 7400 (Suiattle River) closures common. Remote, low-traffic.",
  },
  {
    id: "pasayten",
    name: "Pasayten Wilderness",
    aliases: ["pasayten", "horseshoe basin", "boundary trail"],
    centroid: { lat: 48.8483, lon: -120.5167 },
    jurisdiction: "USFS",
    unit: "OWNF",
    permit_system: "self_issued",
    approach_passes: ["North Cascades Highway (SR 20)"],
    bear_canister_required: false,
    popularity: "moderate",
    drive_hours_from_seattle: 4.5,
    ranger_stations: [
      { name: "Methow Valley Ranger Station (Winthrop)", phone: "(509) 996-4003" },
    ],
    usfs_forest_slug: "okawen",
    notes:
      "Self-issued. SR 20 access only — closes mid-Nov to mid-late April. Largest " +
      "wilderness in WA at 530K acres; few visitors east of the crest.",
  },
  {
    id: "alpine_lakes",
    name: "Alpine Lakes Wilderness (non-Enchantments)",
    aliases: ["alpine lakes", "snow lake", "necklace valley", "spectacle lake", "lemah"],
    centroid: { lat: 47.5333, lon: -121.3833 },
    jurisdiction: "USFS",
    unit: "MBS",
    permit_system: "self_issued",
    approach_passes: ["Snoqualmie Pass", "Stevens Pass"],
    bear_canister_required: false,
    popularity: "iconic",
    drive_hours_from_seattle: 1.5,
    ranger_stations: [
      { name: "Snoqualmie Ranger District (North Bend)", phone: "(425) 888-1421" },
    ],
    usfs_forest_slug: "mbs",
    notes:
      "Self-issued except for Enchantments Permit Area. Closest big wilderness to Seattle. " +
      "I-90 and US-2 trailheads.",
  },
  {
    id: "henry_jackson",
    name: "Henry M. Jackson Wilderness",
    aliases: ["henry jackson", "lake byrne", "blanca lake", "monte cristo"],
    centroid: { lat: 47.95, lon: -121.25 },
    jurisdiction: "USFS",
    unit: "MBS",
    permit_system: "self_issued",
    approach_passes: ["Stevens Pass"],
    bear_canister_required: false,
    popularity: "well_known",
    drive_hours_from_seattle: 2.0,
    ranger_stations: [
      { name: "Skykomish Ranger Station", phone: "(360) 677-2414" },
      { name: "Verlot Public Service Center", phone: "(360) 691-7791" },
    ],
    usfs_forest_slug: "mbs",
    notes: "Self-issued. US-2 and Mountain Loop Highway access.",
  },
  {
    id: "goat_rocks",
    name: "Goat Rocks Wilderness",
    aliases: ["goat rocks", "snowgrass flat", "old snowy", "knife edge"],
    centroid: { lat: 46.5, lon: -121.4167 },
    jurisdiction: "USFS",
    unit: "GP",
    permit_system: "self_issued",
    approach_passes: ["White Pass"],
    bear_canister_required: false,
    popularity: "well_known",
    drive_hours_from_seattle: 3.25,
    ranger_stations: [
      { name: "Cowlitz Valley Ranger Station (Randle)", phone: "(360) 497-1100" },
    ],
    usfs_forest_slug: "giffordpinchot",
    notes:
      "Self-issued. PCT corridor through Knife's Edge between Old Snowy and Elk Pass. " +
      "Mountain goats (give them space and salty pee a wide berth).",
  },
  {
    id: "mt_st_helens",
    name: "Mount St. Helens National Volcanic Monument",
    aliases: ["mt st helens", "monitor ridge", "loowit trail", "mt margaret"],
    centroid: { lat: 46.1912, lon: -122.1944 },
    jurisdiction: "USFS",
    unit: "GP",
    rec_gov_permit_ids: ["234574"],
    permit_system: "rec_gov_reservation",
    approach_passes: [],
    bear_canister_required: false,
    popularity: "iconic",
    drive_hours_from_seattle: 3.5,
    ranger_stations: [
      { name: "Mount St. Helens NVM Headquarters", phone: "(360) 449-7800" },
    ],
    usfs_forest_slug: "giffordpinchot",
    notes:
      "Climbing permit required Apr–Oct via Recreation.gov; quota ramps to ~500/day in " +
      "summer. Free self-issued Dec–Mar. Mt. Margaret Backcountry has its own permit system.",
  },
  {
    id: "mt_adams",
    name: "Mount Adams Wilderness",
    aliases: ["mt adams", "south climb", "round the mountain"],
    centroid: { lat: 46.2024, lon: -121.4909 },
    jurisdiction: "USFS",
    unit: "GP",
    permit_system: "self_issued",
    approach_passes: [],
    bear_canister_required: false,
    popularity: "well_known",
    drive_hours_from_seattle: 4.0,
    ranger_stations: [
      { name: "Mt. Adams Ranger District (Trout Lake)", phone: "(509) 395-3402" },
    ],
    usfs_forest_slug: "giffordpinchot",
    notes:
      "Cascades Volcano Pass required for travel above 7000 ft (~$15-30 in season). " +
      "Below 7000 ft is self-issued.",
  },
  {
    id: "mt_baker",
    name: "Mount Baker Wilderness",
    aliases: ["mt baker", "baker", "park butte", "chain lakes", "yellow aster butte"],
    centroid: { lat: 48.7768, lon: -121.8145 },
    jurisdiction: "USFS",
    unit: "MBS",
    permit_system: "self_issued",
    approach_passes: ["Mt. Baker Highway (SR 542)"],
    bear_canister_required: false,
    popularity: "iconic",
    drive_hours_from_seattle: 2.5,
    ranger_stations: [
      { name: "Glacier Public Service Center", phone: "(360) 599-2714" },
    ],
    usfs_forest_slug: "mbs",
    notes:
      "Self-issued. SR 542 to Heather Meadows / Artist Point — last ~3 miles closed in winter.",
  },
];

/**
 * Generic outdoor terms that must NOT participate in fuzzy area matching.
 * Without this filter, "Glacier Peak Wilderness Image Lake" tokenizes a
 * "lake" that matches Enchantments' "stuart lake" alias and confidently
 * resolves to the wrong area 70 miles away.
 */
const GENERIC_TERMS = new Set([
  "lake", "lakes", "wilderness", "park", "national", "forest", "trail",
  "valley", "mountain", "mountains", "creek", "river", "pass", "peak",
  "peaks", "ridge", "basin", "meadow", "meadows", "gulch", "saddle",
  "summit", "falls", "glacier", "ranger", "station", "camp", "campground",
  "trip", "hike", "backpack", "north", "south", "east", "west",
  "late", "early", "august", "july", "september", "june", "october",
  "weekend", "next", "near", "around", "the", "with", "into",
]);

function tokenize(q: string): string[] {
  return q
    .split(/[\s,;/—\-()]+/)
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length >= 4 && !GENERIC_TERMS.has(t));
}

export type MatchKind = "exact" | "partial" | "fuzzy";

interface MatchResult {
  area: Area;
  score: number;
  kind: MatchKind;
}

function scoreArea(area: Area, q: string, qTokens: string[]): MatchResult | null {
  // === Tier 1: EXACT — full-string equivalence with id, name, or any alias.
  if (area.id === q) return { area, score: 1000, kind: "exact" };
  const name = area.name.toLowerCase();
  if (name === q) return { area, score: 1000, kind: "exact" };
  for (const alias of area.aliases) {
    if (alias.toLowerCase() === q) {
      return { area, score: 900, kind: "exact" };
    }
  }

  // === Tier 2: PARTIAL — whole query is a substring of name/alias OR vice
  // versa. Useful (e.g. "alpine lake" → Alpine Lakes Wilderness) but not
  // an exact match — the user may have meant a different area entirely.
  let score = 0;
  let isPartial = false;
  if (name.includes(q) || q.includes(name)) {
    score += 100;
    isPartial = true;
  }
  for (const alias of area.aliases) {
    const a = alias.toLowerCase();
    if (a.length >= 5 && (q.includes(a) || a.includes(q))) {
      score += 60;
      isPartial = true;
    }
  }
  if (isPartial) return { area, score, kind: "partial" };

  // === Tier 3: FUZZY — distinct tokens overlap with name/alias/id tokens.
  // Generic terms already filtered by tokenize().
  const aliasTokens = new Set<string>();
  for (const alias of area.aliases) {
    for (const t of tokenize(alias)) aliasTokens.add(t);
  }
  for (const t of tokenize(name)) aliasTokens.add(t);
  for (const t of tokenize(area.id.replace(/_/g, " "))) aliasTokens.add(t);

  for (const t of qTokens) {
    if (aliasTokens.has(t)) score += 20;
  }

  return score > 0 ? { area, score, kind: "fuzzy" } : null;
}

export interface AreaMatch {
  area: Area;
  /** Deprecated — use `kind` instead. True only when kind === "exact". */
  exact: boolean;
  kind: MatchKind;
  score: number;
}

/**
 * Score every area against the query and return the best match. Returns
 * `undefined` if nothing matches above the noise floor.
 *
 * Callers that want the underlying score (to drop confidence on fuzzy
 * matches) should use {@link findAreaWithMatch} instead.
 */
export function findAreaByText(text: string): Area | undefined {
  return findAreaWithMatch(text)?.area;
}

export function findAreaWithMatch(text: string): AreaMatch | undefined {
  const q = text.toLowerCase().trim();
  if (!q) return undefined;
  const qTokens = tokenize(q);

  let best: MatchResult | null = null;
  for (const area of AREAS) {
    const m = scoreArea(area, q, qTokens);
    if (!m) continue;
    if (!best || m.score > best.score) best = m;
  }
  if (!best) return undefined;

  // Require a meaningful score for fuzzy matches: at least 2 distinct token
  // hits. A single 20-point token match (a stray proper noun) is too weak.
  if (best.kind === "fuzzy" && best.score < 40) return undefined;

  return {
    area: best.area,
    exact: best.kind === "exact",
    kind: best.kind,
    score: best.score,
  };
}

export function findAreaById(id: string): Area | undefined {
  return AREAS.find((a) => a.id === id);
}
