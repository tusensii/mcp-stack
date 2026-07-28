import { describe, it, expect } from "vitest";
import { stripActivityTimeSeries } from "./activity.js";
import type { DailyActivity } from "../oura/types.js";

function makeActivity(overrides: Partial<DailyActivity>): DailyActivity {
  return {
    id: "id",
    active_calories: 500,
    average_met_minutes: 1.5,
    class_5_min: "1122330011223300",
    contributors: {
      meet_daily_targets: 80,
      move_every_hour: 90,
      recovery_time: 100,
      stay_active: 70,
      training_frequency: 60,
      training_volume: 65,
    },
    day: "2026-07-25",
    equivalent_walking_distance: 4000,
    high_activity_met_minutes: 20,
    high_activity_time: 600,
    inactivity_alerts: 2,
    low_activity_met_minutes: 100,
    low_activity_time: 3600,
    medium_activity_met_minutes: 50,
    medium_activity_time: 1800,
    met: { interval: 60, items: [1, 1.2, 1.5, 2], timestamp: "2026-07-25T00:00:00Z" },
    meters_to_target: null,
    non_wear_time: 0,
    resting_time: 28800,
    score: 85,
    sedentary_met_minutes: 30,
    sedentary_time: 36000,
    steps: 8500,
    target_calories: 500,
    target_meters: 5000,
    timestamp: "2026-07-25T00:00:00Z",
    total_calories: 2200,
    ...overrides,
  };
}

describe("stripActivityTimeSeries (issue #47)", () => {
  it("removes met and class_5_min", () => {
    const a = makeActivity({});
    const stripped = stripActivityTimeSeries(a) as Record<string, unknown>;
    expect(stripped).not.toHaveProperty("met");
    expect(stripped).not.toHaveProperty("class_5_min");
  });

  it("preserves all scalar/summary fields", () => {
    const a = makeActivity({});
    const stripped = stripActivityTimeSeries(a);
    expect(stripped.score).toBe(85);
    expect(stripped.steps).toBe(8500);
    expect(stripped.active_calories).toBe(500);
    expect(stripped.total_calories).toBe(2200);
    expect(stripped.contributors).toEqual(a.contributors);
    expect(stripped.high_activity_time).toBe(600);
    expect(stripped.day).toBe("2026-07-25");
  });

  it("does not mutate the input record", () => {
    const a = makeActivity({});
    const metBefore = a.met;
    stripActivityTimeSeries(a);
    expect(a.met).toBe(metBefore);
    expect(a.class_5_min).toBe("1122330011223300");
  });
});
