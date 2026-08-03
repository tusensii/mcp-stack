/**
 * Access roads per registry area (issue #85). Data-only schema: each
 * road names its managing agency, which decides how live status is
 * resolved — WSDOT pass conditions (state highways), NPS alerts (park
 * roads), or the USFS forest alerts-page mention scan (forest roads).
 */

export type RoadManager = "wsdot" | "nps" | "usfs";

export interface AccessRoad {
  name: string;
  manager: RoadManager;
  /** WSDOT mountain-pass name for findPassByName (manager: wsdot). */
  wsdot_pass_name?: string;
  /** NPS park code for alerts filtering (manager: nps). */
  nps_park_code?: string;
  /** Forest slug for the alerts-page scan (manager: usfs). */
  usfs_forest_slug?: string;
  note?: string;
}

export const ACCESS_ROADS: Record<string, AccessRoad[]> = {
  enchantments: [
    { name: "US-2 / Stevens Pass", manager: "wsdot", wsdot_pass_name: "Stevens Pass" },
    { name: "Icicle Creek Rd", manager: "usfs", usfs_forest_slug: "okawen", note: "paved past Snow Lakes TH" },
    { name: "Eightmile Rd (FR 7601)", manager: "usfs", usfs_forest_slug: "okawen", note: "gravel to Stuart/Colchuck TH; opens May–Jun" },
  ],
  mt_rainier: [
    { name: "Longmire–Paradise Rd", manager: "nps", nps_park_code: "mora" },
    { name: "Sunrise Rd (White River)", manager: "nps", nps_park_code: "mora", note: "typically open early Jul–early Oct" },
    { name: "SR 410 / Chinook Pass", manager: "wsdot", wsdot_pass_name: "Chinook Pass" },
    { name: "SR 123 / Cayuse Pass", manager: "wsdot", wsdot_pass_name: "Cayuse Pass" },
  ],
  north_cascades: [
    { name: "SR 20 / North Cascades Highway", manager: "wsdot", wsdot_pass_name: "North Cascades Highway", note: "closed mid-Nov to late Apr between Ross Dam and Mazama" },
    { name: "Cascade River Rd", manager: "nps", nps_park_code: "noca", note: "upper half gravel; typically opens late Jun" },
    { name: "Stehekin Valley Rd", manager: "nps", nps_park_code: "noca", note: "boat/float access only to Stehekin" },
  ],
  olympic: [
    { name: "Hurricane Ridge Rd", manager: "nps", nps_park_code: "olym", note: "winter schedule applies" },
    { name: "Sol Duc Rd", manager: "nps", nps_park_code: "olym" },
    { name: "Olympic Hot Springs Rd (Elwha)", manager: "nps", nps_park_code: "olym", note: "long-term washout — walk/bike beyond Madison Falls" },
  ],
  glacier_peak: [
    { name: "Mountain Loop Hwy", manager: "usfs", usfs_forest_slug: "mbs", note: "gravel Barlow Pass–Darrington; seasonal closure ~Nov–May/Jun" },
    { name: "Suiattle River Rd (FR 26)", manager: "usfs", usfs_forest_slug: "mbs", note: "washout history — verify before trusting" },
    { name: "White Chuck Rd (FR 23)", manager: "usfs", usfs_forest_slug: "mbs" },
  ],
  pasayten: [
    { name: "SR 20 / North Cascades Highway", manager: "wsdot", wsdot_pass_name: "North Cascades Highway" },
    { name: "Harts Pass Rd (FR 5400)", manager: "usfs", usfs_forest_slug: "okawen", note: "narrow cliffside gravel; no trailers; ~Jul–Oct" },
  ],
  alpine_lakes: [
    { name: "I-90 / Snoqualmie Pass", manager: "wsdot", wsdot_pass_name: "Snoqualmie Pass" },
    { name: "US-2 / Stevens Pass", manager: "wsdot", wsdot_pass_name: "Stevens Pass" },
    { name: "Middle Fork Rd (FR 56)", manager: "usfs", usfs_forest_slug: "mbs", note: "paved to Dingford gate" },
  ],
  henry_jackson: [
    { name: "Index-Galena Rd", manager: "usfs", usfs_forest_slug: "mbs", note: "reopened after long washout closure" },
    { name: "Blanca Lake Rd (FR 63)", manager: "usfs", usfs_forest_slug: "mbs" },
  ],
  goat_rocks: [
    { name: "US-12 / White Pass", manager: "wsdot", wsdot_pass_name: "White Pass" },
    { name: "FR 21 (Snowgrass/Berry Patch)", manager: "usfs", usfs_forest_slug: "giffordpinchot", note: "gravel; ~late Jun–Oct" },
  ],
  mt_st_helens: [
    { name: "FR 83 (Climber's Bivouac)", manager: "usfs", usfs_forest_slug: "giffordpinchot", note: "paved; snow-free ~Jun" },
    { name: "FR 99 (Windy Ridge)", manager: "usfs", usfs_forest_slug: "giffordpinchot", note: "opens later, closes earlier than the south side" },
  ],
  mt_adams: [
    { name: "FR 23 (Trout Lake–Randle)", manager: "usfs", usfs_forest_slug: "giffordpinchot", note: "partly gravel, slow" },
    { name: "South Climb Rd (FR 8040-500)", manager: "usfs", usfs_forest_slug: "giffordpinchot", note: "rough gravel; high clearance comfortable" },
  ],
  mt_baker: [
    { name: "SR 542 / Mt. Baker Highway (Artist Point)", manager: "wsdot", wsdot_pass_name: "Mt. Baker Highway", note: "last ~3 mi typically open mid-Jul/Aug–Oct" },
    { name: "Glacier Creek Rd (FR 39)", manager: "usfs", usfs_forest_slug: "mbs" },
    { name: "Schreibers Meadow Rd (FR 13, Park Butte)", manager: "usfs", usfs_forest_slug: "mbs" },
  ],
};

/** Named origins for the impersonal drive-time parameter. */
export const NAMED_ORIGINS: Record<string, { lat: number; lon: number }> = {
  seattle: { lat: 47.6062, lon: -122.3321 },
  everett: { lat: 47.9789, lon: -122.2021 },
  tacoma: { lat: 47.2529, lon: -122.4443 },
  bellingham: { lat: 48.7519, lon: -122.4787 },
  portland: { lat: 45.5152, lon: -122.6784 },
};
