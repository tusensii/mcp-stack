import { describe, expect, it } from "vitest";
import * as T from "./templates.ts";

describe("canonical forms", () => {
  it("renders the owner's stated day-summary form verbatim", () => {
    expect(
      T.dayForecastSentence({ weekday: "Saturday", precip_pct: 12, high_f: 68, low_f: 44 }),
    ).toBe("Saturday is 12% chance of rain, high near 68°F, low 44°F.");
  });

  it("drops missing clauses rather than printing placeholders", () => {
    expect(
      T.dayForecastSentence({ weekday: "Sunday", precip_pct: 8, high_f: null, low_f: 40 }),
    ).toBe("Sunday is 8% chance of rain, low 40°F.");
  });

  it("says so plainly when there is no precipitation probability", () => {
    expect(
      T.dayForecastSentence({ weekday: "Monday", precip_pct: null, high_f: 70, low_f: null }),
    ).toBe("Monday has no published precipitation probability, high near 70°F.");
  });

  it("states thunder as current state, listing days", () => {
    expect(T.thunderSentence(["Friday", "Saturday"])).toBe(
      "Thunderstorms are in the forecast for Friday and Saturday.",
    );
    expect(T.noThunderSentence()).toBe(
      "No thunderstorms are in the forecast for the trip window.",
    );
  });

  it("labels climb precipitation by the model that produced it", () => {
    expect(T.climbPrecipSentence(22, "elevation-adjusted")).toBe(
      "Precipitation probability on the climb is 22%, elevation-adjusted along the route.",
    );
    expect(T.climbPrecipSentence(22, "valley-grid")).toBe(
      "Precipitation probability on the climb is 22%, from the valley grid cell.",
    );
  });

  it("renders sun times in the fixed form", () => {
    expect(T.sunSentence("Friday", "6:14 AM", "8:12 PM", "8:47 PM")).toBe(
      "Friday: sunrise 6:14 AM, sunset 8:12 PM, dark 8:47 PM.",
    );
  });
});

describe("camp and permit prose", () => {
  const camp = {
    assigned_camp_area: "Upper Royal Basin camp area",
    nights: 2,
    camp_elevation_ft: 5300,
    above_treeline: true,
    toilet_available: false,
  };

  it("names the assigned area and the night count", () => {
    expect(T.campSentence(camp)).toBe(
      "Camp is Upper Royal Basin camp area for 2 nights, at 5,300 ft.",
    );
  });

  it("flags above-treeline exposure without editorializing", () => {
    expect(T.campExposureSentence(camp)).toContain("above treeline");
    expect(T.campExposureSentence({ ...camp, above_treeline: false })).toBeNull();
  });

  it("states the sanitation consequence of no toilet", () => {
    expect(T.sanitationSentence(camp)).toContain("no toilet");
    expect(T.sanitationSentence({ ...camp, toilet_available: true })).toBe(
      "Upper Royal Basin camp area has a toilet.",
    );
  });
});

describe("formatting", () => {
  it("returns null rather than NaN for absent numbers", () => {
    expect(T.pct(null)).toBeNull();
    expect(T.degF(undefined)).toBeNull();
    expect(T.feet(Number.NaN)).toBeNull();
    expect(T.cfs(null)).toBeNull();
  });

  it("formats durations as hours and minutes", () => {
    expect(T.hours(3.25)).toBe("3 hr 15 min");
    expect(T.hours(4)).toBe("4 hr");
    expect(T.hours(0.5)).toBe("30 min");
  });

  it("joins lists with an Oxford comma", () => {
    expect(T.joinList(["a"])).toBe("a");
    expect(T.joinList(["a", "b"])).toBe("a and b");
    expect(T.joinList(["a", "b", "c"])).toBe("a, b, and c");
  });
});

describe("determinism", () => {
  it("produces identical output for identical input", () => {
    const once = T.dayForecastSentence({
      weekday: "Saturday",
      precip_pct: 28,
      high_f: 71,
      low_f: 46,
    });
    const twice = T.dayForecastSentence({
      weekday: "Saturday",
      precip_pct: 28,
      high_f: 71,
      low_f: 46,
    });
    expect(once).toBe(twice);
  });
});

describe("tone lint", () => {
  it("catches the constructions that had to be corrected by hand", () => {
    const drifted = [
      "Saturday came into range for the group.",
      "Thursday night carries a 28% chance of rain.",
      "The trip is on.",
      "Conditions have improved since yesterday.",
      "The forecast is looking good.",
    ];
    // One line can trip more than one rule ("improved" and "since yesterday"),
    // so assert coverage rather than a count.
    for (const line of drifted) {
      expect(T.lintTone([line]).length, line).toBeGreaterThan(0);
    }
  });

  it("passes the templates' own output", () => {
    const rendered = [
      T.dayForecastSentence({ weekday: "Friday", precip_pct: 12, high_f: 68, low_f: 44 }),
      T.thunderSentence(["Saturday"])!,
      T.noThunderSentence(),
      T.noAlertSentence(),
      T.climbPrecipSentence(22, "elevation-adjusted")!,
      T.sunSentence("Friday", "6:14 AM", "8:12 PM", "8:47 PM"),
      T.unverifiedCampSentence(),
      T.permitCatalogDisclaimer(),
      T.GRID_SCALE_CAVEAT,
    ];
    expect(T.lintTone(rendered)).toEqual([]);
  });
});
