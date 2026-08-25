/**
 * Report prose (#103).
 *
 * Every sentence in the generated report comes from a template in this file.
 * Nothing here reads a clock, samples randomness, or branches on anything but
 * its arguments, so the same data renders the same words every time.
 *
 * The tone rules these templates encode are written out in STYLE.md. The short
 * version: dry, declarative, current state only. No narrative about how the
 * forecast changed since yesterday — that belongs in chat, not in the report.
 */

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

export function pct(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value)}%`;
}

export function degF(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value)}°F`;
}

export function feet(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value).toLocaleString("en-US")} ft`;
}

export function miles(value: number | null | undefined, decimals = 1): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value.toFixed(decimals)} mi`;
}

export function hours(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const whole = Math.floor(value);
  const minutes = Math.round((value - whole) * 60);
  if (minutes === 0) return `${whole} hr`;
  if (whole === 0) return `${minutes} min`;
  return `${whole} hr ${minutes} min`;
}

export function cfs(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value).toLocaleString("en-US")} cfs`;
}

/** Join clauses into one sentence with a terminating period, dropping blanks. */
export function sentence(...parts: Array<string | null | undefined>): string {
  const kept = parts.filter((p): p is string => Boolean(p && p.trim()));
  if (!kept.length) return "";
  const joined = kept.join(", ").replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(joined) ? joined : `${joined}.`;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export interface DayForecastInput {
  weekday: string;
  precip_pct: number | null;
  high_f: number | null;
  low_f: number | null;
}

/**
 * The canonical day summary. The owner's stated form, verbatim:
 *   "{day} is {pop}% chance of rain, high near {hi}, low {lo}."
 */
export function dayForecastSentence(input: DayForecastInput): string {
  const p = pct(input.precip_pct);
  const hi = degF(input.high_f);
  const lo = degF(input.low_f);

  const clauses: string[] = [];
  clauses.push(p ? `${input.weekday} is ${p} chance of rain` : `${input.weekday} has no published precipitation probability`);
  if (hi) clauses.push(`high near ${hi}`);
  if (lo) clauses.push(`low ${lo}`);
  return sentence(...clauses);
}

/** Present-state thunder line. No "chance of" narrative, no change-over-time. */
export function thunderSentence(days: string[]): string | null {
  if (!days.length) return null;
  if (days.length === 1) return `Thunderstorms are in the forecast for ${days[0]}.`;
  const list = joinList(days);
  return `Thunderstorms are in the forecast for ${list}.`;
}

export function noThunderSentence(): string {
  return "No thunderstorms are in the forecast for the trip window.";
}

export function windSentence(weekday: string, windText: string | null): string | null {
  if (!windText) return null;
  return `${weekday} wind is ${windText}.`;
}

export function freezingLevelSentence(feetValue: number | null): string | null {
  const f = feet(feetValue);
  return f ? `Freezing level is ${f}.` : null;
}

export function alertSentence(events: string[]): string | null {
  if (!events.length) return null;
  return `Active NWS alerts: ${joinList(events)}.`;
}

export function noAlertSentence(): string {
  return "No active NWS alerts for the point.";
}

// ---------------------------------------------------------------------------
// Climb / route
// ---------------------------------------------------------------------------

export interface ClimbInput {
  weekday: string;
  distance_mi: number | null;
  gain_ft: number | null;
  high_point_ft: number | null;
  window_start: string | null;
  window_end: string | null;
}

export function climbSentence(input: ClimbInput): string {
  const clauses: string[] = [];
  const d = miles(input.distance_mi);
  const g = feet(input.gain_ft);
  clauses.push(
    d && g
      ? `${input.weekday}'s climb is ${d} with ${g} of gain`
      : d
        ? `${input.weekday}'s climb is ${d}`
        : `${input.weekday} is the climb`,
  );
  const hp = feet(input.high_point_ft);
  if (hp) clauses.push(`topping out at ${hp}`);
  if (input.window_start && input.window_end) {
    clauses.push(`walking window ${input.window_start} to ${input.window_end}`);
  }
  return sentence(...clauses);
}

/**
 * Precipitation on the climb, labeled by which model produced it (#108).
 * The elevation-adjusted figure is preferred where the profile tool supplies
 * it; the grid-scale caveat stays attached either way.
 */
export function climbPrecipSentence(
  precipPct: number | null,
  source: "elevation-adjusted" | "valley-grid",
): string | null {
  const p = pct(precipPct);
  if (!p) return null;
  return source === "elevation-adjusted"
    ? `Precipitation probability on the climb is ${p}, elevation-adjusted along the route.`
    : `Precipitation probability on the climb is ${p}, from the valley grid cell.`;
}

/** "Rain shell — precipitation probability exceeds 20% above 4,500 ft." */
export function gearFlagSentence(item: string, reason: string): string {
  const trimmed = reason.trim();
  const lowered = /^[A-Z][a-z]/.test(trimmed)
    ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1)
    : trimmed;
  return sentence(`${item} — ${lowered}`);
}

