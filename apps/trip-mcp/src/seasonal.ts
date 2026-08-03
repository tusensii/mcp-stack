/**
 * Curated seasonal-timing data per registry area (issue #80).
 *
 * SCHEMA (adding/editing areas is a data-only change):
 *  - Windows are "MM-DD".."MM-DD" ranges describing a TYPICAL year —
 *    actual timing swings ±2–3 weeks with snowpack. Never a guarantee.
 *  - `snow_free_typical`: main trails melted out → first persistent snow.
 *  - `larch_window`: golden larch viewing (only areas where larches are
 *    a real draw).
 *  - `wildflower_peak`, `stream_crossing_peak`: self-describing.
 *  - `bug_pressure`: months + severity; lakeside basins run worse.
 *  - `crowds`: peak-crowding windows worth planning around.
 *
 * Sources: WTA seasonal guidance and guidebook consensus — curated
 * regional knowledge, confidence low-to-medium by design.
 */

export interface SeasonalWindow {
  /** "MM-DD" inclusive. */
  start: string;
  /** "MM-DD" inclusive. */
  end: string;
}

export interface BugPressure {
  months: string;
  severity: "low" | "moderate" | "high";
  note?: string;
}

export interface CrowdWindow {
  window: string;
  note: string;
}

export interface Seasonal {
  snow_free_typical?: SeasonalWindow;
  larch_window?: SeasonalWindow;
  wildflower_peak?: SeasonalWindow;
  bug_pressure: BugPressure[];
  stream_crossing_peak?: SeasonalWindow;
  crowds?: CrowdWindow[];
  notes?: string;
}

