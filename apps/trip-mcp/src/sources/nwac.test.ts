import { describe, it, expect } from "vitest";
import { dangerLabel, pointInRings } from "./nwac.js";
import { AREA_NWAC_ZONES } from "../tools/avalanche.js";
import { AREAS } from "../areas.js";

describe("dangerLabel", () => {
  it("maps the 1-5 scale and treats missing as No Rating", () => {
    expect(dangerLabel(1)).toBe("Low");
    expect(dangerLabel(3)).toBe("Considerable");
    expect(dangerLabel(5)).toBe("Extreme");
    expect(dangerLabel(0)).toBe("No Rating");
    expect(dangerLabel(-1)).toBe("No Rating");
    expect(dangerLabel(null)).toBe("No Rating");
  });
});

describe("pointInRings", () => {
  // Square around (48, -121.5): lon -122..-121, lat 47.5..48.5.
  const square: Array<Array<[number, number]>> = [
    [
      [-122, 47.5],
      [-121, 47.5],
      [-121, 48.5],
      [-122, 48.5],
      [-122, 47.5],
    ],
  ];

  it("detects inside and outside points", () => {
    expect(pointInRings(48, -121.5, square)).toBe(true);
    expect(pointInRings(49, -121.5, square)).toBe(false);
    expect(pointInRings(48, -123, square)).toBe(false);
  });
});

describe("AREA_NWAC_ZONES", () => {
  it("covers all 12 registry areas", () => {
    for (const area of AREAS) {
      expect(AREA_NWAC_ZONES[area.id], `missing zone mapping for ${area.id}`).toBeDefined();
      expect(AREA_NWAC_ZONES[area.id]!.length).toBeGreaterThan(0);
    }
  });
});
