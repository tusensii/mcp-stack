import { describe, it, expect } from "vitest";
import { summarizeAvailability } from "./permit_strategy.js";
import { PERMIT_STRATEGIES } from "../permit_strategy.js";
import { AREAS } from "../areas.js";

describe("PERMIT_STRATEGIES coverage (#83 acceptance)", () => {
  it("Enchantments has at least 3 distinct acquisition paths with windows and odds", () => {
    const s = PERMIT_STRATEGIES["enchantments"]!;
    expect(s.paths.length).toBeGreaterThanOrEqual(3);
    for (const p of s.paths) {
      expect(p.window).toBeTruthy();
      expect(p.odds_context).toBeTruthy();
    }
  });

  it("self-issued areas state the simple truth without padding", () => {
    const s = PERMIT_STRATEGIES["glacier_peak"]!;
    expect(s.paths).toHaveLength(1);
    expect(s.paths[0]!.method).toMatch(/self-issued/);
  });

  it("every rec_gov registry area has curated paths", () => {
    for (const area of AREAS) {
      if (area.permit_system.startsWith("rec_gov")) {
        const s = PERMIT_STRATEGIES[area.id];
        expect(s, `missing strategy for ${area.id}`).toBeDefined();
        expect(s!.paths.length).toBeGreaterThan(0);
      }
    }
  });

  it("walk-up beta exists for areas with real walk-up quotas", () => {
    expect(PERMIT_STRATEGIES["mt_rainier"]!.walk_up_beta).toBeTruthy();
    expect(PERMIT_STRATEGIES["north_cascades"]!.walk_up_beta).toBeTruthy();
  });
});

describe("summarizeAvailability", () => {
  it("counts dates with remaining capacity across nested grids", () => {
    const raw = {
      payload: {
        availability: {
          "233273_1": {
            date_availability: {
              "2026-09-01T00:00:00Z": { remaining: 0, total: 10 },
              "2026-09-02T00:00:00Z": { remaining: 3, total: 10 },
            },
          },
          "233273_2": {
            date_availability: {
              "2026-09-01T00:00:00Z": { remaining: 2, total: 4 },
            },
          },
        },
      },
    };
    const s = summarizeAvailability(raw, "2026-09");
    expect(s).toEqual({ available_days: 2, days_seen: 2 });
  });

  it("returns null on unrecognizable shapes instead of guessing", () => {
    expect(summarizeAvailability({ weird: [1, 2, 3] }, "2026-09")).toBeNull();
    expect(summarizeAvailability(null, "2026-09")).toBeNull();
  });
});
