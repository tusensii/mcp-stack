import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRouteInfo, isImplausiblyEmpty } from "./route_info.js";
import { nearestArea } from "../areas.js";
import type { Env } from "../types.js";

/**
 * #93 — the two queries from the bug report, both centered on the Goat Rocks
 * SE corner, both of which returned zero trails and zero trailheads for an
 * area containing South Fork Tieton Trail #1120 and Conrad Meadows Trailhead.
 */
const REPORTED_QUERIES = [
  { lat: 46.47, lon: -121.33, radius_km: 6 },
  { lat: 46.49, lon: -121.29, radius_km: 10 },
];

describe("nearestArea", () => {
  it("places the reported query points in Goat Rocks", () => {
    for (const q of REPORTED_QUERIES) {
      const near = nearestArea(q.lat, q.lon);
      expect(near?.area.id).toBe("goat_rocks");
      expect(near!.distance_km).toBeLessThan(30);
    }
  });

  it("returns the closest area, not just any area", () => {
    // Paradise, Mount Rainier.
    expect(nearestArea(46.786, -121.735)?.area.id).toBe("mt_rainier");
    // Colchuck Lake, Enchantments.
    expect(nearestArea(47.4733, -120.7867)?.area.id).toBe("enchantments");
  });

  it("still answers for a point far from everything, with the distance to prove it", () => {
    const near = nearestArea(40.0, -100.0); // Nebraska
    expect(near).toBeDefined();
    expect(near!.distance_km).toBeGreaterThan(1000);
  });
});

describe("isImplausiblyEmpty", () => {
  it("flags the exact case from the bug report", () => {
    for (const q of REPORTED_QUERIES) {
      expect(
        isImplausiblyEmpty({ trailCount: 0, trailheadCount: 0, ...q }),
      ).toBe(true);
    }
  });

  it("does not flag a result that found anything at all", () => {
    const q = REPORTED_QUERIES[1]!;
    expect(isImplausiblyEmpty({ trailCount: 1, trailheadCount: 0, ...q })).toBe(false);
    expect(isImplausiblyEmpty({ trailCount: 0, trailheadCount: 1, ...q })).toBe(false);
  });

  // A tight radius over a rock face legitimately has nothing in it.
  it("does not flag a small-radius search", () => {
    expect(
      isImplausiblyEmpty({
        trailCount: 0,
        trailheadCount: 0,
        radius_km: 2,
        lat: 46.47,
        lon: -121.33,
      }),
    ).toBe(false);
  });

  // Emptiness far from any registered area is a plausible answer, and the
  // heuristic must not cry wolf there.
  it("does not flag emptiness outside any known area", () => {
    expect(
      isImplausiblyEmpty({
        trailCount: 0,
        trailheadCount: 0,
        radius_km: 10,
        lat: 40.0,
        lon: -100.0,
      }),
    ).toBe(false);
  });

  it("uses the radius threshold inclusively", () => {
    const base = { trailCount: 0, trailheadCount: 0, lat: 46.47, lon: -121.33 };
    expect(isImplausiblyEmpty({ ...base, radius_km: 4.9 })).toBe(false);
    expect(isImplausiblyEmpty({ ...base, radius_km: 5 })).toBe(true);
  });
});

describe("buildRouteInfo", () => {
  const env = { CONTACT: "test@example.com" } as Env;
  const query = { ...REPORTED_QUERIES[1]!, radius_km: 10 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Every Overpass call answers with `body`; USGS elevation is not stubbed. */
  function stubOverpass(body: unknown, status = 200) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const overpass = String(url).includes("overpass");
        return {
          ok: overpass ? status >= 200 && status < 300 : false,
          status: overpass ? status : 500,
          statusText: "",
          headers: new Headers(),
          json: async () => (overpass ? body : {}),
          text: async () => "",
        };
      }),
    );
  }

  const TIMEOUT_BODY = {
    version: 0.6,
    elements: [],
    remark: 'runtime error: Query timed out in "query" at line 1 after 25 seconds.',
  };

  // The reported failure, end to end.
  it("does not report a timed-out water query as a count of zero", async () => {
    stubOverpass(TIMEOUT_BODY);
    const payload = await buildRouteInfo(env, query);

    expect(payload.data?.water_summary).not.toMatch(/^0 springs/);
    expect(payload.data?.water_summary).toContain("Water data unavailable");
    expect(payload.data?.water_summary).toContain("not a finding of zero water");
  });

  it("marks each failed source and drops confidence to low", async () => {
    stubOverpass(TIMEOUT_BODY);
    const payload = await buildRouteInfo(env, query);
    const status = payload.data!.source_status;

    expect(status.osm_trails).toMatchObject({ ok: false, failure: "timeout" });
    expect(status.osm_trailheads).toMatchObject({ ok: false, failure: "timeout" });
    expect(status.osm_water).toMatchObject({ ok: false, failure: "timeout" });
    expect(payload.confidence).toBe("low");
  });

  it("caveats the failure as upstream, explicitly not as an absence", async () => {
    stubOverpass(TIMEOUT_BODY);
    const payload = await buildRouteInfo(env, query);
    const text = payload.caveats.join("\n");

    expect(text).toContain("UPSTREAM DATA UNAVAILABLE — OSM trails");
    expect(text).toContain("UPSTREAM DATA UNAVAILABLE — OSM water sources");
    expect(text).toContain("NOT an absence of mapped features here");
  });

  // A failure already explains the emptiness; adding the heuristic caveat on
  // top would just be noise.
  it("does not also flag implausibility when the query already failed", async () => {
    stubOverpass(TIMEOUT_BODY);
    const payload = await buildRouteInfo(env, query);
    expect(payload.data?.source_status.implausibly_empty).toBe(false);
    expect(payload.caveats.join("\n")).not.toContain("IMPLAUSIBLE EMPTY RESULT");
  });

  it("flags a successful but unbelievable empty result", async () => {
    stubOverpass({ version: 0.6, elements: [] });
    const payload = await buildRouteInfo(env, query);

    expect(payload.data?.source_status.osm_trails.ok).toBe(true);
    expect(payload.data?.source_status.implausibly_empty).toBe(true);
    expect(payload.confidence).toBe("low");
    expect(payload.caveats.join("\n")).toContain("IMPLAUSIBLE EMPTY RESULT");
    expect(payload.caveats.join("\n")).toContain("Goat Rocks");
  });

  it("leaves a plausible empty result unflagged and medium-confidence", async () => {
    stubOverpass({ version: 0.6, elements: [] });
    // Nebraska: nowhere near a registered area, so empty is a fine answer.
    const payload = await buildRouteInfo(env, { lat: 40, lon: -100, radius_km: 10 });

    expect(payload.data?.source_status.implausibly_empty).toBe(false);
    expect(payload.confidence).toBe("medium");
    expect(payload.caveats.join("\n")).not.toContain("IMPLAUSIBLE");
    expect(payload.data?.water_summary).toMatch(/^0 springs/);
  });

  it("rejects an unknown area_id before doing any work", async () => {
    const payload = await buildRouteInfo(env, { area_id: "narnia", radius_km: 5 });
    expect(payload.data).toBeNull();
    expect(payload.caveats[0]).toContain("Unknown area_id");
  });
});
