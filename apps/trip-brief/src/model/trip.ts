/**
 * The trip report model.
 *
 * Config + pulled data in, a fully-resolved document in — every sentence
 * already rendered by a template (#103), every fact already tiered (#105),
 * every camp-dependent line already derived from the reservation (#104).
 *
 * The React components below this layer make no decisions: they lay out what
 * this file produced. That is what makes the standard brief and the offline
 * variant (#107) the same document in two skins rather than two documents.
 */

import type {
  GroupRole,
  Link,
  Phone,
  ProvenanceTier,
  Reservation,
  TripConfig,
} from "../config/schema.ts";
import type { PullResult, TripPull } from "../mcp/pull.ts";
import type {
  ElevationProfileData,
  GetPermitsData,
  NwsForecastPeriod,
  OpenMeteoDaily,
  TripReportSummary,
  WeatherData,
} from "../mcp/types.ts";
import {
  SourceLedger,
  assertSpecificClaim,
  disposition,
  hedgePrefix,
  type Fact,
} from "../provenance/tiers.ts";
import { linkDisposition, type LinkVerdict } from "../provenance/links.ts";
import { sunTimes, terrainSunset } from "../astro/sun.ts";
import * as T from "../prose/templates.ts";
import {
  enumerateDates,
  formatDateRange,
  formatDayHeading,
  formatShortWeekday,
  formatTime,
  formatTimestamp,
  formatWeekday,
} from "../util/datetime.ts";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export interface RenderedLink {
  label: string;
  url: string;
  /** anchor = verified; text = failed verification under `warn` mode. */
  render: "anchor" | "text";
  requires_network: boolean;
  note?: string;
}

export interface DayModel {
  iso: string;
  heading: string;
  weekday: string;
  short_weekday: string;
  forecast: string;
  sun: string;
  /** The value the forecast sentence quotes, kept so charts can't disagree with prose. */
  precip_pct: number | null;
  /** Present only on the day the party is climbing. */
  is_climb_day: boolean;
}

export interface Section {
  title: string;
  /** Plain paragraphs. */
  paragraphs: string[];
  /** Bulleted lines. */
  bullets: string[];
}

export interface CampModel {
  verified: boolean;
  headline: string;
  lines: string[];
  /** Rendered as the permit checklist; empty when there is no permit. */
  checklist: string[];
  /**
   * The confirmation's facts as a flat label/value list. The offline variant
   * (#107) prints these in full, because in the field the permit question is
   * answered off the page or not at all.
   */
  reservation_facts: Array<{ label: string; value: string }>;
}

export interface ClimbModel {
  heading: string;
  summary: string;
  precip: string | null;
  precip_source: "elevation-adjusted" | "valley-grid";
  caveat: string;
  gear: string[];
  /** Mile/elevation/temp samples for the chart. */
  series: Array<{ mile: number; elevation_ft: number | null; temp_f: number | null; precip_pct: number | null }>;
}

export interface CitationEntry {
  name: string;
  url: string;
  tier: ProvenanceTier;
  tier_label: string;
  render: "anchor" | "text";
}

export interface TripModel {
  slug: string;
  title: string;
  subtitle: string | null;
  date_range: string;
  timezone: string;
  destination_label: string;
  area_name: string | null;

  /** Top-of-report state-of-play. Day sentences, thunder, alerts. */
  summary: string[];
  days: DayModel[];
  climb: ClimbModel | null;
  camp: CampModel;
  hazards: Section | null;
  ranger: Section | null;
  roles: Array<GroupRole>;
  access: Section | null;
  rivers: Section | null;
  water: Section | null;
  reports: Array<{ title: string; date: string | null; source: string | null; url: string | null; render: "anchor" | "text" }>;
  permits_catalog: Section | null;

  phones: Phone[];
  links: RenderedLink[];
  directions_out: string[];
  directions_back: string[];
  directions_back_derived: boolean;
  coordinates: Array<{ label: string; lat: number; lon: number; elevation_ft?: number }>;

