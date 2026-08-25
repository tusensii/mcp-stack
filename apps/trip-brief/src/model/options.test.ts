import { describe, expect, it } from "vitest";
import { buildOptionsModel, criteriaLines, scoreCandidate } from "./options.ts";
import type { CandidatePull, OptionsPull } from "../mcp/pull.ts";
import { FIXED_NOW, WEATHER, optionsConfig, result } from "../test/fixtures.ts";
import type { WeatherData } from "../mcp/types.ts";
import { CONDITIONS } from "../test/fixtures.ts";
import { OptionsConfigSchema } from "../config/schema.ts";

const CFG = optionsConfig();

/** A forecast with every day under 20% and no thunder. */
const DRY: WeatherData = {
  ...WEATHER,
  daily: WEATHER.daily.map((p) => ({
    ...p,
    probabilityOfPrecipitation: { value: 5 },
    shortForecast: "Sunny",
  })),
  alerts: [],
  elevation_adjusted: undefined,
};

function candidatePull(index: number, weather: WeatherData = DRY): CandidatePull {
  return {
    candidate: CFG.candidates[index]!,
    weather: result("get_weather", "live-instrument", weather),
    conditions: result("get_conditions", "official-static", CONDITIONS),
  };
}

function pullFor(weathers: WeatherData[]): OptionsPull {
  return {
    candidates: weathers.map((w, i) => candidatePull(i, w)),
    pulled_at: FIXED_NOW,
  };
}

describe("criteriaLines", () => {
  it("states every criterion the group agreed on", () => {
    const lines = criteriaLines(CFG.criteria);
    expect(lines[0]).toContain("20%");
    expect(lines[1]).toContain("No thunderstorms");
    expect(lines[2]).toContain("self-issue");
    expect(lines[3]).toContain("4 hr");
    expect(lines[4]).toContain("backpacking");
  });
});

describe("scoreCandidate", () => {
  it("qualifies a candidate that meets everything", () => {
    const card = scoreCandidate(candidatePull(1), CFG, new Map());
    expect(card.qualified).toBe(true);
    expect(card.failures).toEqual([]);
  });

  it("names the permit mechanism that disqualified it", () => {
    const card = scoreCandidate(candidatePull(0), CFG, new Map());
    expect(card.qualified).toBe(false);
    expect(card.failures.map((f) => f.criterion)).toContain("permit");
    expect(card.failures.find((f) => f.criterion === "permit")?.detail).toContain(
      "advance reservation",
    );
  });

  it("names the drive budget it blew", () => {
    const card = scoreCandidate(candidatePull(2), CFG, new Map());
    expect(card.failures.find((f) => f.criterion === "drive")?.detail).toBe(
      "Drive is 7 hr, over the 4 hr budget.",
    );
  });

  // Every criterion is evaluated so the group sees the whole picture at once.
  it("reports every failing criterion, not just the first", () => {
    const card = scoreCandidate(candidatePull(0, WEATHER), CFG, new Map());
    const kinds = card.failures.map((f) => f.criterion).sort();
    expect(kinds).toEqual(["permit", "precip", "thunder"]);
  });

  it("fails on precipitation over the ceiling and quotes the peak", () => {
    const card = scoreCandidate(candidatePull(1, WEATHER), CFG, new Map());
    expect(card.failures.find((f) => f.criterion === "precip")?.detail).toBe(
      "Precipitation peaks at 28%, over the 20% limit.",
    );
  });

  it("tolerates a thunder mention when the criterion is 'low'", () => {
    const relaxed = OptionsConfigSchema.parse({
      ...CFG,
      criteria: { ...CFG.criteria, thunder: "low", max_precip_pct: 40 },
    });
    const card = scoreCandidate(candidatePull(1, WEATHER), relaxed, new Map());
    expect(card.failures.map((f) => f.criterion)).not.toContain("thunder");
  });

  it("still fails 'low' when an actual watch is active", () => {
    const withAlert: WeatherData = {
      ...WEATHER,
      alerts: [{ event: "Severe Thunderstorm Watch", severity: "Severe" }],
    };
    const relaxed = OptionsConfigSchema.parse({
      ...CFG,
      criteria: { ...CFG.criteria, thunder: "low", max_precip_pct: 40 },
    });
    const card = scoreCandidate(candidatePull(1, withAlert), relaxed, new Map());
    expect(card.failures.find((f) => f.criterion === "thunder")?.detail).toContain(
      "active thunderstorm watch",
    );
  });

  // A candidate with no forecast is not silently a pass.
  it("disqualifies on missing data rather than passing by default", () => {
    const noForecast: CandidatePull = {
      candidate: CFG.candidates[1]!,
      weather: {
        tool: "get_weather",
        tier: "live-instrument",
        error: "504 Gateway Timeout",
        payload: { data: null, sources: [], confidence: "low", caveats: [] },
      },
      conditions: result("get_conditions", "official-static", CONDITIONS),
    };
    const card = scoreCandidate(noForecast, CFG, new Map());
    expect(card.qualified).toBe(false);
    expect(card.failures[0]?.criterion).toBe("data");
    expect(card.failures[0]?.detail).toContain("504");
  });

  it("keeps the proposer's name on a mid-discussion candidate", () => {
    expect(scoreCandidate(candidatePull(2), CFG, new Map()).proposed_by).toBe("M. Chen");
  });
});

describe("buildOptionsModel", () => {
  const model = buildOptionsModel({
    config: CFG,
    pull: pullFor([DRY, DRY, DRY]),
    linkVerdicts: new Map(),
    generated_at: FIXED_NOW,
  });

  it("keeps failing candidates visible rather than dropping them", () => {
    expect(model.qualified.map((c) => c.id)).toEqual(["tuck-robin"]);
    expect(model.disqualified.map((c) => c.id).sort()).toEqual(["far-away", "royal-basin"]);
    expect(model.qualified.length + model.disqualified.length).toBe(CFG.candidates.length);
  });

  it("orders the shortlist driest first", () => {
    const wetter: WeatherData = {
      ...DRY,
      daily: DRY.daily.map((p) => ({ ...p, probabilityOfPrecipitation: { value: 15 } })),
    };
    const relaxed = OptionsConfigSchema.parse({
      ...CFG,
      criteria: { ...CFG.criteria, permit_mechanisms: ["none", "self-issue", "reservation"] },
    });
    const m = buildOptionsModel({
      config: relaxed,
      pull: pullFor([wetter, DRY, DRY]),
      linkVerdicts: new Map(),
      generated_at: FIXED_NOW,
    });
    expect(m.qualified[0]?.id).toBe("tuck-robin");
    expect(m.qualified.at(-1)?.id).toBe("royal-basin");
  });

  it("carries the regions that were never searched", () => {
    expect(model.excluded_regions[0]?.name).toBe("North Cascades");
  });

  it("exposes the precipitation ceiling for the charts", () => {
    expect(model.precip_limit_pct).toBe(20);
  });

  it("ends with the refresh timestamp", () => {
    expect(model.refresh_line).toMatch(/^Data refreshed .+\.$/);
  });

  it("renders identically for identical input", () => {
    const again = buildOptionsModel({
      config: CFG,
      pull: pullFor([DRY, DRY, DRY]),
      linkVerdicts: new Map(),
      generated_at: FIXED_NOW,
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(model));
  });
});
