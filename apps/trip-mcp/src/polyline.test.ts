import { describe, it, expect } from "vitest";
import { chainSegments, cumulativeM, haversineM, resamplePolyline } from "./polyline.js";

// ~1.1km due-north segment near Barlow Pass.
const A = { lat: 48.02, lon: -121.44 };
const B = { lat: 48.03, lon: -121.44 };
const C = { lat: 48.04, lon: -121.44 };

describe("polyline", () => {
  it("haversine of a 0.01deg latitude step is ~1113m", () => {
    const d = haversineM(A, B);
    expect(d).toBeGreaterThan(1050);
    expect(d).toBeLessThan(1180);
  });

  it("cumulativeM starts at 0 and is monotonic", () => {
    const cum = cumulativeM([A, B, C]);
    expect(cum[0]).toBe(0);
    expect(cum[1]!).toBeGreaterThan(0);
    expect(cum[2]!).toBeGreaterThan(cum[1]!);
  });

  it("annotates without resampling when already under target", () => {
    const out = resamplePolyline([A, B, C], 50);
    expect(out).toHaveLength(3);
    expect(out[0]!.mile).toBe(0);
    expect(out[2]!.mile).toBeCloseTo(1.38, 1);
  });

  it("downsamples long polylines to the target count, keeping endpoints", () => {
    const dense = Array.from({ length: 500 }, (_, i) => ({
      lat: 48.02 + i * 0.0001,
      lon: -121.44,
    }));
    const out = resamplePolyline(dense, 50);
    expect(out).toHaveLength(50);
    expect(out[0]!.lat).toBeCloseTo(48.02, 6);
    expect(out[49]!.lat).toBeCloseTo(dense[499]!.lat, 4);
    // Even spacing: consecutive mile deltas roughly constant.
    const deltas = out.slice(1).map((p, i) => p.mile - out[i]!.mile);
    const min = Math.min(...deltas);
    const max = Math.max(...deltas);
    expect(max - min).toBeLessThan(0.01);
  });

  it("handles degenerate zero-length input", () => {
    const out = resamplePolyline([A, A, A], 10);
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.mile === 0)).toBe(true);
  });
});

describe("chainSegments", () => {
  // Three collinear segments heading north, each ~1.1 km, sharing endpoints.
  const p = (lat: number) => ({ lat, lon: -121.44 });
  const seg1 = [p(48.0), p(48.01)];
  const seg2 = [p(48.01), p(48.02)];
  const seg3 = [p(48.02), p(48.03)];

  it("chains connected segments in order from the hint endpoint", () => {
    const out = chainSegments([seg2, seg3, seg1], p(48.0));
    expect(out.segments_used).toBe(3);
    expect(out.bridged_gaps_m).toEqual([]);
    expect(out.leftover_segments).toBe(0);
    expect(out.points[0]!.lat).toBeCloseTo(48.0, 6);
    expect(out.points[out.points.length - 1]!.lat).toBeCloseTo(48.03, 6);
  });

  it("reverses segments stored in the opposite direction", () => {
    const seg2rev = [...seg2].reverse();
    const out = chainSegments([seg1, seg2rev, seg3], p(48.0));
    expect(out.segments_used).toBe(3);
    expect(out.points[out.points.length - 1]!.lat).toBeCloseTo(48.03, 6);
  });

  it("bridges small gaps and records them; leaves distant segments out", () => {
    // ~44m gap between seg1 end (48.01) and gapSeg start.
    const gapSeg = [p(48.0104), p(48.02)];
    // Far segment ~1.1km away from anything.
    const farSeg = [p(48.05), p(48.06)];
    const out = chainSegments([seg1, gapSeg, farSeg], p(48.0));
    expect(out.segments_used).toBe(2);
    expect(out.bridged_gaps_m).toHaveLength(1);
    expect(out.bridged_gaps_m[0]!).toBeGreaterThan(30);
    expect(out.bridged_gaps_m[0]!).toBeLessThanOrEqual(50);
    expect(out.leftover_segments).toBe(1);
  });

  it("caps runaway chains at the max length", () => {
    // 60 segments x ~1.1km = ~66km > 48.28km cap.
    const segs = Array.from({ length: 60 }, (_, i) => [p(48 + i * 0.01), p(48 + (i + 1) * 0.01)]);
    const out = chainSegments(segs, p(48.0));
    expect(out.capped).toBe(true);
    expect(out.segments_used).toBeLessThan(60);
  });

  it("single segment behaves as before", () => {
    const out = chainSegments([seg1], p(48.0));
    expect(out.segments_used).toBe(1);
    expect(out.points).toHaveLength(2);
    expect(out.leftover_segments).toBe(0);
  });
});
