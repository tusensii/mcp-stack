/**
 * Curated approach-logistics data per registry area (issue #82).
 * Registry-style curation by design — NO live place-search APIs.
 *
 * SCHEMA (adding areas/corridors is a data-only change): each area maps
 * to one or more approach corridors. All fields optional strings —
 * honest prose beats fake structure for "what does it realistically
 * stock". `cell_coverage` is community-knowledge anecdote (low
 * confidence, carrier-dependent). `drive_time_from_seattle_min` is a
 * typical no-traffic estimate (static curation, not live routing —
 * see get_access_status for the live option).
 *
 * Curation lesson encoded here: small-town hardware stores often carry
 * rain gear/workwear — the last "real" gear stop is usually far closer
 * to the city than people assume.
 */

export interface ApproachCorridor {
  corridor: string;
  description?: string;
  last_gas?: string;
  /** Last store with actual technical gear. */
  last_real_gear?: string;
  /** Last stop of ANY kind, with an honest note on realistic stock. */
  last_supplies?: string;
  last_food?: string;
  /** Qualitative, carrier-dependent, anecdotal — low confidence. */
  cell_coverage?: string;
  /** Seasonal gates, washout history, clearance requirements. */
  road_notes?: string;
  /** Typical no-traffic estimate. */
  drive_time_from_seattle_min?: number;
}

