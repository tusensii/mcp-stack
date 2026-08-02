import { describe, it, expect } from "vitest";
import * as wsdot from "./wsdot.js";
import type { Env } from "../types.js";

describe("wsdot source", () => {
  it("module loads", () => {
    void wsdot.getMountainPassConditions;
    void wsdot.findPassByName;
  });

  it("names the missing WSDOT_API_KEY secret instead of a bare 401", async () => {
    const env = { WSDOT_API_KEY: "", CONTACT: "test@example.com" } as Env;
    await expect(wsdot.getMountainPassConditions(env)).rejects.toThrow(
      /missing WSDOT_API_KEY secret/,
    );
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
