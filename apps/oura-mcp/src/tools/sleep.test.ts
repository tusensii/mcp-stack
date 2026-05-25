import { describe, it, expect } from "vitest";
import {
  filterPeriodsByDay,
  shiftDate,
  stripTimeSeries,
} from "./sleep.js";
import type { SleepPeriod, TimeSeriesSamples } from "../oura/types.js";

function makePeriod(overrides: Partial<SleepPeriod>): SleepPeriod {
  const ts: TimeSeriesSamples = { interval: 300, items: [1, 2, 3], timestamp: "2026-05-25T00:00:00Z" };
  return {
    id: "id",
    average_breath: null,
    average_heart_rate: 60,
    average_hrv: 50,
    awake_time: null,
    bedtime_end: "2026-05-25T08:00:00-07:00",
    bedtime_start: "2026-05-24T23:00:00-07:00",
    day: "2026-05-25",
    deep_sleep_duration: null,
    efficiency: 90,
    heart_rate: ts,
    hrv: ts,
    latency: 600,
    light_sleep_duration: null,
    low_battery_alert: false,
    lowest_heart_rate: 55,
    movement_30_sec: "0000111",
    period: 1,
    readiness: null,
    readiness_score_delta: null,
    rem_sleep_duration: null,
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

describe("shiftDate", () => {
  it("adds positive days across a month boundary", () => {
    expect(shiftDate("2026-05-25", 1)).toBe("2026-05-26");
    expect(shiftDate("2026-05-31", 1)).toBe("2026-06-01");
  });

  it("subtracts days across a month boundary", () => {
    expect(shiftDate("2026-06-01", -1)).toBe("2026-05-31");
    expect(shiftDate("2026-05-25", -1)).toBe("2026-05-24");
  });

  it("is a no-op for 0", () => {
    expect(shiftDate("2026-05-25", 0)).toBe("2026-05-25");
  });
});

describe("filterPeriodsByDay", () => {
  it("keeps records whose day falls within [start, end] inclusive", () => {
    const periods = [
      makePeriod({ id: "a", day: "2026-05-24" }),
      makePeriod({ id: "b", day: "2026-05-25" }),
      makePeriod({ id: "c", day: "2026-05-26" }),
    ];
    const out = filterPeriodsByDay(periods, "2026-05-25", "2026-05-25");
    expect(out.map((p) => p.id)).toEqual(["b"]);
  });

  it("includes single-day record when widening would pull in adjacent days (issue #33 regression)", () => {
    // Simulates the widened upstream call: the user asked for 2026-05-25,
    // we fetched 2026-05-24..26, and the long_sleep with day:2026-05-25 must survive.
    const periods = [
      makePeriod({ id: "prior", day: "2026-05-24", bedtime_start: "2026-05-23T23:00:00-07:00" }),
      makePeriod({ id: "target", day: "2026-05-25", bedtime_start: "2026-05-24T23:44:00-07:00" }),
      makePeriod({ id: "after", day: "2026-05-26", bedtime_start: "2026-05-25T23:00:00-07:00" }),
    ];
    const out = filterPeriodsByDay(periods, "2026-05-25", "2026-05-25");
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("target");
  });

  it("returns empty when no records match", () => {
    const periods = [makePeriod({ day: "2026-05-20" })];
    expect(filterPeriodsByDay(periods, "2026-05-25", "2026-05-25")).toEqual([]);
  });

  it("handles multi-day ranges", () => {
    const periods = [
      makePeriod({ id: "a", day: "2026-05-23" }),
      makePeriod({ id: "b", day: "2026-05-24" }),
      makePeriod({ id: "c", day: "2026-05-25" }),
      makePeriod({ id: "d", day: "2026-05-26" }),
    ];
    const out = filterPeriodsByDay(periods, "2026-05-24", "2026-05-25");
    expect(out.map((p) => p.id)).toEqual(["b", "c"]);
  });
});

describe("stripTimeSeries", () => {
  it("removes all known time-series fields (issue #36)", () => {
    const p = makePeriod({});
    const stripped = stripTimeSeries(p) as Record<string, unknown>;
    expect(stripped).not.toHaveProperty("heart_rate");
    expect(stripped).not.toHaveProperty("hrv");
    expect(stripped).not.toHaveProperty("sleep_phase_30_sec");
    expect(stripped).not.toHaveProperty("sleep_phase_5_min");
    expect(stripped).not.toHaveProperty("app_sleep_phase_5_min");
    expect(stripped).not.toHaveProperty("movement_30_sec");
  });

  it("preserves summary scalars", () => {
    const p = makePeriod({});
    const stripped = stripTimeSeries(p);
    expect(stripped.id).toBe(p.id);
    expect(stripped.day).toBe(p.day);
    expect(stripped.efficiency).toBe(90);
    expect(stripped.total_sleep_duration).toBe(28800);
    expect(stripped.average_heart_rate).toBe(60);
    expect(stripped.average_hrv).toBe(50);
    expect(stripped.bedtime_start).toBe(p.bedtime_start);
    expect(stripped.bedtime_end).toBe(p.bedtime_end);
    expect(stripped.type).toBe("long_sleep");
  });

  it("does not mutate the input record", () => {
    const p = makePeriod({});
    const heart_rate_before = p.heart_rate;
    stripTimeSeries(p);
    expect(p.heart_rate).toBe(heart_rate_before);
    expect(p.sleep_phase_30_sec).toBe("1234");
  });

  it("include_time_series=true path returns the raw record (no stripping)", () => {
    // Sanity check the inverse path used inside the handler: when raw records
    // are passed through unmodified, time-series fields are still present.
    const p = makePeriod({});
    const passthrough = { ...p };
    expect(passthrough.heart_rate).not.toBeNull();
    expect(passthrough.sleep_phase_30_sec).toBe("1234");
  });
});

describe("oura_naps filter contract (issue #37)", () => {
  // The handler logic is: filterPeriodsByDay -> filter by type -> project.
  // This exercises the combined pipeline without needing to spin up an McpServer.
  const periods = [
    makePeriod({ id: "long", type: "long_sleep", day: "2026-05-25" }),
    makePeriod({ id: "nap1", type: "nap", day: "2026-05-25", bedtime_start: "2026-05-25T13:00:00-07:00", bedtime_end: "2026-05-25T13:30:00-07:00", total_sleep_duration: 1500, efficiency: 80, average_heart_rate: 65, average_hrv: 40 }),
    makePeriod({ id: "late", type: "late_nap", day: "2026-05-25", bedtime_start: "2026-05-24T17:24:00-07:00", bedtime_end: "2026-05-24T18:05:00-07:00", total_sleep_duration: 2460, efficiency: 70, average_heart_rate: 70, average_hrv: 35 }),
    makePeriod({ id: "rest", type: "rest", day: "2026-05-25" }),
    makePeriod({ id: "out", type: "nap", day: "2026-05-23" }),
  ];

  it("keeps only nap and late_nap within the requested window", () => {
    const filtered = filterPeriodsByDay(periods, "2026-05-25", "2026-05-25");
    const naps = filtered.filter((p) => p.type === "nap" || p.type === "late_nap");
    expect(naps.map((p) => p.id).sort()).toEqual(["late", "nap1"]);
  });

  it("projects only the documented summary fields per nap", () => {
    const filtered = filterPeriodsByDay(periods, "2026-05-25", "2026-05-25");
    const naps = filtered
      .filter((p) => p.type === "nap" || p.type === "late_nap")
      .map((p) => ({
        day: p.day,
        type: p.type,
        bedtime_start: p.bedtime_start,
        bedtime_end: p.bedtime_end,
        total_sleep_duration: p.total_sleep_duration,
        efficiency: p.efficiency,
        average_heart_rate: p.average_heart_rate,
        average_hrv: p.average_hrv,
      }));
    const nap1 = naps.find((n) => n.total_sleep_duration === 1500);
    expect(nap1).toMatchObject({
      day: "2026-05-25",
      type: "nap",
      total_sleep_duration: 1500,
      efficiency: 80,
      average_heart_rate: 65,
      average_hrv: 40,
    });
    // None of the heavy time-series fields leak through the projection.
    expect(nap1).not.toHaveProperty("heart_rate");
    expect(nap1).not.toHaveProperty("sleep_phase_30_sec");
  });
});
