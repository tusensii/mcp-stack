import { describe, it, expect } from "vitest";
import * as nps from "./nps.js";
import type { Env } from "../types.js";

describe("nps source", () => {
  it("module loads", () => {
    void nps.getNpsAlerts;
    void nps.getNpsPark;
  });

  it("names the missing NPS_API_KEY secret instead of a bare HTTP status", async () => {
    const env = { NPS_API_KEY: "", CONTACT: "test@example.com" } as Env;
    await expect(nps.getNpsAlerts(env, ["mora"])).rejects.toThrow(/missing NPS_API_KEY secret/);
  });

  it.todo("getNpsAlerts joins parkCodes with commas");
  it.todo("getNpsPark returns first record or null");
});
