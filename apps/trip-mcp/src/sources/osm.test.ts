import { describe, it, expect } from "vitest";
import * as osm from "./osm.js";
import { expandTrailAliases } from "../areas.js";

describe("osm source", () => {
  it("module loads", () => {
    void osm.findTrails;
    void osm.findTrailheads;
    void osm.findWaterSources;
    void osm.getOsmGeometry;
    void osm.findTrailGeometryByName;
  });

  it.todo("findTrails returns simplified ways within bbox");
  it.todo("findTrailheads filters to amenity=parking + hiking=yes");
  it.todo("findWaterSources tags springs vs streams correctly");
  it.todo("self-throttle enforces ~1 req/sec");
});

describe("trailMatchesQuery", () => {
  const wedenCreek = {
    name: "Weden Creek Trail",
    alt_name: "Gothic Basin Trail",
    official_name: "Weden Creek (Gothic Basin) Trail #724",
    ref: "724",
  };

  it("matches the primary name substring, case-insensitively", () => {
    expect(osm.trailMatchesQuery(wedenCreek, "weden creek")).toBe(true);
    expect(osm.trailMatchesQuery(wedenCreek, "WEDEN")).toBe(true);
  });

  it("matches alt_name and official_name, not just name", () => {
    expect(osm.trailMatchesQuery(wedenCreek, "gothic basin")).toBe(true);
    expect(osm.trailMatchesQuery({ name: "X", loc_name: "Gothic Basin" }, "gothic")).toBe(true);
  });

  it("matches USFS trail numbers against ref in all common spellings", () => {
    expect(osm.trailMatchesQuery(wedenCreek, "724")).toBe(true);
    expect(osm.trailMatchesQuery(wedenCreek, "Trail 724")).toBe(true);
    expect(osm.trailMatchesQuery(wedenCreek, "#724")).toBe(true);
  });

  it("matches semicolon-list refs and prefixed ref values", () => {
    expect(osm.trailMatchesQuery({ name: "X", ref: "708;724" }, "724")).toBe(true);
    expect(osm.trailMatchesQuery({ name: "X", ref: "Trail 724" }, "724")).toBe(true);
  });

  it("does not match unrelated names or numbers", () => {
    expect(osm.trailMatchesQuery(wedenCreek, "perry creek")).toBe(false);
    expect(osm.trailMatchesQuery(wedenCreek, "725")).toBe(false);
    // "72" is not the ref and not a substring of any name.
    expect(osm.trailMatchesQuery(wedenCreek, "72")).toBe(false);
  });

  it("empty query matches everything; missing tags match nothing", () => {
    expect(osm.trailMatchesQuery(wedenCreek, "  ")).toBe(true);
    expect(osm.trailMatchesQuery(undefined, "weden")).toBe(false);
  });
});

describe("osmTrailMatchesQuery", () => {
  it("matches mapped OsmTrail records across name, alt_names, and ref", () => {
    const trail = {
      id: "way/1",
      name: "Weden Creek Trail",
      ref: "724",
      alt_names: ["Gothic Basin Trail"],
      surface: "",
      length_m_estimate: 0,
    };
    expect(osm.osmTrailMatchesQuery(trail, "gothic basin")).toBe(true);
    expect(osm.osmTrailMatchesQuery(trail, "724")).toBe(true);
    expect(osm.osmTrailMatchesQuery(trail, "sahale")).toBe(false);
  });
});

describe("expandTrailAliases", () => {
  it("expands seeded popular names embedded in a query", () => {
    expect(expandTrailAliases("Gothic Basin")).toEqual(["weden creek"]);
    expect(expandTrailAliases("gothic basin trail")).toEqual(["weden creek"]);
  });

  it("returns nothing for unseeded names", () => {
    expect(expandTrailAliases("sahale arm")).toEqual([]);
  });
});