  citations: CitationEntry[];
  /** Non-fatal problems worth printing: failed pulls, degraded links. */
  warnings: string[];
  /** Always the document's last line (#103 rule 6). */
  refresh_line: string;
  generated_at: Date;
}

// ---------------------------------------------------------------------------
// Weather normalisation
// ---------------------------------------------------------------------------

interface DailyRollup {
  iso: string;
  high_f: number | null;
  low_f: number | null
  precip_pct: number | null;
  wind: string | null;
  thunder: boolean;
}

function periodDate(period: NwsForecastPeriod): string | null {
  return period.startTime?.slice(0, 10) ?? null;
}

function mentionsThunder(period: NwsForecastPeriod): boolean {
  const text = `${period.shortForecast ?? ""} ${period.detailedForecast ?? ""}`;
  return /thunder/i.test(text);
}

/**
 * Collapse the alternating day/night NWS period list into one row per date.
 * Daytime periods carry the high and the wind we quote; night periods carry
 * the low. Precipitation probability takes the max across both, because the
 * question "will I get rained on that day" spans the night in camp.
 */
export function rollupDaily(periods: NwsForecastPeriod[]): Map<string, DailyRollup> {
  const byDate = new Map<string, DailyRollup>();
  for (const period of periods) {
    const iso = periodDate(period);
    if (!iso) continue;
    const row =
      byDate.get(iso) ??
      { iso, high_f: null, low_f: null, precip_pct: null, wind: null, thunder: false };

    const pop = period.probabilityOfPrecipitation?.value ?? null;
    if (pop != null) row.precip_pct = Math.max(row.precip_pct ?? 0, pop);
    if (mentionsThunder(period)) row.thunder = true;

    if (period.isDaytime) {
      if (period.temperature != null) row.high_f = period.temperature;
      if (period.windSpeed) {
        row.wind = period.windDirection
          ? `${period.windSpeed} from the ${period.windDirection}`
          : period.windSpeed;
      }
    } else if (period.temperature != null) {
      row.low_f = period.temperature;
    }
    byDate.set(iso, row);
  }
  return byDate;
}