export const SEASONAL: Record<string, Seasonal> = {
  enchantments: {
    snow_free_typical: { start: "07-15", end: "10-15" },
    larch_window: { start: "09-25", end: "10-15" },
    wildflower_peak: { start: "07-15", end: "08-15" },
    bug_pressure: [
      { months: "Jul–Aug", severity: "high", note: "worst around Snow Lakes and Core zone tarns" },
    ],
    stream_crossing_peak: { start: "05-15", end: "06-30" },
    crowds: [
      { window: "late Sep–mid Oct weekends", note: "larch madness — Colchuck/Core day traffic extreme" },
      { window: "Jul–Aug weekends", note: "Colchuck Lake and Aasgard day traffic heavy" },
    ],
    notes: "Core zone holds snow well into July most years; Aasgard Pass snow lingers and is a fall-line hazard when icy.",
  },
  mt_rainier: {
    snow_free_typical: { start: "07-15", end: "10-01" },
    wildflower_peak: { start: "07-20", end: "08-15" },
    bug_pressure: [{ months: "Jul–Aug", severity: "high", note: "notorious in Spray Park and Indian Bar" }],
    stream_crossing_peak: { start: "06-01", end: "07-15" },
    crowds: [
      { window: "late Jul–mid Aug", note: "wildflower peak — Paradise/Sunrise lots full by mid-morning" },
    ],
    notes: "Glacial rivers (Nisqually, White, Carbon drainages) pulse in the afternoon all summer — plan crossings for morning.",
  },
  north_cascades: {
    snow_free_typical: { start: "07-15", end: "10-01" },
    larch_window: { start: "09-25", end: "10-12" },
    wildflower_peak: { start: "07-20", end: "08-20" },
    bug_pressure: [{ months: "Jul", severity: "high", note: "Thunder Creek and low valley approaches" }],
    stream_crossing_peak: { start: "05-15", end: "06-30" },
    crowds: [
      { window: "late Sep–early Oct weekends", note: "larch traffic on Maple Pass and Cascade Pass corridors" },
    ],
    notes: "SR 20 typically closed mid-Nov to mid/late April — early and late season access is the binding constraint.",
  },
  olympic: {
    snow_free_typical: { start: "07-15", end: "10-15" },
    wildflower_peak: { start: "07-10", end: "08-10" },
    bug_pressure: [{ months: "Jul–Aug", severity: "moderate", note: "worse in Seven Lakes Basin" }],
    stream_crossing_peak: { start: "05-01", end: "06-30" },
    crowds: [{ window: "Jul–Aug", note: "High Divide quota fills instantly; coast strips busy at minus tides" }],
    notes: "Coast routes are year-round (tide-dependent, not snow-dependent); alpine interior follows the normal melt calendar.",
  },
  glacier_peak: {
    snow_free_typical: { start: "07-20", end: "09-30" },
    wildflower_peak: { start: "07-25", end: "08-20" },
    bug_pressure: [{ months: "Jul–Aug", severity: "high", note: "notorious across the White Chuck and Image Lake basins" }],
    stream_crossing_peak: { start: "05-15", end: "07-10" },
    crowds: [{ window: "Aug weekends", note: "modest by west-side standards; Image Lake camps fill" }],
    notes: "Glacial drainages pulse in the afternoon all summer. Road washouts (Suiattle FR 26) reshuffle access — check before trusting mileage.",
  },
  pasayten: {
    snow_free_typical: { start: "07-05", end: "10-10" },
    larch_window: { start: "09-22", end: "10-08" },
    wildflower_peak: { start: "07-01", end: "07-31" },
    bug_pressure: [{ months: "Jun–Jul", severity: "high", note: "boggy plateaus; improves markedly by August" }],
    stream_crossing_peak: { start: "05-15", end: "06-25" },
    crowds: [{ window: "late Sep–early Oct", note: "larch traffic concentrates on Horseshoe Basin; elsewhere stays empty" }],
    notes: "Driest of the big wildernesses — melts out earlier than the west side and stays hikeable into October.",
  },
  alpine_lakes: {
    snow_free_typical: { start: "07-01", end: "10-25" },
    wildflower_peak: { start: "07-05", end: "08-05" },
    bug_pressure: [
      { months: "Jun–Aug", severity: "high", note: "lake basins (Snow Lake, Necklace Valley) are the worst" },
    ],
    stream_crossing_peak: { start: "05-01", end: "06-20" },
    crowds: [{ window: "Jun–Sep weekends", note: "I-90 corridor trailheads overflow by 8am; weekdays transform the experience" }],
    notes: "Huge elevation spread: low valley trails open May–June while high passes hold snow past mid-July.",
  },
  henry_jackson: {
    snow_free_typical: { start: "07-15", end: "10-10" },
    wildflower_peak: { start: "07-15", end: "08-15" },
    bug_pressure: [{ months: "Jul–Aug", severity: "high", note: "Blanca Lake and Monte Cristo valley" }],
    stream_crossing_peak: { start: "05-15", end: "06-30" },
    crowds: [{ window: "Jul–Sep weekends", note: "Blanca Lake is a social-media magnet — arrive early or go midweek" }],
  },
  goat_rocks: {
    snow_free_typical: { start: "07-15", end: "10-01" },
    wildflower_peak: { start: "07-25", end: "08-15" },
    bug_pressure: [{ months: "Jul–Aug", severity: "moderate", note: "Snowgrass Flat evenings" }],
    stream_crossing_peak: { start: "06-01", end: "07-10" },
    crowds: [{ window: "late Jul–mid Aug weekends", note: "Snowgrass/Goat Lake loop at wildflower peak" }],
    notes: "Knife's Edge holds snow into early August some years — check trip reports before committing the PCT traverse.",
  },
  mt_st_helens: {
    snow_free_typical: { start: "06-15", end: "10-15" },
    wildflower_peak: { start: "06-15", end: "07-20" },
    bug_pressure: [{ months: "Jun–Jul", severity: "moderate", note: "Loowit plains after snowmelt" }],
    stream_crossing_peak: { start: "05-01", end: "06-15" },
    crowds: [{ window: "Jun–Sep weekends", note: "climbing permits sell out; Monitor Ridge steady traffic" }],
    notes: "Many climbers prefer late spring on consolidated snow over the summer scree slog; blast-zone trails melt out weeks before the cone's flanks.",
  },
  mt_adams: {
    snow_free_typical: { start: "07-10", end: "09-25" },
    wildflower_peak: { start: "07-15", end: "08-15" },
    bug_pressure: [{ months: "Jul", severity: "high", note: "Round-the-Mountain meadows" }],
    stream_crossing_peak: { start: "06-01", end: "07-10" },
    crowds: [{ window: "Jul–Aug weekends", note: "South Climb camps at Lunch Counter busy" }],
    notes: "South Climb is best in early season on snow — late summer turns to loose scree and rockfall risk rises.",
  },
  mt_baker: {
    snow_free_typical: { start: "07-25", end: "10-05" },
    wildflower_peak: { start: "07-25", end: "08-20" },
    bug_pressure: [{ months: "Jul–Aug", severity: "moderate" }],
    stream_crossing_peak: { start: "05-15", end: "07-01" },
    crowds: [
      { window: "Aug–Sep weekends", note: "Artist Point / Chain Lakes when SR 542's last miles finally open" },
    ],
    notes: "Deepest snowpack in the registry — Artist Point road often doesn't open until late July/August; verify SR 542 status.",
  },
};
