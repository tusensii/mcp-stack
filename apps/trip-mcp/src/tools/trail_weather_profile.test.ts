import { describe, it, expect } from "vitest";
import {
  computeGearFlags,
  etaHourForMile,
  interpolateByMile,
  sampleIndices,
} from "./trail_weather_profile.js";

describe("sampleIndices", () => {
  it("caps at maxSamples with endpoints included", () => {
    const idx = sampleIndices(50, 5);
    expect(idx).toHaveLength(5);
    expect(idx[0]).toBe(0);
    expect(idx[4]).toBe(49);
  });

  it("handles fewer points than samples", () => {
    expect(sampleIndices(3, 5)).toEqual([0, 1, 2]);
    expect(sampleIndices(1, 5)).toEqual([0]);
    expect(sampleIndices(0, 5)).toEqual([]);
  });
});

describe("interpolateByMile", () => {
  it("linearly interpolates between samples and clamps at the ends", () => {
    const out = interpolateByMile([0, 1, 2, 3, 4], [1, 3], [40, 60]);
    expect(out).toEqual([40, 40, 50, 60, 60]);
  });

  it("skips null samples", () => {
    const out = interpolateByMile([0, 2], [0, 1, 2], [40, null, 60]);
    expect(out).toEqual([40, 60]);
  });

  it("returns all nulls when no sample succeeded", () => {
    const out = interpolateByMile([0, 1], [0, 1], [null, null]);
    expect(out).toEqual([null, null]);
  });
});

describe("etaHourForMile", () => {
  it("computes linear arrival hours from start time and pace", () => {
    expect(etaHourForMile(0, "08:00", 2)).toBeCloseTo(8, 5);
    expect(etaHourForMile(4, "08:00", 2)).toBeCloseTo(10, 5);
    expect(etaHourForMile(3, "06:30", 1.5)).toBeCloseTo(8.5, 5);
  });

  it("clamps past-midnight arrivals to end of day", () => {
    expect(etaHourForMile(40, "18:00", 2)).toBeCloseTo(23.99, 2);
  });
});

describe("computeGearFlags", () => {
  const sample = (over: Record<string, unknown>) => ({
    mile: 0,
    ok: true,
    dayHours: [],
    temp_window_mean_f: 50,
    precip_window_max_pct: 0,
    precip_window_sum_in: 0,
    wind_window_max_mph: 5,
    cloud_window_mean_pct: 80,
    uv_window_max: 2,
    freezing_level_window_min_ft: 12000,
    ...over,
  });
  const warmPoints = [
    { mile: 0, elevation_ft: 2000, temp_f: 55 },
    { mile: 4, elevation_ft: 5000, temp_f: 48 },
  ];

  it("returns no flags in benign conditions", () => {
    const flags = computeGearFlags({
      points: warmPoints,
      samples: [sample({})] as never,
      maxElevationFt: 5000,
    });
    expect(flags).toEqual([]);
  });

  it("escalates rain_shell by precip probability", () => {
    const rec = computeGearFlags({
      points: warmPoints,
      samples: [sample({ precip_window_max_pct: 35 })] as never,
      maxElevationFt: 5000,
    });
    expect(rec.find((f) => f.item === "rain_shell")?.level).toBe("recommended");
    const strong = computeGearFlags({
      points: warmPoints,
      samples: [sample({ precip_window_max_pct: 70 })] as never,
      maxElevationFt: 5000,
    });
    expect(strong.find((f) => f.item === "rain_shell")?.level).toBe("strongly_recommended");
  });

  it("flags insulation and freezing risk with mile ranges", () => {
    const flags = computeGearFlags({
      points: [
        { mile: 0, elevation_ft: 2000, temp_f: 44 },
        { mile: 3, elevation_ft: 5000, temp_f: 30 },
        { mile: 4, elevation_ft: 5200, temp_f: 31 },
      ],
      samples: [sample({})] as never,
      maxElevationFt: 5200,
    });
    expect(flags.find((f) => f.item === "insulation")?.level).toBe("strongly_recommended");
    const freeze = flags.find((f) => f.item === "freezing_risk");
    expect(freeze?.affected_miles).toEqual([3, 4]);
  });

  it("flags traction when freezing level dips below route max elevation", () => {
    const flags = computeGearFlags({
      points: warmPoints,
      samples: [sample({ freezing_level_window_min_ft: 4500 })] as never,
      maxElevationFt: 5000,
    });
    expect(flags.some((f) => f.item === "traction")).toBe(true);
  });

  it("flags sun on clear high-UV days and wind with affected range", () => {
    const flags = computeGearFlags({
      points: warmPoints,
      samples: [
        sample({ cloud_window_mean_pct: 10, uv_window_max: 8 }),
        sample({ mile: 4, wind_window_max_mph: 26, cloud_window_mean_pct: 20, uv_window_max: 7 }),
      ] as never,
      maxElevationFt: 5000,
    });
    expect(flags.some((f) => f.item === "sun_protection")).toBe(true);
    expect(flags.find((f) => f.item === "wind_shell")?.affected_miles).toEqual([4, 4]);
  });

  it("returns nothing when no samples resolved", () => {
    const flags = computeGearFlags({
      points: warmPoints,
      samples: [sample({ ok: false })] as never,
      maxElevationFt: 5000,
    });
    expect(flags).toEqual([]);
  });
});
