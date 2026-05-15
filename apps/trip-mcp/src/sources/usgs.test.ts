import { describe, it } from "vitest";
import * as usgs from "./usgs.js";

describe("usgs source", () => {
  it("module loads", () => {
    void usgs.getElevation;
    void usgs.getElevationProfile;
    void usgs.findNearbyStreams;
  });

  it.todo("getElevation parses EPQS v1 value field");
  it.todo("getElevation falls back to legacy Elevation_Query shape");
  it.todo("getElevationProfile caps at 50 points and computes gain/loss");
  it.todo("findNearbyStreams returns [] on upstream failure");
});
