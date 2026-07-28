import { describe, it, expect } from "vitest";
import { selectMainPeriodPerDay, sleepMetricValue, isSleepDerivedMetric } from "./metrics.js";
import type { SleepPeriod, TimeSeriesSamples } from "./types.js";

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

describe("isSleepDerivedMetric", () => {
  it("is true for hrv/rhr/sleep_total/deep_sleep/rem_sleep/respiratory_rate", () => {
    expect(isSleepDerivedMetric("hrv")).toBe(true);
    expect(isSleepDerivedMetric("rhr")).toBe(true);
    expect(isSleepDerivedMetric("sleep_total")).toBe(true);
    expect(isSleepDerivedMetric("deep_sleep")).toBe(true);
    expect(isSleepDerivedMetric("rem_sleep")).toBe(true);
    expect(isSleepDerivedMetric("respiratory_rate")).toBe(true);
  });

  it("is false for daily-report metrics", () => {
    expect(isSleepDerivedMetric("readiness")).toBe(false);
    expect(isSleepDerivedMetric("sleep_score")).toBe(false);
    expect(isSleepDerivedMetric("activity_score")).toBe(false);
    expect(isSleepDerivedMetric("spo2")).toBe(false);
  });
});

describe("sleepMetricValue", () => {
  it("reads the right field per metric", () => {
    const p = makePeriod({});
    expect(sleepMetricValue("hrv", p)).toBe(50);
    expect(sleepMetricValue("rhr", p)).toBe(55);
    expect(sleepMetricValue("sleep_total", p)).toBe(28800);
    expect(sleepMetricValue("deep_sleep", p)).toBe(5400);
    expect(sleepMetricValue("rem_sleep", p)).toBe(6000);
    expect(sleepMetricValue("respiratory_rate", p)).toBe(14);
  });
});

describe("selectMainPeriodPerDay", () => {
  it("excludes nap/late_nap/rest/deleted types", () => {
    const periods = [
      makePeriod({ id: "night", day: "2026-05-25", type: "long_sleep" }),
      makePeriod({ id: "nap", day: "2026-05-25", type: "nap" }),
      makePeriod({ id: "rest", day: "2026-05-25", type: "rest" }),
      makePeriod({ id: "gone", day: "2026-05-25", type: "deleted" }),
    ];
    const chosen = selectMainPeriodPerDay(periods, "hrv");
    expect(chosen.get("2026-05-25")?.id).toBe("night");
  });

  it("picks the longest-duration period with a non-null value for the metric", () => {
    const periods = [
      makePeriod({ id: "short", day: "2026-05-25", type: "sleep", total_sleep_duration: 1000, average_hrv: null }),
      makePeriod({ id: "long_null_hrv", day: "2026-05-25", type: "long_sleep", total_sleep_duration: 28800, average_hrv: null }),
      makePeriod({ id: "medium_has_hrv", day: "2026-05-25", type: "sleep", total_sleep_duration: 5000, average_hrv: 42 }),
    ];
    const chosen = selectMainPeriodPerDay(periods, "hrv");
    // The longest period (long_null_hrv) has null HRV, so the next-longest
    // with a non-null value (medium_has_hrv) should be picked.
    expect(chosen.get("2026-05-25")?.id).toBe("medium_has_hrv");
  });

  it("falls back to the longest period overall if every candidate is null for the metric", () => {
    const periods = [
      makePeriod({ id: "short", day: "2026-05-25", type: "sleep", total_sleep_duration: 1000, average_hrv: null }),
      makePeriod({ id: "long", day: "2026-05-25", type: "long_sleep", total_sleep_duration: 28800, average_hrv: null }),
    ];
    const chosen = selectMainPeriodPerDay(periods, "hrv");
    expect(chosen.get("2026-05-25")?.id).toBe("long");
  });

  it("groups independently per day", () => {
    const periods = [
      makePeriod({ id: "d1", day: "2026-05-24", type: "long_sleep" }),
      makePeriod({ id: "d2", day: "2026-05-25", type: "long_sleep" }),
    ];
    const chosen = selectMainPeriodPerDay(periods, "hrv");
    expect(chosen.get("2026-05-24")?.id).toBe("d1");
    expect(chosen.get("2026-05-25")?.id).toBe("d2");
  });
});
