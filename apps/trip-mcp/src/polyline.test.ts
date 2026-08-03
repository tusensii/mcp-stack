import { describe, it, expect } from "vitest";
import { cumulativeM, haversineM, resamplePolyline } from "./polyline.js";

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
