import { describe, it, expect } from "vitest";
import { interpolateByMile, sampleIndices } from "./trail_weather_profile.js";

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
