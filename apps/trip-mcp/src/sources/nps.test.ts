import { describe, it } from "vitest";
import * as nps from "./nps.js";

describe("nps source", () => {
  it("module loads", () => {
    void nps.getNpsAlerts;
    void nps.getNpsPark;
  });

  it.todo("getNpsAlerts joins parkCodes with commas");
  it.todo("getNpsPark returns first record or null");
});
