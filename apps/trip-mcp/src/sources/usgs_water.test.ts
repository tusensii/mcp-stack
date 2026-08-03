import { describe, it, expect } from "vitest";
import { flowContext } from "./usgs_water.js";

const stat = { p25: 100, p50: 200, p75: 400, p90: 800, mean: 300 };

describe("flowContext", () => {
  it("bands current discharge against the day's percentiles", () => {
    expect(flowContext(50, stat).context).toBe("low");
    expect(flowContext(250, stat).context).toBe("normal");
    expect(flowContext(500, stat).context).toBe("elevated");
    expect(flowContext(900, stat).context).toBe("high");
  });

  it("returns unknown without a reading or stats", () => {
    expect(flowContext(null, stat).context).toBe("unknown");
    expect(flowContext(250, undefined).context).toBe("unknown");
    expect(flowContext(250, { ...stat, p25: null }).context).toBe("unknown");
  });
});
