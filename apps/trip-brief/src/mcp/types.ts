/**
 * Structural types for the trip-mcp tool payloads this generator consumes.
 *
 * These deliberately mirror rather than import `apps/trip-mcp/src/**` —
 * apps in this repo are independent (see CLAUDE.md), and the generator talks
 * to the *deployed* Worker over MCP, which may be a different revision than
 * the source tree it sits next to. Only the fields actually rendered are
 * declared, and everything is optional-tolerant: a field the deployed Worker
 * stops sending degrades to an omitted line, not a crash.
 */

export interface NwsForecastPeriod {
  number?: number;
  name?: string;
  startTime?: string;
  endTime?: string;
  isDaytime?: boolean;
  temperature?: number;
  temperatureUnit?: string;
  probabilityOfPrecipitation?: { value: number | null } | null;
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
  detailedForecast?: string;
}

export interface NwsAlert {
  id?: string;
  event?: string;
  severity?: string;
  headline?: string;
  description?: string;
  onset?: string;
  ends?: string;
}

export interface OpenMeteoDaily {
  date?: string;
  temp_max_f?: number | null;
  temp_min_f?: number | null;
  precip_probability_max_pct?: number | null;
  precip_sum_in?: number | null;
  wind_max_mph?: number | null;
  freezing_level_ft?: number | null;
}

export interface WeatherData {
  location: {
    lat: number;
    lon: number;
    area_id?: string;
    area_name?: string;
    grid: string;
    forecast_office: string;
  };
  daily: NwsForecastPeriod[];
  hourly?: NwsForecastPeriod[];
  alerts: NwsAlert[];
  afd_summary: string;
  elevation_adjusted?: {
    provider: "open-meteo";
    elevation_ft: number;
    model_elevation_ft: number;
    daily: OpenMeteoDaily[];
  };
}

export interface TrailWeatherPoint {
  mile: number;
  elevation_ft: number | null;
  temp_f: number | null;
  precip_pct: number | null;
  eta?: string;
}

export interface GearFlag {
  item: string;
  level: "consider" | "recommended" | "strongly_recommended";
  reason: string;
  affected_miles?: [number, number] | null;
}

export interface TrailWeatherData {
  resolved_from: string;
  matched_name?: string;
  date: string;
  window: { start_hour: number; end_hour: number };
  evaluation?: string;
  series: TrailWeatherPoint[];
  gear_flags?: { flags: GearFlag[]; disclaimer: string };
  summary?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export interface ElevationProfileEntry {
  mile: number;
  lat: number;
  lon: number;
  elevation_ft: number | null;
}

export interface ElevationProfileData {
  resolved_from: string;
  matched_name?: string;
  profile: ElevationProfileEntry[];
  total_distance_mi: number;
  total_gain_ft: number | null;
  total_loss_ft: number | null;
  min_elevation_ft: number | null;
  max_elevation_ft: number | null;
}

export interface GaugeReport {
  site_id: string;
  site_name: string;
  crossing?: string;
  crossing_note?: string;
  discharge_cfs: number | null;
  gage_height_ft: number | null;
  reading_time: string | null;
  flow_context: string;
  flow_context_detail: string | null;
}

export interface RangerStation {
  name?: string;
  phone?: string;
  hours?: string;
  url?: string;
}

export interface RiverConditionsData {
  area_id: string | null;
  gauges: GaugeReport[];
  gauge_relevance?: string;
  ranger_stations?: RangerStation[];
}

export interface ConditionsData {
  area_id: string | null;
  nps_alerts: Array<{ title?: string; description?: string; category?: string; url?: string }>;
  pass_conditions: Array<{
    name?: string;
    status?: string;
    restriction?: string;
    weather?: string;
  }>;
  fire_perimeters: unknown[];
  active_incidents: unknown[];
  summary: string;
}

export interface TripReportSummary {
  title?: string;
  url?: string;
  date?: string;
  trail?: string;
  author?: string;
  source?: string;
  blurb?: string;
  conditions?: Record<string, unknown>;
}

export interface TripReportsData {
  reports?: TripReportSummary[];
  count?: number;
}

export interface SafetyBriefData {
  area: { id: string; name: string };
  bear_canister_required: boolean;
  ranger_stations: RangerStation[];
  wildlife: string[];
  river_crossing_concerns: string[];
  exposure_notes: string[];
  ten_essentials_specific: string[];
  avalanche_terrain_likely: boolean;
  permit_system?: unknown;
}

export interface RoadReport {
  name: string;
  manager?: string;
  status: string;
  detail: string | null;
  source_url: string;
  as_of: string;
  note?: string;
}

export interface AccessStatusData {
  area_id: string;
  area_name: string;
  roads: RoadReport[];
  drive_time: {
    origin: string;
    mode: string;
    duration_min: number | null;
    distance_mi?: number;
    note: string;
  } | null;
  ranger_stations?: RangerStation[];
}

export interface PermitInfo {
  permit_id: string;
  name: string | null;
  description: string | null;
  rec_gov_url: string;
  ridb_url: string;
  application_window: string | null;
  fees_note: string | null;
}

export interface GetPermitsData {
  area_id: string;
  area_name: string;
  permit_system?: unknown;
  permits: PermitInfo[];
  ranger_stations?: RangerStation[];
  notes: string | null;
}

export interface CampWaterData {
  area_id: string;
  area_name: string;
  camping: {
    bear_canister_required?: boolean;
    established_sites_only?: boolean;
    notes?: string[];
    water_sources?: Array<{ name?: string; reliability?: string; note?: string }>;
  } | null;
  mapped_sites?: Array<{ name?: string; lat?: number; lon?: number }>;
}