export const APPROACHES: Record<string, ApproachCorridor[]> = {
  enchantments: [
    {
      corridor: "US-2 via Leavenworth",
      last_gas: "Leavenworth (several stations; also Cashmere eastbound)",
      last_real_gear: "Der Sportsmann, Leavenworth — full outdoor shop, last real gear",
      last_supplies: "Safeway / Dan's Food Market, Leavenworth",
      last_food: "Leavenworth (everything); nothing up Icicle Creek Rd",
      cell_coverage: "Good in Leavenworth; fades up Icicle Creek Rd; Stuart/Colchuck TH mostly dead",
      road_notes:
        "Icicle Creek Rd paved past Snow Lakes TH; Eightmile Rd (FR 7601) to Stuart/Colchuck is washboard gravel, passenger-car OK, typically opens May–Jun.",
      drive_time_from_seattle_min: 160,
    },
  ],
  mt_rainier: [
    {
      corridor: "Nisqually entrance (SR 706 via Ashford)",
      last_gas: "Ashford / Elbe",
      last_real_gear:
        "Whittaker Mountaineering, Ashford (rentals + real gear); last big-box is Puyallup/South Hill",
      last_supplies: "Ashford Valley Grocery",
      last_food: "Ashford / Elbe (limited evenings)",
      cell_coverage: "OK to Ashford; patchy Longmire; Paradise has intermittent coverage",
      road_notes:
        "Longmire–Paradise road maintained year-round (winter gate at Longmire overnight); chains required to carry Nov 1–May 1 regardless of vehicle.",
      drive_time_from_seattle_min: 150,
    },
    {
      corridor: "White River / Sunrise (SR 410 via Enumclaw)",
      last_gas: "Enumclaw (Greenwater has no reliable gas)",
      last_real_gear: "Enumclaw (limited) — REI/big-box before leaving the Sound",
      last_supplies: "Greenwater (Wapiti Woolies + small store)",
      last_food: "Greenwater / Enumclaw",
      cell_coverage: "Dies past Greenwater for most carriers",
      road_notes:
        "Sunrise Rd typically open early Jul–early Oct; SR 410 over Chinook/Cayuse closed in winter.",
      drive_time_from_seattle_min: 135,
    },
  ],
  north_cascades: [
    {
      corridor: "SR 20 via Marblemount",
      last_gas: "Marblemount — last gas for ~74 miles eastbound on SR 20",
      last_real_gear: "Nothing east of Burlington/Mount Vernon big-boxes — buy before I-5",
      last_supplies: "Marblemount general store (basics only)",
      last_food: "Marblemount / Concrete",
      cell_coverage: "Gone past Marblemount for most carriers; Newhalem has NPS wifi pockets",
      road_notes:
        "SR 20 closes ~mid-Nov to late Apr between Ross Dam and Mazama. Cascade River Rd: 23 mi, upper half gravel, passenger-car OK when dry, typically melts open late Jun.",
      drive_time_from_seattle_min: 165,
    },
  ],
  olympic: [
    {
      corridor: "US-101 via Port Angeles (north side)",
      last_gas: "Port Angeles",
      last_real_gear: "Swain's General Store + Brown's Outdoor, Port Angeles — genuinely good gear",
      last_supplies: "Port Angeles Safeway",
      last_food: "Port Angeles",
      cell_coverage: "PA good; Elwha and Sol Duc valleys dead",
      road_notes:
        "Hurricane Ridge Rd runs a winter schedule. Elwha (Olympic Hot Springs) road remains washed out — walk/bike beyond Madison Falls. Sol Duc road paved to trailhead.",
      drive_time_from_seattle_min: 165,
    },
  ],
  glacier_peak: [
    {
      corridor: "Mountain Loop Hwy via Granite Falls",
      description: "Verlot / Barlow Pass side — Gothic Basin, Monte Cristo, White Chuck",
      last_gas: "Granite Falls",
      last_real_gear:
        "Everett (Sportsman's Warehouse / Big 5) — NOTHING with real technical gear past Lake Stevens",
      last_supplies:
        "Mountain Loop General Store, Granite Falls; Granite Falls Ace Hardware stocks rain ponchos and work jackets — small-town hardware stores often cover a forgotten shell",
      last_food: "Granite Falls; Verlot store snacks only (seasonal hours)",
      cell_coverage: "Spotty past Verlot, none at Barlow Pass (all carriers)",
      road_notes:
        "Mountain Loop Hwy is gravel between Barlow Pass and Darrington and closes seasonally (~Nov to May/Jun). Verify status before planning a loop.",
      drive_time_from_seattle_min: 95,
    },
    {
      corridor: "SR 530 via Darrington (north side)",
      description: "Suiattle River / White Chuck access",
      last_gas: "Darrington",
      last_real_gear: "Everett — same as the Granite Falls corridor; nothing in Darrington",
      last_supplies: "Darrington IGA",
      last_food: "Darrington",
      cell_coverage: "Darrington OK; none up Suiattle River Rd (FR 26)",
      road_notes:
        "Suiattle River Rd (FR 26) has a long washout history — confirm current status with Darrington RD before trusting any mileage that assumes the road.",
      drive_time_from_seattle_min: 110,
    },
  ],
  pasayten: [
    {
      corridor: "SR 20 via Winthrop/Mazama",
      last_gas: "Winthrop (Mazama pumps limited)",
      last_real_gear: "Goat's Beard Mountain Supplies, Mazama — excellent and genuinely the last gear",
      last_supplies: "Mazama Store (boutique but real provisions); Evergreen IGA, Winthrop for groceries",
      last_food: "Winthrop / Mazama",
      cell_coverage: "Methow Valley decent; nothing up the Harts Pass road",
      road_notes:
        "Harts Pass Rd (FR 5400): narrow cliff-side gravel, no trailers, typically open ~Jul–Oct. SR 20 winter closure removes the west-side approach entirely.",
      drive_time_from_seattle_min: 240,
    },
  ],
  alpine_lakes: [
    {
      corridor: "I-90 via North Bend",
      last_gas: "North Bend",
      last_real_gear:
        "Pro Ski & Mountain Service, North Bend (mountaineering-oriented); full selection needs Issaquah/Seattle REI",
      last_supplies: "North Bend Safeway / QFC",
      last_food: "North Bend (Twede's et al.); Snoqualmie Pass has a summit deli",
      cell_coverage: "I-90 corridor OK; Middle Fork valley and most lake basins dead",
      road_notes:
        "Middle Fork Rd paved to the Dingford gate. I-90 trailhead lots (Alpental, exits 47/52) overflow early on summer weekends.",
      drive_time_from_seattle_min: 45,
    },
  ],
  henry_jackson: [
    {
      corridor: "US-2 via Sultan/Gold Bar/Index",
      last_gas: "Gold Bar (Sultan cheaper); Skykomish beyond",
      last_real_gear: "Monroe (Big 5) — nothing technical past Monroe",
      last_supplies: "Sultan Red Apple; Gold Bar mini-marts; Index General Store (limited)",
      last_food: "Sultan Bakery (institution), Zeke's Drive-In, Gold Bar",
      cell_coverage: "US-2 towns OK; Index-Galena Rd and FR 63 (Blanca) dead",
      road_notes:
        "Index-Galena Rd reopened after the long washout closure. Blanca Lake TH via FR 63 gravel, passenger-car OK; roads typically clear ~Jun.",
      drive_time_from_seattle_min: 75,
    },
  ],
  goat_rocks: [
    {
      corridor: "US-12 via Packwood",
      last_gas: "Packwood",
      last_real_gear: "Nothing real on US-12 — last serious gear is the Chehalis/Olympia I-5 corridor",
      last_supplies: "Blanton's Market, Packwood (solid full grocery)",
      last_food: "Packwood (Cruiser's Pizza, Blue Spruce)",
      cell_coverage: "Packwood OK; FR 21 and Snowgrass TH dead",
      road_notes:
        "FR 21 to Snowgrass/Berry Patch: washboard gravel, passenger-car OK when dry, typically open late Jun–Oct.",
      drive_time_from_seattle_min: 165,
    },
  ],
  mt_st_helens: [
    {
      corridor: "SR 503 via Woodland/Cougar (south side)",
      last_gas: "Cougar",
      last_real_gear: "Nothing past Woodland — Vancouver/Portland REI before leaving I-5",
      last_supplies: "Cougar Store / Lone Fir Resort basics",
      last_food: "Cougar",
      cell_coverage: "Cougar spotty; Climber's Bivouac and Marble Mountain sno-park dead",
      road_notes:
        "FR 83 to Climber's Bivouac paved, typically snow-free ~Jun. Windy Ridge (east side, FR 99) opens later and closes earlier.",
      drive_time_from_seattle_min: 180,
    },
  ],
  mt_adams: [
    {
      corridor: "SR 141 via Trout Lake",
      last_gas: "Trout Lake (limited hours — don't arrive on fumes)",
      last_real_gear: "Hood River, OR / White Salmon — nothing technical in Trout Lake",
      last_supplies: "Trout Lake Grocery",
      last_food: "Trout Lake Station Café (seasonal hours)",
      cell_coverage: "Trout Lake weak; FR 23/FR 80xx network dead",
      road_notes:
        "South Climb TH via FR 8040-500: rough gravel, high-clearance comfortable though careful passenger cars make it dry. FR 23 north to Randle is partly gravel and slow.",
      drive_time_from_seattle_min: 240,
    },
  ],
  mt_baker: [
    {
      corridor: "SR 542 via Glacier",
      last_gas: "Maple Falls (Glacier pumps unreliable)",
      last_real_gear: "Bellingham (Backcountry Essentials, REI) — nothing real past Bellingham",
      last_supplies: "Glacier convenience stores",
      last_food: "Glacier (Chair 9, Wake 'n Bakery)",
      cell_coverage: "Glacier spotty; dead past the DOT shed / Heather Meadows",
      road_notes:
        "SR 542's last ~3 miles to Artist Point typically open only mid-Jul/Aug–Oct. Glacier Creek and Skyline Divide FR roads are gravel with pothole minefields.",
      drive_time_from_seattle_min: 150,
    },
  ],
};
