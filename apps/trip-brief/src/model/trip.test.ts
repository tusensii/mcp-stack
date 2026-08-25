import { describe, expect, it } from "vitest";
import { buildTripModel, modelStrings, rollupDaily } from "./trip.ts";
import { lintTone } from "../prose/templates.ts";
import { verifyLinks } from "../provenance/links.ts";
import {
  FIXED_NOW,
  PERMITS_NULL_NAME,
  TRIP_CONFIG_RAW,
  WEATHER,
  result,
  tripConfig,
  tripPull,
} from "../test/fixtures.ts";
import { TripConfigSchema } from "../config/schema.ts";

const NO_LINKS = new Map();

async function skipVerdicts(urls: string[]) {
  return verifyLinks(urls, { mode: "skip" });
}

function build(cfgOverrides: Record<string, unknown> = {}, pullOverrides = {}) {
  return buildTripModel({
    config: tripConfig(cfgOverrides),
    pull: tripPull(pullOverrides),
    linkVerdicts: NO_LINKS,
    generated_at: FIXED_NOW,
  });
}

describe("rollupDaily", () => {
  it("pairs day and night periods into one row per date", () => {
    const rows = rollupDaily(WEATHER.daily);
    expect(rows.get("2026-08-21")).toMatchObject({ high_f: 68, low_f: 44 });
  });

  it("takes the max precipitation probability across day and night", () => {
    // Friday day is 12%, Friday night is 20% — a night in camp counts.
    expect(rollupDaily(WEATHER.daily).get("2026-08-21")?.precip_pct).toBe(20);
  });

  it("flags thunder from either the short or detailed forecast", () => {
    expect(rollupDaily(WEATHER.daily).get("2026-08-22")?.thunder).toBe(true);
    expect(rollupDaily(WEATHER.daily).get("2026-08-21")?.thunder).toBe(false);
  });
});

describe("summary", () => {
  it("renders one templated sentence per trip day", () => {
    const model = build();
    expect(model.summary[0]).toBe("Friday is 20% chance of rain, high near 68°F, low 44°F.");
    expect(model.summary[1]).toBe("Saturday is 28% chance of rain, high near 71°F, low 46°F.");
  });

  it("states thunder days and alert state explicitly", () => {
    const model = build();
    expect(model.summary).toContain("Thunderstorms are in the forecast for Saturday.");
    expect(model.summary).toContain("No active NWS alerts for the point.");
  });

  it("adds the valley-shade note when the config supplies one", () => {
    const model = build();
    expect(model.summary.at(-1)).toMatch(/Direct sun leaves camp around .* basin walls cut it off\./);
  });
});

// #104 — camp facts come from the reservation, never from where people usually camp.
describe("camp and permit", () => {
  it("derives the camp headline from the assigned camp area", () => {
    const model = build();
    expect(model.camp.verified).toBe(true);
    expect(model.camp.headline).toBe(
      "Camp is Upper Royal Basin camp area for 2 nights, at 5,300 ft.",
    );
  });

  it("puts the confirmation reference — not a catalog id — in the checklist", () => {
    const model = build();
    expect(model.camp.checklist[0]).toBe("Reservation OLYM-2026-884213, held by C. Petrie.");
    expect(model.camp.checklist.join(" ")).not.toContain("4098362");
  });

  it("derives sanitation and exposure from the reservation's own flags", () => {
    const model = build();
    expect(model.camp.lines.join(" ")).toContain("no toilet");
    expect(model.hazards?.bullets.join(" ")).toContain("above treeline");
  });

  it("raises the above-treeline thunder combination to the top of hazards", () => {
    const model = build();
    expect(model.hazards?.bullets[0]).toBe(
      "Thunderstorms are forecast and camp is above treeline: Saturday.",
    );
  });

  it("drops the reservation-derived exposure line when camp is below treeline", () => {
    const model = build({
      reservation: { ...TRIP_CONFIG_RAW.reservation, above_treeline: false },
    });
    // The area-wide note from get_safety_brief still stands; what must go is
    // the line asserting *this camp* is exposed.
    expect(model.hazards?.bullets.join(" ")).not.toContain(
      "Upper Royal Basin camp area is above treeline",
    );
    expect(model.hazards?.bullets.join(" ")).not.toContain(
      "Thunderstorms are forecast and camp is above treeline",
    );
  });

  it("says the assignment is unverified when no confirmation was supplied", () => {
    const cfg = TripConfigSchema.parse({
      ...TRIP_CONFIG_RAW,
      permit: { required: false, mechanism: "self-issue" },
      reservation: undefined,
    });
    const model = buildTripModel({
      config: cfg,
      pull: tripPull(),
      linkVerdicts: NO_LINKS,
      generated_at: FIXED_NOW,
    });
    expect(model.camp.verified).toBe(false);
    expect(model.camp.headline).toContain("unverified");
    expect(model.camp.reservation_facts).toEqual([]);
    expect(model.camp.checklist[0]).toContain("self-issue permit at the trailhead");
  });
});

