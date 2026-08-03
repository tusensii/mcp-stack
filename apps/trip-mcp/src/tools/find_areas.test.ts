import { describe, it, expect } from "vitest";
import { hikeNameSimilar } from "./find_areas.js";

describe("hikeNameSimilar", () => {
  it("accepts exact and containment matches", () => {
    expect(hikeNameSimilar("Gothic Basin", "Gothic Basin")).toBe(true);
    expect(hikeNameSimilar("Gothic Basin", "gothic basin trail")).toBe(true);
    expect(hikeNameSimilar("Gothic Basin via Weden Creek", "Gothic Basin")).toBe(true);
  });

  it("accepts all-tokens-present matches", () => {
    expect(hikeNameSimilar("Basin of Gothic Peaks", "gothic basin")).toBe(true);
  });

  it("rejects unrelated hikes (the browse-page regression)", () => {
    expect(hikeNameSimilar("Big Beaver Trail", "Gothic Basin")).toBe(false);
    expect(hikeNameSimilar("Pratt Lake Basin", "Gothic Basin")).toBe(false);
    expect(hikeNameSimilar("", "Gothic Basin")).toBe(false);
  });
});
