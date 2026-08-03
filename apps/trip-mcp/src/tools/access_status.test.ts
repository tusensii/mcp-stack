import { describe, it, expect } from "vitest";
import { ACCESS_ROADS, NAMED_ORIGINS } from "../access_roads.js";
import { findRoadMention } from "../sources/usfs.js";
import { AREAS } from "../areas.js";

describe("ACCESS_ROADS registry (#85 acceptance)", () => {
  it("maps all 12 areas to at least one access road with a manager", () => {
    for (const area of AREAS) {
      const roads = ACCESS_ROADS[area.id];
      expect(roads, `missing access roads for ${area.id}`).toBeDefined();
      expect(roads!.length).toBeGreaterThan(0);
      for (const r of roads!) {
        expect(["wsdot", "nps", "usfs"]).toContain(r.manager);
        if (r.manager === "wsdot") expect(r.wsdot_pass_name).toBeTruthy();
        if (r.manager === "nps") expect(r.nps_park_code).toBeTruthy();
        if (r.manager === "usfs") expect(r.usfs_forest_slug).toBeTruthy();
      }
    }
  });

  it("includes the seattle default origin", () => {
    expect(NAMED_ORIGINS["seattle"]).toBeDefined();
  });
});

describe("findRoadMention", () => {
  const page =
    "Alerts and Notices. Suiattle River Road (FR 26) closed at milepost 12 due to washout damage. " +
    "Mountain Loop Highway seasonal gate at Deer Creek remains closed until further notice.";

  it("finds full and simplified road-name mentions with snippets", () => {
    expect(findRoadMention(page, "Suiattle River Rd (FR 26)")).toMatch(/washout/);
    expect(findRoadMention(page, "Mountain Loop Hwy")).toMatch(/seasonal gate/);
  });

  it("returns null when the road is not mentioned", () => {
    expect(findRoadMention(page, "Cascade River Rd")).toBeNull();
  });
});