// #105 — a catalog record is never promoted into a claim about this party.
describe("permit catalog", () => {
  it("renders named catalog entries under a disclaimer", () => {
    const model = build();
    expect(model.permits_catalog?.paragraphs.join(" ")).toContain("not this party's reservation");
    expect(model.permits_catalog?.paragraphs.join(" ")).toContain("Unverified lookup:");
  });

  it("drops records with no name and no description as unusable", () => {
    const model = build({}, {
      permits: result("get_permits", "lookup-inference", PERMITS_NULL_NAME),
    });
    // The null-name record was the whole permit list, so no section renders.
    expect(model.permits_catalog).toBeNull();
  });
});

// #108
describe("sun times and days", () => {
  it("renders sunrise, sunset and dark for every trip day", () => {
    const model = build();
    expect(model.days).toHaveLength(3);
    for (const day of model.days) {
      expect(day.sun).toMatch(/^\w+: sunrise \d+:\d\d [AP]M, sunset \d+:\d\d [AP]M, dark \d+:\d\d [AP]M\.$/);
    }
  });

  it("marks the climb day", () => {
    const model = build();
    expect(model.days.filter((d) => d.is_climb_day).map((d) => d.iso)).toEqual(["2026-08-21"]);
  });
});

// #108 — climb precipitation prefers the elevation-adjusted source.
describe("climb card", () => {
  it("uses the along-route profile when it is available", () => {
    const model = build();
    expect(model.climb?.precip_source).toBe("elevation-adjusted");
    expect(model.climb?.precip).toBe(
      "Precipitation probability on the climb is 22%, elevation-adjusted along the route.",
    );
  });

  it("falls back to the elevation_adjusted block when the profile is missing", () => {
    const model = build({}, { trailWeather: null });
    expect(model.climb?.precip_source).toBe("elevation-adjusted");
    // Open-Meteo's Friday figure, not the NWS valley 20%.
    expect(model.climb?.precip).toContain("18%");
  });

  it("falls back to the valley grid last, and says so in the build warnings", () => {
    const noAdjusted = { ...WEATHER, elevation_adjusted: undefined };
    const model = build({}, {
      trailWeather: null,
      weather: result("get_weather", "live-instrument", noAdjusted),
    });
    expect(model.climb?.precip_source).toBe("valley-grid");
    expect(model.climb?.precip).toContain("from the valley grid cell");
    expect(model.warnings.join(" ")).toContain("fell back to the valley grid");
  });

  it("keeps the grid-scale caveat regardless of source", () => {
    expect(build().climb?.caveat).toContain("grid-scale");
  });

  it("keeps only gear flags above 'consider'", () => {
    const model = build();
    expect(model.climb?.gear).toHaveLength(1);
    expect(model.climb?.gear[0]).toBe(
      "Rain shell — precipitation probability exceeds 20% above 4,500 ft.",
    );
  });

  it("is absent when the config defines no climb window", () => {
    expect(build({ route: { trail_name: "Upper Dungeness Trail" } }).climb).toBeNull();
  });
});

