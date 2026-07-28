import { describe, it, expect } from "vitest";
import { mainPeriodForDay, mostRecentNight } from "./night_summary.js";
import type { SleepPeriod, TimeSeriesSamples } from "../oura/types.js";

function makePeriod(overrides: Partial<SleepPeriod>): SleepPeriod {
  const ts: TimeSeriesSamples = { interval: 300, items: [1, 2, 3], timestamp: "2026-05-25T00:00:00Z" };
  return {
    id: "id",
    average_breath: 14,
    average_heart_rate: 60,
    average_hrv: 50,
    awake_time: null,
    bedtime_end: "2026-05-25T08:00:00-07:00",
    bedtime_start: "2026-05-24T23:00:00-07:00",
    day: "2026-05-25",
    deep_sleep_duration: 5400,
    efficiency: 90,
    heart_rate: ts,
    hrv: ts,
    latency: 600,
    light_sleep_duration: 10000,
    low_battery_alert: false,
    lowest_heart_rate: 55,
    movement_30_sec: "0000111",
    period: 1,
    readiness: null,
    readiness_score_delta: null,
    rem_sleep_duration: 6000,
    restless_periods: null,
    sleep_algorithm_version: null,
    sleep_analysis_reason: null,
    sleep_phase_30_sec: "1234",
    sleep_phase_5_min: "12",
    sleep_score_delta: null,
    time_in_bed: null,
    total_sleep_duration: 28800,
    type: "long_sleep",
    ring_id: null,
    app_sleep_phase_5_min: "12",
    ...overrides,
  };
}

describe("mainPeriodForDay (issue #49)", () => {
  it("picks the longest sleep/long_sleep period matching the day", () => {
    const periods = [
      makePeriod({ id: "short", day: "2026-05-25", type: "sleep", total_sleep_duration: 900 }),
      makePeriod({ id: "long", day: "2026-05-25", type: "long_sleep", total_sleep_duration: 28800 }),
      makePeriod({ id: "other_day", day: "2026-05-24", type: "long_sleep", total_sleep_duration: 30000 }),
    ];
    expect(mainPeriodForDay(periods, "2026-05-25")?.id).toBe("long");
  });

  it("excludes nap/late_nap/rest/deleted", () => {
    const periods = [
      makePeriod({ id: "nap", day: "2026-05-25", type: "nap" }),
      makePeriod({ id: "rest", day: "2026-05-25", type: "rest" }),
      makePeriod({ id: "gone", day: "2026-05-25", type: "deleted" }),
    ];
    expect(mainPeriodForDay(periods, "2026-05-25")).toBeUndefined();
  });

  it("returns undefined when no period matches the day", () => {
    const periods = [makePeriod({ day: "2026-05-24" })];
    expect(mainPeriodForDay(periods, "2026-05-25")).toBeUndefined();
  });
});

describe("mostRecentNight (issue #49)", () => {
  it("picks the period with the latest bedtime_end", () => {
    const periods = [
      makePeriod({ id: "older", bedtime_end: "2026-05-24T07:00:00-07:00" }),
      makePeriod({ id: "newest", bedtime_end: "2026-05-26T07:30:00-07:00" }),
      makePeriod({ id: "middle", bedtime_end: "2026-05-25T08:00:00-07:00" }),
    ];
    expect(mostRecentNight(periods)?.id).toBe("newest");
  });

  it("ignores nap/late_nap/rest/deleted types even if more recent", () => {
    const periods = [
      makePeriod({ id: "real_night", type: "long_sleep", bedtime_end: "2026-05-25T08:00:00-07:00" }),
      makePeriod({ id: "later_nap", type: "nap", bedtime_end: "2026-05-25T14:00:00-07:00" }),
    ];
    expect(mostRecentNight(periods)?.id).toBe("real_night");
  });

  it("returns undefined for an empty list", () => {
    expect(mostRecentNight([])).toBeUndefined();
  });
});
