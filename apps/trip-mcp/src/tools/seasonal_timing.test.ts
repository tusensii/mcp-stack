import { describe, it, expect } from "vitest";
import { dayOfYear, windowRelevantToMonth } from "./seasonal_timing.js";
import { SEASONAL } from "../seasonal.js";
import { AREAS } from "../areas.js";

describe("dayOfYear", () => {
  it("maps MM-DD to day numbers", () => {
    expect(dayOfYear("01-01")).toBe(1);
    expect(dayOfYear("07-15")).toBe(196);
    expect(dayOfYear("12-31")).toBe(365);
  });
});

describe("windowRelevantToMonth", () => {
  const larch = { start: "09-25", end: "10-15" };

  it("keeps windows active in the month", () => {
    expect(windowRelevantToMonth(larch, 10)).toBe(true);
  });

  it("keeps windows starting within the ~6-week lookahead", () => {
    expect(windowRelevantToMonth(larch, 8)).toBe(true);
  });

  it("drops windows far outside the interest period", () => {
    expect(windowRelevantToMonth(larch, 2)).toBe(false);
    expect(windowRelevantToMonth({ start: "05-15", end: "06-30" }, 10)).toBe(false);
  });
});

describe("SEASONAL registry coverage (#80 acceptance)", () => {
  it("seeds all 12 areas with snow_free_typical and bug_pressure", () => {
    for (const area of AREAS) {
      const s = SEASONAL[area.id];
      expect(s, `missing seasonal data for ${area.id}`).toBeDefined();
      expect(s!.snow_free_typical, `missing snow_free_typical for ${area.id}`).toBeDefined();
      expect(s!.bug_pressure.length, `missing bug_pressure for ${area.id}`).toBeGreaterThan(0);
    }
  });

  it("has larch windows for the 3 larch areas", () => {
    for (const id of ["enchantments", "north_cascades", "pasayten"]) {
      expect(SEASONAL[id]?.larch_window, `missing larch window for ${id}`).toBeDefined();
    }
  });
});
