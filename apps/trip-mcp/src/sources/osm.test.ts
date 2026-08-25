import { describe, it, expect, vi, afterEach } from "vitest";
import * as osm from "./osm.js";
import { expandTrailAliases } from "../areas.js";
import type { Env } from "../types.js";

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

// #93 — an empty Overpass result must carry why it is empty.
describe("Overpass failure classification", () => {
  it("reads a server-side timeout out of the remark, not the status code", () => {
    expect(
      osm.classifyRemark(
        'runtime error: Query timed out in "query" at line 1 after 25 seconds.',
      ),
    ).toBe("timeout");
  });

  it("recognises rate limiting in a remark", () => {
    expect(osm.classifyRemark("Too many requests from your IP")).toBe("rate_limited");
    expect(osm.classifyRemark("rate limit exceeded")).toBe("rate_limited");
  });

  it("falls back to a generic remark failure for anything else", () => {
    expect(osm.classifyRemark("runtime error: Query ran out of memory")).toBe(
      "server_remark",
    );
  });

  it("maps HTTP codes to the failure they represent", () => {
    expect(osm.classifyHttpStatus(429)).toBe("rate_limited");
    expect(osm.classifyHttpStatus(504)).toBe("timeout");
    expect(osm.classifyHttpStatus(408)).toBe("timeout");
    expect(osm.classifyHttpStatus(500)).toBe("http_error");
    expect(osm.classifyHttpStatus(403)).toBe("http_error");
  });

  // http-fetch converts these before the status code is ever visible.
  it("classifies the errors the fetch client throws rather than lumping them together", () => {
    const named = (name: string) => Object.assign(new Error("x"), { name });
    expect(osm.classifyThrownError(named("RateLimitError"))).toBe("rate_limited");
    expect(osm.classifyThrownError(named("TimeoutError"))).toBe("timeout");
    expect(osm.classifyThrownError(named("HttpError"))).toBe("http_error");
    expect(osm.classifyThrownError(new TypeError("fetch failed"))).toBe("network_error");
    expect(osm.classifyThrownError(undefined)).toBe("network_error");
  });

  it("describes every failure as an upstream problem, never as a finding", () => {
    for (const failure of [
      "timeout",
      "rate_limited",
      "http_error",
      "network_error",
      "server_remark",
      "bad_response",
    ] as const) {
      const text = osm.describeOverpassFailure({ ok: false, failure });
      expect(text).toBeTruthy();
      // Nothing in the phrasing should read as a statement about the ground.
      expect(text).not.toMatch(/\bno\b.*(trail|water|feature)/i);
    }
  });
});

describe("finders report query outcome", () => {
  const env = { CONTACT: "test@example.com" } as Env;
  const bbox: osm.Bbox = [-121.4, 46.44, -121.26, 46.53];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const status = init.status ?? 200;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: init.ok ?? (status >= 200 && status < 300),
        status,
        statusText: "",
        headers: new Headers(),
        json: async () => body,
        text: async () => JSON.stringify(body),
      })),
    );
  }

  // The exact shape that produced the bug: HTTP 200, empty elements, remark.
  it("marks a timed-out query as failed even though it answered HTTP 200", async () => {
    stubFetch({
      version: 0.6,
      elements: [],
      remark: 'runtime error: Query timed out in "query" at line 1 after 25 seconds.',
    });
    const result = await osm.findTrails(env, bbox);
    expect(result.items).toEqual([]);
    expect(result.status.ok).toBe(false);
    expect(result.status.failure).toBe("timeout");
    expect(result.status.detail).toContain("timed out");
  });

  it("reports a genuinely empty successful query as ok", async () => {
    stubFetch({ version: 0.6, elements: [] });
    const result = await osm.findTrailheads(env, bbox);
    expect(result.items).toEqual([]);
    expect(result.status.ok).toBe(true);
    expect(result.status.failure).toBeUndefined();
  });

  it("treats a non-array elements field as a bad response", async () => {
    stubFetch({ version: 0.6 });
    const result = await osm.findWaterSources(env, bbox);
    expect(result.status.ok).toBe(false);
    expect(result.status.failure).toBe("bad_response");
  });
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
