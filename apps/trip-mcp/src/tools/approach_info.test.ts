import { describe, it, expect } from "vitest";
import { APPROACHES } from "../approach.js";
import { AREAS } from "../areas.js";

describe("APPROACHES registry coverage (#82 acceptance)", () => {
  it("seeds all 12 areas with >=1 corridor carrying gas, supplies, and road notes", () => {
    for (const area of AREAS) {
      const corridors = APPROACHES[area.id];
      expect(corridors, `missing approach data for ${area.id}`).toBeDefined();
      expect(corridors!.length).toBeGreaterThan(0);
      const c = corridors![0]!;
      expect(c.last_gas, `${area.id} missing last_gas`).toBeTruthy();
      expect(c.last_supplies, `${area.id} missing last_supplies`).toBeTruthy();
      expect(c.road_notes, `${area.id} missing road_notes`).toBeTruthy();
    }
  });

  it("Mountain Loop corridor records the Everett-is-last-real-gear fact", () => {
    const loop = APPROACHES["glacier_peak"]!.find((c) => /mountain loop/i.test(c.corridor));
    expect(loop).toBeDefined();
    expect(loop!.last_real_gear).toMatch(/Everett/);
    expect(loop!.last_supplies).toMatch(/hardware/i);
  });
});