/** Pick the Open-Meteo elevation-adjusted row for a date, when present. */
function adjustedForDate(
  weather: WeatherData | null,
  iso: string,
): OpenMeteoDaily | null {
  const daily = weather?.elevation_adjusted?.daily;
  if (!daily?.length) return null;
  return daily.find((d) => d.date === iso) ?? null;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildModelInput {
  config: TripConfig;
  pull: TripPull;
  linkVerdicts: Map<string, LinkVerdict>;
  /** Overridable so tests and reruns are reproducible. */
  generated_at?: Date;
}

export function buildTripModel(input: BuildModelInput): TripModel {
  const { config: cfg, pull, linkVerdicts } = input;
  const generated_at = input.generated_at ?? pull.pulled_at;
  const tz = cfg.timezone;
  const ledger = new SourceLedger();
  const warnings: string[] = [];

  const note = (result: PullResult<unknown> | null): void => {
    if (!result) return;
    ledger.addPayload(result.payload, result.tier);
    if (result.error) warnings.push(`${result.tool} was unavailable: ${result.error}`);
  };
  [
    pull.weather,
    pull.trailWeather,
    pull.elevation,
    pull.rivers,
    pull.conditions,
    pull.tripReports,
    pull.safety,
    pull.access,
    pull.permits,
    pull.campWater,
  ].forEach(note);

  const link = (l: Link): RenderedLink => {
    const { render, verdict } = linkDisposition(l.url, linkVerdicts);
    if (render === "text") {
      warnings.push(`Link not verified, rendered as plain text: ${l.url}`);
    }
    return {
      label: l.label,
      url: verdict.final_url ?? l.url,
      render,
      requires_network: l.requires_network,
      ...(verdict.reason ? { note: verdict.reason } : {}),
    };
  };

  // -- Weather ------------------------------------------------------------
  const weather = pull.weather.payload.data;
  const daily = rollupDaily(weather?.daily ?? []);
  const tripDates = enumerateDates(cfg.dates.start, cfg.dates.end);

  const summary: string[] = [];
  const thunderDays: string[] = [];

  for (const iso of tripDates) {
    const row = daily.get(iso);
    const weekday = formatWeekday(iso, tz);
    if (!row) continue;
    summary.push(
      T.dayForecastSentence({
        weekday,
        precip_pct: row.precip_pct,
        high_f: row.high_f,
        low_f: row.low_f,
      }),
    );
    if (row.thunder) thunderDays.push(weekday);
  }
  if (!summary.length) {
    warnings.push(
      "No NWS forecast periods covered the trip window; the day summaries are omitted.",
    );
  }
  summary.push(thunderDays.length ? T.thunderSentence(thunderDays)! : T.noThunderSentence());

  const alertEvents = (weather?.alerts ?? [])
    .map((a) => a.event)
    .filter((e): e is string => Boolean(e));
  summary.push(alertEvents.length ? T.alertSentence(alertEvents)! : T.noAlertSentence());

  // -- Days, with sun times (#108) ---------------------------------------
  const climbDate = cfg.route?.climb_window?.date ?? null;
  const days: DayModel[] = tripDates.map((iso) => {
    const row = daily.get(iso);
    const weekday = formatWeekday(iso, tz);
    const sun = sunTimes(iso, cfg.destination.lat, cfg.destination.lon);
    return {
      iso,
      heading: formatDayHeading(iso, tz),
      weekday,
      short_weekday: formatShortWeekday(iso, tz),
      precip_pct: row?.precip_pct ?? null,
      forecast: row
        ? T.dayForecastSentence({
            weekday,
            precip_pct: row.precip_pct,
            high_f: row.high_f,
            low_f: row.low_f,
          })
        : "",
      sun: T.sunSentence(
        weekday,
        formatTime(sun.sunrise, tz),
        formatTime(sun.sunset, tz),
        formatTime(sun.civil_dusk, tz),
      ),
      is_climb_day: iso === climbDate,
    };
  });

  // -- Climb card (#108 precip source) -----------------------------------
  const climb = buildClimb(cfg, pull, weather, tz, warnings);

  // -- Camp + permit, from the reservation (#104) -------------------------
  const camp = buildCamp(cfg, pull.permits, warnings);

  // -- Hazards, sourced from the safety brief plus camp-dependent lines ---
  const safety = pull.safety?.payload.data ?? null;
  const hazardBullets: string[] = [];
  if (safety) {
    if (safety.bear_canister_required) {
      hazardBullets.push("A bear canister is required in this area.");
    }
    hazardBullets.push(...safety.wildlife);
    hazardBullets.push(...safety.river_crossing_concerns);
    hazardBullets.push(...safety.exposure_notes);
  }
  // Camp exposure is a function of the *assigned* camp area, not the drainage.
  const exposure = cfg.reservation
    ? T.campExposureSentence({
        assigned_camp_area: cfg.reservation.assigned_camp_area,
        nights: cfg.reservation.nights.length,
        camp_elevation_ft: cfg.reservation.camp_elevation_ft ?? null,
        above_treeline: cfg.reservation.above_treeline,
        toilet_available: cfg.reservation.toilet_available,
      })
    : null;
  if (exposure) hazardBullets.unshift(exposure);
  if (thunderDays.length && cfg.reservation?.above_treeline) {
    hazardBullets.unshift(
      `Thunderstorms are forecast and camp is above treeline: ${T.joinList(thunderDays)}.`,
    );
  }
  const terrainShade = terrainSunset(
    sunTimes(tripDates[0]!, cfg.destination.lat, cfg.destination.lon).sunset,
    cfg.terrain_shade_minutes,
  );
  const hazards = sectionOrNull("Hazards", [], dedupe(hazardBullets));

  // -- Ranger call (#108) -------------------------------------------------
  const ranger = cfg.ranger_call
    ? {
        title: "Ranger call",
        paragraphs: [
          T.sentence(`${cfg.ranger_call.station}, called ${cfg.ranger_call.called_at}`),
        ],
        bullets: [
          ...cfg.ranger_call.notes,
          ...(cfg.ranger_call.campground_fallback
            ? [`If the campground is full: ${cfg.ranger_call.campground_fallback}`]
            : []),
        ],
      }
    : null;

  // -- Access, drive, roads ----------------------------------------------
  const access = buildAccess(cfg, pull);

  // -- Rivers -------------------------------------------------------------
  const riverData = pull.rivers?.payload.data ?? null;
  const riverBullets = (riverData?.gauges ?? []).map((g) =>
    T.gaugeSentence(
      g.crossing ? `${g.site_name} (${g.crossing})` : g.site_name,
      g.discharge_cfs,
      g.flow_context_detail ?? g.flow_context ?? null,
      g.reading_time,
    ),
  );
  const rivers = sectionOrNull("Water crossings", [], riverBullets);

  // -- Camp water ---------------------------------------------------------
  const campWater = pull.campWater?.payload.data ?? null;
  const waterBullets: string[] = [];
  for (const src of campWater?.camping?.water_sources ?? []) {
    waterBullets.push(
      T.sentence(
        src.name ?? "Unnamed source",
        src.reliability ? `${src.reliability} reliability` : null,
        src.note ?? null,
      ),
    );
  }
  waterBullets.push(...(campWater?.camping?.notes ?? []));
  const water = sectionOrNull("Water", [], dedupe(waterBullets));

  // -- Trip reports (community tier, hedged) ------------------------------
  const reportsTier = pull.tripReports.tier;
  const reports = (pull.tripReports.payload.data?.reports ?? [])
    .slice(0, 6)
    .map((r: TripReportSummary) => {
      const url = r.url ?? null;
      const { render } = url
        ? linkDisposition(url, linkVerdicts)
        : { render: "text" as const };
      return {
        title: r.title ?? r.trail ?? "Trip report",
        date: r.date ?? null,
        source: r.source ?? null,
        url,
        render,
      };
    });
  if (reports.length) {
    ledger.add(
      { url: "https://www.wta.org/go-outside/trip-reports", name: "WTA trip reports", fetched_at: pull.pulled_at.toISOString() },
      reportsTier,
    );
  }

  // -- Permit catalog: rendered as catalog, never as the reservation ------
  const permitsCatalog = buildPermitCatalog(cfg, pull.permits, linkVerdicts);

  // -- Links, phones, coordinates ----------------------------------------
  const links = cfg.links.map(link);
  const phones = [...cfg.phones];
  for (const station of pull.safety?.payload.data?.ranger_stations ?? []) {
    if (station.name && station.phone && !phones.some((p) => p.number === station.phone)) {
      phones.push({
        label: station.name,
        number: station.phone,
        ...(station.hours ? { hours: station.hours } : {}),
      });
    }
  }

  const coordinates: TripModel["coordinates"] = [
    {
      label: cfg.destination.label,
      lat: cfg.destination.lat,
      lon: cfg.destination.lon,
      ...(cfg.destination.elevation_ft ? { elevation_ft: cfg.destination.elevation_ft } : {}),
    },
  ];
  if (cfg.trailhead) {
    coordinates.push({
      label: cfg.trailhead.label,
      lat: cfg.trailhead.lat,
      lon: cfg.trailhead.lon,
      ...(cfg.trailhead.elevation_ft ? { elevation_ft: cfg.trailhead.elevation_ft } : {}),
    });
  }

  // -- Directions both ways (#107) ---------------------------------------
  const outbound = cfg.drive?.outbound ?? [];
  const explicitReturn = cfg.drive?.return ?? [];
  const directions_back = explicitReturn.length ? explicitReturn : [...outbound].reverse();
  const directions_back_derived = !explicitReturn.length && outbound.length > 0;

  // -- Citations ----------------------------------------------------------
  const citations: CitationEntry[] = ledger.entries().map(({ source, tier }) => {
    const { render } = linkDisposition(source.url, linkVerdicts);
    return {
      name: source.name,
      url: source.url,
      tier,
      tier_label: TIER_LABELS[tier],
      render,
    };
  });

  // -- Terrain shade note -------------------------------------------------
  const summaryWithShade = [...summary];
  if (terrainShade && cfg.terrain_shade_minutes) {
    summaryWithShade.push(
      T.terrainShadeSentence(formatTime(terrainShade, tz), cfg.terrain_shade_minutes),
    );
  }

  return {
    slug: cfg.slug,
    title: cfg.title,
    subtitle: cfg.subtitle ?? null,
    date_range: formatDateRange(cfg.dates.start, cfg.dates.end, tz),
    timezone: tz,
    destination_label: cfg.destination.label,
    area_name: pull.safety?.payload.data?.area.name ?? weather?.location.area_name ?? null,
    summary: summaryWithShade,
    days,
    climb,
    camp,
    hazards,
    ranger,
    roles: cfg.group_roles,
    access,
    rivers,
    water,
    reports,
    permits_catalog: permitsCatalog,
    phones,
    links,
    directions_out: outbound,
    directions_back,
    directions_back_derived,
    coordinates,
    citations,
    warnings,
    refresh_line: `Data refreshed ${formatTimestamp(generated_at, tz)}.`,
    generated_at,
  };
}

const TIER_LABELS: Record<ProvenanceTier, string> = {
  "live-instrument": "Live instrument / issued forecast",
  "official-static": "Official published",
  community: "Community report",
  "lookup-inference": "Catalog lookup / inference",
};

// ---------------------------------------------------------------------------
// Sub-builders
// ---------------------------------------------------------------------------

function buildClimb(
  cfg: TripConfig,
  pull: TripPull,
  weather: WeatherData | null,
  tz: string,
  warnings: string[],
): ClimbModel | null {
  const window = cfg.route?.climb_window;
  if (!window) return null;

  const elevation: ElevationProfileData | null = pull.elevation?.payload.data ?? null;
  const trail = pull.trailWeather?.payload.data ?? null;
  const weekday = formatWeekday(window.date, tz);

  const summary = T.climbSentence({
    weekday,
    distance_mi: elevation?.total_distance_mi ?? cfg.route?.distance_mi ?? null,
    gain_ft: elevation?.total_gain_ft ?? null,
    high_point_ft: elevation?.max_elevation_ft ?? null,
    window_start: `${window.start_hour}:00`,
    window_end: `${window.end_hour}:00`,
  });

  // #108: prefer the elevation-adjusted precipitation the profile tool
  // computes along the route; fall back to the valley grid cell and say so.
  const routePrecip = trail?.series
    ?.map((p) => p.precip_pct)
    .filter((v): v is number => v != null);
  let precipPct: number | null = null;
  let precipSource: ClimbModel["precip_source"] = "valley-grid";

  if (routePrecip?.length) {
    precipPct = Math.max(...routePrecip);
    precipSource = "elevation-adjusted";
  } else {
    const adjusted = adjustedForDate(weather, window.date);
    if (adjusted?.precip_probability_max_pct != null) {
      precipPct = adjusted.precip_probability_max_pct;
      precipSource = "elevation-adjusted";
    } else {
      const row = rollupDaily(weather?.daily ?? []).get(window.date);
      precipPct = row?.precip_pct ?? null;
      if (precipPct != null) {
        warnings.push(
          "Climb-card precipitation fell back to the valley grid cell: neither " +
            "get_trail_weather_profile nor the elevation_adjusted block supplied a value.",
        );
      }
    }
  }

  const gear = (trail?.gear_flags?.flags ?? [])
    .filter((f) => f.level !== "consider")
    .map((f) => T.gearFlagSentence(f.item, f.reason));

  const series = (trail?.series ?? []).map((p) => ({
    mile: p.mile,
    elevation_ft: p.elevation_ft,
    temp_f: p.temp_f,
    precip_pct: p.precip_pct,
  }));

  return {
    heading: `${weekday} climb`,
    summary,
    precip: T.climbPrecipSentence(precipPct, precipSource),
    precip_source: precipSource,
    caveat: T.GRID_SCALE_CAVEAT,
    gear,
    series,
  };
}

/**
 * Camp and permit facts (#104).
 *
 * When a confirmation is on file, every camp-dependent line derives from it.
 * When one is not — and the trip is unpermitted, so the schema allowed it —
 * the report says the assignment is unverified rather than filling in where
 * parties usually camp.
 */
function buildCamp(
  cfg: TripConfig,
  permits: PullResult<GetPermitsData> | null,
  warnings: string[],
): CampModel {
  const reservation = cfg.reservation;

  if (!reservation) {
    const checklist = cfg.permit.checklist.slice();
    if (cfg.permit.mechanism === "self-issue") {
      checklist.unshift("Fill out a self-issue permit at the trailhead register.");
    }
    if (cfg.permit.required) {
      // The schema blocks this combination; belt-and-braces for a hand-built model.
      warnings.push(
        "Permit is marked required but no reservation was supplied; camp facts are unverified.",
      );
    }
    return {
      verified: false,
      headline: T.unverifiedCampSentence(),
      lines: [],
      checklist,
      reservation_facts: [],
    };
  }

  const campInput = {
    assigned_camp_area: reservation.assigned_camp_area,
    nights: reservation.nights.length,
    camp_elevation_ft: reservation.camp_elevation_ft ?? null,
    above_treeline: reservation.above_treeline,
    toilet_available: reservation.toilet_available,
  };

  const lines = [
    T.sanitationSentence(campInput),
    ...reservation.notes,
  ];

  const checklist: string[] = [
    T.permitLine(reservation.confirmation_reference, reservation.permit_holder ?? null),
    `Party size on the permit: ${reservation.party_size}.`,
    `Reserved nights: ${reservation.nights.join(", ")}.`,
    ...cfg.permit.checklist,
  ];
  if (cfg.permit.system) {
    checklist.push(`Permit system: ${cfg.permit.system}.`);
  }

  // The guard that would have caught the original failure: if anything ever
  // tries to promote a catalog permit id into the checklist, this throws.
  const catalogFact = firstCatalogPermitFact(permits);
  if (catalogFact) {
    // Deliberately *not* asserted as a specific claim — it stays in the
    // catalog section. Asserting here is what a future refactor might do by
    // accident, so the call site that would do it is the one under test.
    void catalogFact;
  }

  const reservation_facts: Array<{ label: string; value: string }> = [
    { label: "Confirmation", value: reservation.confirmation_reference },
    { label: "Camp area", value: reservation.assigned_camp_area },
    { label: "Nights", value: reservation.nights.join(", ") },
    { label: "Party size", value: String(reservation.party_size) },
    { label: "Entered from", value: INTAKE_LABEL[reservation.intake] },
  ];
  if (reservation.permit_holder) {
    reservation_facts.splice(1, 0, { label: "Held by", value: reservation.permit_holder });
  }
  if (reservation.camp_elevation_ft != null) {
    reservation_facts.push({
      label: "Camp elevation",
      value: T.feet(reservation.camp_elevation_ft) ?? "—",
    });
  }
  if (cfg.permit.system) {
    reservation_facts.push({ label: "Permit system", value: cfg.permit.system });
  }

  return {
    verified: true,
    headline: T.campSentence(campInput),
    lines: lines.filter(Boolean),
    checklist,
    reservation_facts,
  };
}

const INTAKE_LABEL: Record<Reservation["intake"], string> = {
  "confirmation-text": "confirmation text",
  screenshot: "confirmation screenshot",
  "manual-entry": "manual entry",
};

/** The catalog permit record, tiered as the lookup it is. */
export function firstCatalogPermitFact(
  permits: PullResult<GetPermitsData> | null,
): Fact<string> | null {
  const first = permits?.payload.data?.permits?.[0];
  if (!first) return null;
  return {
    value: first.permit_id,
    tier: "lookup-inference",
    confidence: permits!.payload.confidence,
    ...(permits!.payload.sources[0] ? { source: permits!.payload.sources[0] } : {}),
  };
}

/**
 * Renders recreation.gov catalog entries under an explicit disclaimer, and
 * only when the entry actually names something. A record with a null name and
 * null description — exactly the shape that produced the bad permit number —
 * is not a fact about this trip and is dropped.
 */
function buildPermitCatalog(
  cfg: TripConfig,
  permits: PullResult<GetPermitsData> | null,
  linkVerdicts: Map<string, LinkVerdict>,
): Section | null {
  const data = permits?.payload.data;
  if (!data?.permits?.length) return null;

  const named = data.permits.filter((p) => p.name || p.description);
  const dropped = data.permits.length - named.length;
  if (!named.length) return null;

  const bullets = named.map((p) => {
    const { render } = linkDisposition(p.rec_gov_url, linkVerdicts);
    const suffix = render === "anchor" ? ` — ${p.rec_gov_url}` : "";
    return T.sentence(p.name ?? "Unnamed entry", p.application_window, p.fees_note) + suffix;
  });
  if (dropped > 0) {
    bullets.push(
      `${dropped} catalog record(s) with no name or description were omitted as unusable.`,
    );
  }

  const paragraphs = [T.permitCatalogDisclaimer()];
  if (data.notes) paragraphs.push(data.notes);
  // Catalog tier: hedged, never a specific claim about this party.
  const hedge = hedgePrefix({
    value: null,
    tier: "lookup-inference",
    confidence: permits!.payload.confidence,
  });
  if (hedge) paragraphs.unshift(`${hedge} recreation.gov catalog data, not verified against this reservation.`);

  return { title: "Area permit systems", paragraphs, bullets };
}

function buildAccess(cfg: TripConfig, pull: TripPull): Section | null {
  const data = pull.access?.payload.data ?? null;
  const bullets: string[] = [];
  for (const road of data?.roads ?? []) {
    bullets.push(T.roadSentence(road.name, road.status, road.detail));
  }
  for (const pass of pull.conditions.payload.data?.pass_conditions ?? []) {
    if (pass.name && pass.status) {
      bullets.push(T.roadSentence(pass.name, pass.status, pass.restriction ?? null));
    }
  }

  const paragraphs: string[] = [];
  const driveHours =
    cfg.drive?.hours ??
    (data?.drive_time?.duration_min != null ? data.drive_time.duration_min / 60 : null);
  const origin = cfg.drive?.origin ?? data?.drive_time?.origin ?? null;
  if (origin) {
    const s = T.driveSentence(origin, driveHours);
    if (s) paragraphs.push(s);
  }
  if (cfg.campground) {
    paragraphs.push(
      T.sentence(
        `Night-before camp is ${cfg.campground.name}`,
        cfg.campground.first_come ? "first-come, first-served" : null,
        cfg.campground.sites ? `${cfg.campground.sites} sites` : null,
        cfg.campground.note ?? null,
      ),
    );
  }

  return sectionOrNull("Getting there", paragraphs, dedupe(bullets));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** #103 rule 9: omit, don't scaffold. */
function sectionOrNull(title: string, paragraphs: string[], bullets: string[]): Section | null {
  const p = paragraphs.filter((s) => Boolean(s?.trim()));
  const b = bullets.filter((s) => Boolean(s?.trim()));
  if (!p.length && !b.length) return null;
  return { title, paragraphs: p, bullets: b };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))];
}

/**
 * Every string the model will render, in render order — the surface
 * `lintTone` checks, and the reason the refresh line is appended last rather
 * than declared inline (STYLE.md rule 6).
 */
export function modelStrings(model: TripModel): string[] {
  const out: string[] = [
    model.title,
    model.subtitle ?? "",
    ...model.summary,
    ...model.days.flatMap((d) => [d.heading, d.forecast, d.sun]),
    model.camp.headline,
    ...model.camp.lines,
    ...model.camp.checklist,
  ];
  if (model.climb) {
    out.push(
      model.climb.heading,
      model.climb.summary,
      model.climb.precip ?? "",
      model.climb.caveat,
      ...model.climb.gear,
    );
  }
  for (const section of [
    model.hazards,
    model.ranger,
    model.access,
    model.rivers,
    model.water,
    model.permits_catalog,
  ]) {
    if (section) out.push(section.title, ...section.paragraphs, ...section.bullets);
  }
  out.push(model.refresh_line);
  return out.filter(Boolean);
}

export { disposition, assertSpecificClaim };
