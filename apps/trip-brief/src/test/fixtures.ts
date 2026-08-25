/**
 * Fixtures modelled on the Aug 2026 Royal Basin pull, trimmed to the fields
 * the generator reads. Dates are fixed so every assertion is stable.
 */

import type { TripConfig } from "../config/schema.ts";
import { TripConfigSchema, OptionsConfigSchema, type OptionsConfig } from "../config/schema.ts";
import type { PullResult, TripPull } from "../mcp/pull.ts";
import type { ToolPayload } from "../mcp/client.ts";
import type {
  AccessStatusData,
  ConditionsData,
  ElevationProfileData,
  GetPermitsData,
  RiverConditionsData,
  SafetyBriefData,
  TrailWeatherData,
  TripReportsData,
  WeatherData,
} from "../mcp/types.ts";

export const FIXED_NOW = new Date("2026-08-19T22:05:00Z");

export function payload<T>(data: T | null, overrides: Partial<ToolPayload<T>> = {}): ToolPayload<T> {
  return {
    data,
    sources: [
      {
        url: "https://api.weather.gov/gridpoints/SEW/120,80/forecast",
        name: "NWS point forecast",
        fetched_at: FIXED_NOW.toISOString(),
      },
    ],
    confidence: "high",
    caveats: [],
    ...overrides,
  };
}

export function result<T>(
  tool: string,
  tier: PullResult<T>["tier"],
  data: T | null,
  overrides: Partial<ToolPayload<T>> = {},
): PullResult<T> {
  return { tool, tier, payload: payload(data, overrides) };
}

export const WEATHER: WeatherData = {
  location: {
    lat: 47.8235,
    lon: -123.1085,
    grid: "SEW 120,80",
    forecast_office: "SEW",
    area_name: "Olympic National Park",
  },
  daily: [
    {
      name: "Friday",
      startTime: "2026-08-21T06:00:00-07:00",
      isDaytime: true,
      temperature: 68,
      probabilityOfPrecipitation: { value: 12 },
      windSpeed: "5 to 10 mph",
      windDirection: "SW",
      shortForecast: "Sunny",
    },
    {
      name: "Friday Night",
      startTime: "2026-08-21T18:00:00-07:00",
      isDaytime: false,
      temperature: 44,
      probabilityOfPrecipitation: { value: 20 },
      shortForecast: "Partly Cloudy",
    },
    {
      name: "Saturday",
      startTime: "2026-08-22T06:00:00-07:00",
      isDaytime: true,
      temperature: 71,
      probabilityOfPrecipitation: { value: 28 },
      windSpeed: "10 mph",
      windDirection: "W",
      shortForecast: "Chance Showers And Thunderstorms",
    },
    {
      name: "Saturday Night",
      startTime: "2026-08-22T18:00:00-07:00",
      isDaytime: false,
      temperature: 46,
      probabilityOfPrecipitation: { value: 15 },
      shortForecast: "Mostly Cloudy",
    },
    {
      name: "Sunday",
      startTime: "2026-08-23T06:00:00-07:00",
      isDaytime: true,
      temperature: 66,
      probabilityOfPrecipitation: { value: 8 },
      windSpeed: "5 mph",
      windDirection: "NW",
      shortForecast: "Sunny",
    },
  ],
  alerts: [],
  afd_summary: "Upper ridge builds over the region through the weekend.",
  elevation_adjusted: {
    provider: "open-meteo",
    elevation_ft: 5300,
    model_elevation_ft: 5240,
    daily: [
      { date: "2026-08-21", precip_probability_max_pct: 18, temp_max_f: 58, temp_min_f: 38 },
      { date: "2026-08-22", precip_probability_max_pct: 34, temp_max_f: 60, temp_min_f: 40 },
      { date: "2026-08-23", precip_probability_max_pct: 10, temp_max_f: 56, temp_min_f: 37 },
    ],
  },
};

export const TRAIL_WEATHER: TrailWeatherData = {
  resolved_from: "points",
  matched_name: "Upper Dungeness Trail",
  date: "2026-08-21",
  window: { start_hour: 10, end_hour: 18 },
  series: [
    { mile: 0, elevation_ft: 2500, temp_f: 66, precip_pct: 10 },
    { mile: 1.5, elevation_ft: 3100, temp_f: 63, precip_pct: 12 },
    { mile: 3, elevation_ft: 3900, temp_f: 60, precip_pct: 16 },
    { mile: 4.5, elevation_ft: 4700, temp_f: 56, precip_pct: 19 },
    { mile: 6.2, elevation_ft: 5300, temp_f: 53, precip_pct: 22 },
  ],
  gear_flags: {
    flags: [
      {
        item: "Rain shell",
        level: "recommended",
        reason: "Precipitation probability exceeds 20% above 4,500 ft.",
      },
      { item: "Sun hat", level: "consider", reason: "Exposed meadow sections." },
    ],
    disclaimer: "Gear flags are heuristics, not a packing list.",
  },
};

