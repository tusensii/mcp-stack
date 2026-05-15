import { describe, it, expect } from "vitest";
import * as wfigs from "./wfigs.js";

describe("wfigs source", () => {
  it("module loads", () => {
    void wfigs.getActiveFirePerimeters;
    void wfigs.getActiveIncidents;
  });

  it("PNW_BBOX covers WA/OR/ID", () => {
    expect(wfigs.PNW_BBOX).toEqual([-125, 42, -116, 49.5]);
  });
});