// #107
describe("offline inputs", () => {
  it("prints the reservation as a full label/value list", () => {
    const facts = build().camp.reservation_facts;
    expect(facts.find((f) => f.label === "Confirmation")?.value).toBe("OLYM-2026-884213");
    expect(facts.find((f) => f.label === "Camp area")?.value).toBe("Upper Royal Basin camp area");
    expect(facts.find((f) => f.label === "Entered from")?.value).toBe("confirmation screenshot");
  });

  it("derives the return drive from the outbound steps and flags it as derived", () => {
    const model = build();
    expect(model.directions_back_derived).toBe(true);
    expect(model.directions_back).toEqual([...TRIP_CONFIG_RAW.drive.outbound].reverse());
  });

  it("prefers explicit return directions and does not flag them", () => {
    const model = build({
      drive: { ...TRIP_CONFIG_RAW.drive, return: ["FS 2860 north to US-101."] },
    });
    expect(model.directions_back_derived).toBe(false);
    expect(model.directions_back).toEqual(["FS 2860 north to US-101."]);
  });

  it("carries coordinates for every named point", () => {
    expect(build().coordinates.map((c) => c.label)).toEqual([
      "Upper Royal Basin",
      "Upper Dungeness Trailhead",
    ]);
  });
});

// #108
describe("ranger call and roles", () => {
  it("renders the ranger call with its fallback plan", () => {
    const model = build();
    expect(model.ranger?.title).toBe("Ranger call");
    expect(model.ranger?.bullets.at(-1)).toContain("If the campground is full:");
  });

  it("omits the section entirely when no call was logged", () => {
    expect(build({ ranger_call: undefined }).ranger).toBeNull();
  });

  it("omits roles when none are configured", () => {
    expect(build({ group_roles: [] }).roles).toEqual([]);
  });
});

describe("degradation", () => {
  it("records a failed pull as a warning rather than aborting", () => {
    const model = build({}, {
      rivers: {
        tool: "get_river_conditions",
        tier: "live-instrument" as const,
        error: "504 Gateway Timeout",
        payload: { data: null, sources: [], confidence: "low" as const, caveats: [] },
      },
    });
    expect(model.rivers).toBeNull();
    expect(model.warnings.join(" ")).toContain("get_river_conditions was unavailable");
  });

  it("omits sections with no content instead of scaffolding them", () => {
    const model = build({}, { campWater: null });
    expect(model.water).toBeNull();
  });
});

// #103
describe("prose discipline", () => {
  it("renders identical output for identical input", () => {
    const a = build();
    const b = build();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("passes the tone lint across every rendered string", () => {
    expect(lintTone(modelStrings(build()))).toEqual([]);
  });

  it("ends with the refresh timestamp", () => {
    const model = build();
    expect(model.refresh_line).toMatch(/^Data refreshed .+\.$/);
    expect(modelStrings(model).at(-1)).toBe(model.refresh_line);
  });
});

// #105
describe("links and citations", () => {
  it("renders unverified links as plain text and warns", async () => {
    const model = buildTripModel({
      config: tripConfig(),
      pull: tripPull(),
      linkVerdicts: new Map(),
      generated_at: FIXED_NOW,
    });
    expect(model.links[0]?.render).toBe("text");
    expect(model.warnings.join(" ")).toContain("rendered as plain text");
  });

  it("renders verified links as anchors", async () => {
    const url = TRIP_CONFIG_RAW.links[0].url;
    const verdicts = await skipVerdicts([url]);
    const model = buildTripModel({
      config: tripConfig(),
      pull: tripPull(),
      linkVerdicts: verdicts,
      generated_at: FIXED_NOW,
    });
    expect(model.links[0]?.render).toBe("anchor");
  });

  it("labels every citation with its provenance tier", () => {
    const model = build();
    expect(model.citations.length).toBeGreaterThan(0);
    for (const c of model.citations) expect(c.tier_label).toBeTruthy();
  });
});