export const ELEVATION: ElevationProfileData = {
  resolved_from: "points",
  matched_name: "Upper Dungeness Trail",
  profile: [],
  total_distance_mi: 6.2,
  total_gain_ft: 2800,
  total_loss_ft: 120,
  min_elevation_ft: 2500,
  max_elevation_ft: 5300,
};

export const RIVERS: RiverConditionsData = {
  area_id: "olympic",
  gauges: [
    {
      site_id: "12048000",
      site_name: "Dungeness River near Sequim",
      crossing: "Royal Creek ford",
      discharge_cfs: 128,
      gage_height_ft: 2.1,
      reading_time: "2026-08-19 14:00 PDT",
      flow_context: "low",
      flow_context_detail: "well below the 30-year median for the date",
    },
  ],
  ranger_stations: [],
};

export const CONDITIONS: ConditionsData = {
  area_id: "olympic",
  nps_alerts: [],
  pass_conditions: [],
  fire_perimeters: [],
  active_incidents: [],
  summary: "No park-wide closures affecting the Dungeness drainage.",
};

export const TRIP_REPORTS: TripReportsData = {
  count: 2,
  reports: [
    {
      title: "Royal Basin overnight",
      url: "https://www.wta.org/go-hiking/trip-reports/trip_report.2026-08-16",
      date: "2026-08-16",
      source: "WTA",
      trail: "Royal Basin",
    },
  ],
};

export const SAFETY: SafetyBriefData = {
  area: { id: "olympic", name: "Olympic National Park" },
  bear_canister_required: true,
  ranger_stations: [
    { name: "Wilderness Information Center", phone: "360-565-3100", hours: "8am–4:30pm" },
  ],
  wildlife: ["Black bears frequent the basin; hang or can all scented items."],
  river_crossing_concerns: ["Royal Creek runs low in August but the log crossing is slick."],
  exposure_notes: ["The upper basin is above treeline with no wind shelter."],
  ten_essentials_specific: [],
  avalanche_terrain_likely: false,
};

export const ACCESS: AccessStatusData = {
  area_id: "olympic",
  area_name: "Olympic National Park",
  roads: [
    {
      name: "FS 2860 (Dungeness Forks Road)",
      status: "Open",
      detail: "gravel, passable to passenger cars",
      source_url: "https://www.fs.usda.gov/olympic/alerts",
      as_of: "2026-08-18",
    },
  ],
  drive_time: {
    origin: "Seattle, WA",
    mode: "live_osrm",
    duration_min: 195,
    distance_mi: 96,
    note: "Includes the Edmonds–Kingston ferry crossing.",
  },
};

/**
 * The catalog record that caused the original failure: a park-wide permit
 * system ID with null name and null description.
 */
export const PERMITS_NULL_NAME: GetPermitsData = {
  area_id: "olympic",
  area_name: "Olympic National Park",
  permits: [
    {
      permit_id: "4098362",
      name: null,
      description: null,
      rec_gov_url: "https://www.recreation.gov/permits/4098362",
      ridb_url: "https://ridb.recreation.gov/api/v1/permits/4098362",
      application_window: null,
      fees_note: null,
    },
  ],
  notes: null,
};

export const PERMITS_NAMED: GetPermitsData = {
  area_id: "olympic",
  area_name: "Olympic National Park",
  permits: [
    {
      permit_id: "4098362",
      name: "Olympic National Park Wilderness Permits",
      description: "Overnight wilderness camping permits.",
      rec_gov_url: "https://www.recreation.gov/permits/4098362",
      ridb_url: "https://ridb.recreation.gov/api/v1/permits/4098362",
      application_window: "Reservable six months ahead",
      fees_note: "$8 per person per night",
    },
  ],
  notes: "Quota areas fill within minutes of release.",
};

