import { describe, it, expect, afterEach, vi } from "vitest";
import { mainPeriodForDay, lookbackWindow, selectMostRecentNight } from "./night_summary.js";
import { todayInTz } from "./utils.js";
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

describe("selectMostRecentNight", () => {
  it("picks the main period of the latest day in the window", () => {
    const periods = [
      makePeriod({ id: "older", day: "2026-05-23", bedtime_end: "2026-05-23T07:00:00-07:00" }),
      makePeriod({ id: "newest", day: "2026-05-25", bedtime_end: "2026-05-25T07:30:00-07:00" }),
      makePeriod({ id: "middle", day: "2026-05-24", bedtime_end: "2026-05-24T08:00:00-07:00" }),
    ];
    expect(selectMostRecentNight(periods, "2026-05-25")?.id).toBe("newest");
  });

  it("ignores nap/late_nap/rest/deleted types even if more recent", () => {
    const periods = [
      makePeriod({ id: "real_night", type: "long_sleep", day: "2026-05-25" }),
      makePeriod({
        id: "later_nap",
        type: "nap",
        day: "2026-05-25",
        bedtime_end: "2026-05-25T14:00:00-07:00",
      }),
    ];
    expect(selectMostRecentNight(periods, "2026-05-25")?.id).toBe("real_night");
  });

  it("does not select a period keyed past today (late_nap rolled to tomorrow)", () => {
    const periods = [
      makePeriod({ id: "tonights_night", day: "2026-05-25" }),
      makePeriod({ id: "tomorrow", type: "long_sleep", day: "2026-05-26" }),
    ];
    expect(selectMostRecentNight(periods, "2026-05-25")?.id).toBe("tonights_night");
  });

  it("does not select a night older than the lookback window", () => {
    const periods = [makePeriod({ id: "ancient", day: "2026-05-20" })];
    expect(selectMostRecentNight(periods, "2026-05-25")).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(selectMostRecentNight([], "2026-05-25")).toBeUndefined();
  });
});

// Regression coverage for the live bug: night_summary with no `date` lagged one
// night behind oura_sleep_detail on 2026-08-24 and 2026-08-25 (Los Angeles),
// returning day 2026-08-23 while sleep_detail(start=end=today) returned the
// 2026-08-24 long_sleep. Root cause: the upstream /sleep window ended at
// `today`, and the endpoint drops a record with `day: today` from such a query.
describe("no-date night selection (2026-08-24 regression)", () => {
  // Shape of the real records pulled from the API during the repro.
  const aug23 = makePeriod({
    id: "aug23",
    day: "2026-08-23",
    type: "long_sleep",
    bedtime_start: "2026-08-22T22:32:28.000-07:00",
    bedtime_end: "2026-08-23T07:51:36.000-07:00",
    total_sleep_duration: 29550,
    sleep_analysis_reason: "foreground_sleep_analysis",
  });
  const aug24 = makePeriod({
    id: "aug24",
    day: "2026-08-24",
    type: "long_sleep",
    bedtime_start: "2026-08-23T22:59:54.000-07:00",
    bedtime_end: "2026-08-24T06:58:03.000-07:00",
    total_sleep_duration: 24900,
    // The night that used to be skipped. It is a `bedtime_edit` record, and
    // it is shorter than the night before it — neither may disqualify it.
    sleep_analysis_reason: "bedtime_edit",
  });

  it("(a) returns the latest night even when it is a bedtime_edit record", () => {
    const chosen = selectMostRecentNight([aug23, aug24], "2026-08-24");
    expect(chosen?.day).toBe("2026-08-24");
    expect(chosen?.sleep_analysis_reason).toBe("bedtime_edit");
  });

  it("(a) requests a window wide enough for the upstream endpoint to return it", () => {
    const window = lookbackWindow("2026-08-24");
    // end_date must clear `today`; ending at 2026-08-24 is what dropped the
    // 2026-08-24 record upstream in the first place.
    expect(window.end_date).toBe("2026-08-25");
    expect(window.start_date).toBe("2026-08-20");
    expect(aug24.day <= window.end_date).toBe(true);
  });

  it("(b) falls back to the prior night when today's has not synced yet", () => {
    const chosen = selectMostRecentNight([aug23], "2026-08-24");
    expect(chosen?.day).toBe("2026-08-23");
    expect(chosen?.id).toBe("aug23");
  });

  it("(b) still lags no further than the prior night on the following day", () => {
    // The second failing call in the report: on 2026-08-25, with 08-25 not yet
    // synced, the answer must be 08-24 — not 08-23 again.
    expect(selectMostRecentNight([aug23, aug24], "2026-08-25")?.day).toBe("2026-08-24");
  });

  it("prefers the longest period when a day has more than one", () => {
    const shortEvening = makePeriod({
      id: "short_evening",
      day: "2026-08-24",
      type: "sleep",
      bedtime_start: "2026-08-24T20:10:00.000-07:00",
      bedtime_end: "2026-08-24T21:05:00.000-07:00",
      total_sleep_duration: 3300,
    });
    // Latest bedtime_end would pick the 55-minute evening doze; the main
    // (longest) period for the day is the real night.
    expect(selectMostRecentNight([aug23, aug24, shortEvening], "2026-08-24")?.id).toBe("aug24");
  });
});

describe("(c) timezone edge: local date vs UTC date", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the local morning date, and its window covers last night", () => {
    // 2026-08-24T14:30Z === 07:30 America/Los_Angeles, the morning of 08-24.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T14:30:00Z"));
    const today = todayInTz();
    expect(today).toBe("2026-08-24");
    expect(lookbackWindow(today)).toEqual({
      start_date: "2026-08-20",
      end_date: "2026-08-25",
    });
    const aug24 = makePeriod({
      id: "aug24",
      day: "2026-08-24",
      // bedtime_start is 08-23 locally but 2026-08-24T05:59:54Z in UTC.
      bedtime_start: "2026-08-23T22:59:54.000-07:00",
      bedtime_end: "2026-08-24T06:58:03.000-07:00",
      sleep_analysis_reason: "bedtime_edit",
    });
    expect(selectMostRecentNight([aug24], today)?.day).toBe("2026-08-24");
  });

  it("does not roll the window forward when UTC has passed local midnight", () => {
    // 2026-08-25T05:30Z === 22:30 on 2026-08-24 in America/Los_Angeles: UTC is
    // already on the 25th while the user's day is still the 24th.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T05:30:00Z"));
    const today = todayInTz();
    expect(today).toBe("2026-08-24");
    expect(lookbackWindow(today).end_date).toBe("2026-08-25");
    const periods = [
      makePeriod({ id: "aug23", day: "2026-08-23" }),
      makePeriod({ id: "aug24", day: "2026-08-24" }),
    ];
    expect(selectMostRecentNight(periods, today)?.id).toBe("aug24");
  });
});