export const GRID_SCALE_CAVEAT =
  "Precipitation type and amount remain grid-scale: a ~2.5 km NWS cell cannot " +
  "distinguish the trailhead from the basin above it.";

// ---------------------------------------------------------------------------
// Camp and permit (#104)
// ---------------------------------------------------------------------------

export interface CampInput {
  assigned_camp_area: string;
  nights: number;
  camp_elevation_ft: number | null;
  above_treeline: boolean;
  toilet_available: boolean;
}

export function campSentence(input: CampInput): string {
  const nights = input.nights === 1 ? "one night" : `${input.nights} nights`;
  const elev = feet(input.camp_elevation_ft);
  return sentence(
    `Camp is ${input.assigned_camp_area} for ${nights}`,
    elev ? `at ${elev}` : null,
  );
}

export function campExposureSentence(input: CampInput): string | null {
  if (!input.above_treeline) return null;
  return (
    `${input.assigned_camp_area} is above treeline. There is no tree cover for ` +
    `lightning or wind, and tent sites are on open ground.`
  );
}

export function sanitationSentence(input: CampInput): string {
  return input.toilet_available
    ? `${input.assigned_camp_area} has a toilet.`
    : `${input.assigned_camp_area} has no toilet. Pack a trowel and follow the area's human-waste rule.`;
}

export function unverifiedCampSentence(): string {
  return (
    "The camp assignment is unverified: no reservation confirmation was supplied " +
    "for this quota area, so the itinerary below does not name a camp zone."
  );
}

export function permitLine(reference: string, holder: string | null): string {
  return sentence(
    `Reservation ${reference}`,
    holder ? `held by ${holder}` : null,
  );
}

export function permitCatalogDisclaimer(): string {
  return (
    "Permit-system entries below are recreation.gov catalog records for the area. " +
    "They are not this party's reservation."
  );
}

// ---------------------------------------------------------------------------
// Sun (#108)
// ---------------------------------------------------------------------------

export function sunSentence(
  weekday: string,
  sunrise: string,
  sunset: string,
  civilDusk: string,
): string {
  return `${weekday}: sunrise ${sunrise}, sunset ${sunset}, dark ${civilDusk}.`;
}

export function terrainShadeSentence(shadeTime: string, minutes: number): string {
  return `Direct sun leaves camp around ${shadeTime}, roughly ${minutes} minutes before sunset, because the basin walls cut it off.`;
}

// ---------------------------------------------------------------------------
// Rivers, roads, water
// ---------------------------------------------------------------------------

export function gaugeSentence(
  siteName: string,
  discharge: number | null,
  context: string | null,
  readingTime: string | null,
): string {
  return sentence(
    `${siteName} is ${cfs(discharge) ?? "not reporting"}`,
    context ? `${context}` : null,
    readingTime ? `read ${readingTime}` : null,
  );
}

export function roadSentence(name: string, status: string, detail: string | null): string {
  return sentence(`${name} is ${status.toLowerCase()}`, detail);
}

export function driveSentence(origin: string, durationHours: number | null): string | null {
  const h = hours(durationHours);
  if (!h) return null;
  return `Drive from ${origin} is ${h}.`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Tone lint
// ---------------------------------------------------------------------------

/**
 * Phrases that drifted into the Royal Basin brief across three rounds of
 * correction. Encoded so the failure mode is a test failure, not another
 * round of edits.
 */
export const BANNED_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bcame? into range\b/i, why: "narrative about forecast change" },
  { pattern: /\bcarries a\b/i, why: "flowery construction; state the number plainly" },
  { pattern: /\bthe trip is (on|off)\b/i, why: "verdict prose; the report states conditions, not conclusions" },
  { pattern: /\b(improved|worsened|deteriorated|has shifted|now looks)\b/i, why: "change-over-time narrative belongs in chat" },
  { pattern: /\b(since yesterday|compared to (yesterday|last (week|check)))\b/i, why: "change-over-time narrative belongs in chat" },
  { pattern: /\b(fortunately|unfortunately|thankfully|luckily)\b/i, why: "editorializing" },
  { pattern: /\b(stunning|spectacular|gorgeous|breathtaking|magical)\b/i, why: "travel-brochure adjective" },
  { pattern: /\b(should be|ought to be|might just|hopefully)\b/i, why: "hedged speculation; state the forecast value" },
  { pattern: /\blooking (good|great|solid)\b/i, why: "verdict prose" },
];

export interface ToneViolation {
  text: string;
  match: string;
  why: string;
}

/** Returns every tone-rule violation found in the supplied strings. */
export function lintTone(texts: Iterable<string>): ToneViolation[] {
  const violations: ToneViolation[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const { pattern, why } of BANNED_PATTERNS) {
      const match = text.match(pattern);
      if (match) violations.push({ text, match: match[0], why });
    }
  }
  return violations;
}