export const TRIP_CONFIG_RAW = {
  kind: "trip",
  slug: "royal-basin-2026-08",
  title: "Royal Basin",
  subtitle: "Two nights in the upper basin",
  area_id: "olympic",
  destination: {
    lat: 47.8235,
    lon: -123.1085,
    label: "Upper Royal Basin",
    elevation_ft: 5300,
  },
  trailhead: { lat: 47.8938, lon: -123.1372, label: "Upper Dungeness Trailhead", elevation_ft: 2500 },
  dates: { start: "2026-08-21", end: "2026-08-23" },
  timezone: "America/Los_Angeles",
  terrain_shade_minutes: 60,
  route: {
    trail_name: "Upper Dungeness Trail",
    points: [
      [47.8938, -123.1372],
      [47.8235, -123.1085],
    ],
    climb_window: { date: "2026-08-21", start_hour: 10, end_hour: 18, pace_mph: 1.4 },
  },
  campground: { name: "Dungeness Forks Campground", first_come: true, sites: 9 },
  permit: { required: true, system: "Olympic wilderness quota", mechanism: "reservation" },
  reservation: {
    confirmation_reference: "OLYM-2026-884213",
    assigned_camp_area: "Upper Royal Basin camp area",
    camp_elevation_ft: 5300,
    above_treeline: true,
    toilet_available: false,
    nights: ["2026-08-21", "2026-08-22"],
    party_size: 4,
    permit_holder: "C. Petrie",
    intake: "screenshot",
  },
  ranger_call: {
    station: "Quilcene Ranger District / Wilderness Information Center",
    phone: "360-565-3100",
    called_at: "2026-08-19",
    notes: [
      "FS 2860 is open and gravel-graded to the trailhead.",
      "Dispersed camping is legal on Forest Service land below the park boundary.",
    ],
    campground_fallback: "Dispersed pullouts on FS 2860 below the park boundary.",
  },
  group_roles: [
    { role: "Driver", who: "C. Petrie" },
    { role: "Permit holder", who: "C. Petrie" },
    { role: "Bear can", who: "J. Alvarez", note: "BV500, holds three days for two" },
  ],
  drive: {
    origin: "Seattle, WA",
    hours: 3.25,
    outbound: [
      "Edmonds–Kingston ferry.",
      "WA-104 west to US-101 south.",
      "Palo Alto Road to FS 2860, 11 miles gravel to the trailhead.",
    ],
  },
  phones: [{ label: "Olympic WIC", number: "360-565-3100", hours: "8am–4:30pm" }],
  links: [
    { label: "Olympic wilderness permits", url: "https://www.recreation.gov/permits/4098362" },
  ],
  provenance: { allow_lookup_facts: false, link_check: "skip" },
  outputs: { jsx: true, pdf: true, offline: true },
} as const;

export function tripConfig(overrides: Record<string, unknown> = {}): TripConfig {
  return TripConfigSchema.parse({ ...TRIP_CONFIG_RAW, ...overrides });
}

export function tripPull(overrides: Partial<TripPull> = {}): TripPull {
  return {
    weather: result("get_weather", "live-instrument", WEATHER),
    trailWeather: result("get_trail_weather_profile", "live-instrument", TRAIL_WEATHER),
    elevation: result("get_elevation_profile", "official-static", ELEVATION),
    rivers: result("get_river_conditions", "live-instrument", RIVERS),
    conditions: result("get_conditions", "official-static", CONDITIONS),
    tripReports: result("get_trip_reports", "community", TRIP_REPORTS),
    safety: result("get_safety_brief", "official-static", SAFETY),
    access: result("get_access_status", "official-static", ACCESS),
    permits: result("get_permits", "lookup-inference", PERMITS_NAMED),
    campWater: null,
    pulled_at: FIXED_NOW,
    ...overrides,
  };
}

export const OPTIONS_CONFIG_RAW = {
  kind: "options",
  slug: "labor-day-options",
  title: "Weekend options",
  dates: { start: "2026-08-21", end: "2026-08-23" },
  timezone: "America/Los_Angeles",
  criteria: {
    max_precip_pct: 20,
    thunder: "none",
    permit_mechanisms: ["none", "self-issue"],
    max_drive_hours: 4,
    styles: ["backpack"],
  },
  candidates: [
    {
      id: "royal-basin",
      name: "Royal Basin",
      region: "Olympics",
      point: { lat: 47.8235, lon: -123.1085, label: "Upper Royal Basin" },
      style: "backpack",
      permit_mechanism: "reservation",
      drive_hours: 3.25,
      links: [{ label: "WTA", url: "https://www.wta.org/go-hiking/hikes/royal-basin" }],
    },
    {
      id: "tuck-robin",
      name: "Tuck and Robin Lakes",
      region: "Alpine Lakes",
      point: { lat: 47.5677, lon: -121.1043, label: "Robin Lakes" },
      style: "backpack",
      permit_mechanism: "self-issue",
      drive_hours: 2.5,
      links: [],
    },
    {
      id: "far-away",
      name: "Wallowas",
      region: "Eastern Oregon",
      point: { lat: 45.2, lon: -117.2, label: "Lakes Basin" },
      style: "backpack",
      permit_mechanism: "self-issue",
      drive_hours: 7,
      proposed_by: "M. Chen",
      links: [],
    },
  ],
  excluded_regions: [{ name: "North Cascades", reason: "Highway 20 closed for slide repair." }],
  provenance: { link_check: "skip" },
} as const;

export function optionsConfig(): OptionsConfig {
  return OptionsConfigSchema.parse(OPTIONS_CONFIG_RAW);
}
