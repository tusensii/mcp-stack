import { describe, it } from "vitest";
import * as osm from "./osm.js";

describe("osm source", () => {
  it("module loads", () => {
    void osm.findTrails;
    void osm.findTrailheads;
    void osm.findWaterSources;
  });

  it.todo("findTrails returns simplified ways within bbox");
  it.todo("findTrailheads filters to amenity=parking + hiking=yes");
  it.todo("findWaterSources tags springs vs streams correctly");
  it.todo("self-throttle enforces ~1 req/sec");
});
