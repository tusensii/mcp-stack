import { describe, it, expect } from "vitest";
import * as wsdot from "./wsdot.js";

describe("wsdot source", () => {
  it("module loads", () => {
    void wsdot.getMountainPassConditions;
    void wsdot.findPassByName;
  });

  it("findPassByName does case-insensitive contains match", () => {
    const passes = [
      {
        MountainPassId: 1,
        MountainPassName: "Snoqualmie Pass",
        TravelAdvisoryActive: false,
        RoadCondition: "",
        TemperatureInFahrenheit: null,
        ElevationInFeet: 3022,
        WeatherCondition: "",
        RestrictionOne: null,
        RestrictionTwo: null,
        DateUpdated: "",
      },
    ];
    expect(wsdot.findPassByName(passes, "snoqualmie")?.MountainPassId).toBe(1);
    expect(wsdot.findPassByName(passes, "SNOQUALMIE PASS")?.MountainPassId).toBe(1);
    expect(wsdot.findPassByName(passes, "stevens")).toBeUndefined();
  });
});
