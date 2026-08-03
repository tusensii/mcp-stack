import { describe, it, expect } from "vitest";
import { extractConditions, rollupConditions } from "./extraction.js";

describe("extractConditions", () => {
  it("extracts snow with a parsed snow line", () => {
    const c = extractConditions(
      "Trail in great shape. Hit continuous snow at 5,200 ft below the pass; microspikes helpful.",
    );
    expect(c.snow.mentioned).toBe(true);
    expect(c.snow.snow_line_ft).toBe(5200);
    expect(c.snow.detail).toContain("5,200");
  });

  it("extracts blowdowns, road status, water, and crowding", () => {
    const c = extractConditions(
      "Several blowdowns in the first mile. Road washed out at FR 49 — high clearance advised. " +
        "Creeks are flowing well. Parking lot full by 8am.",
    );
    expect(c.blowdowns.mentioned).toBe(true);
    expect(c.road_status.mentioned).toBe(true);
    expect(c.water.mentioned).toBe(true);
    expect(c.crowding.mentioned).toBe(true);
  });

  it("grades bug severity from surrounding language", () => {
    expect(extractConditions("Mosquitoes were relentless at the lake.").bugs.severity).toBe("high");
    expect(extractConditions("A few bugs but not bad at all.").bugs.severity).toBe("low");
    expect(extractConditions("Some mosquitoes near camp.").bugs.severity).toBe("moderate");
  });

  it("never fabricates: silent text yields unmentioned fields with null detail", () => {
    const c = extractConditions("Lovely wildflowers and clear views the whole way.");
    expect(c.snow).toEqual({ mentioned: false, detail: null, snow_line_ft: null });
    expect(c.blowdowns).toEqual({ mentioned: false, detail: null });
    expect(c.bugs.severity).toBeNull();
  });
});

describe("rollupConditions", () => {
  it("counts mentions with per-claim report attribution", () => {
    const mk = (url: string, text: string) => ({
      url,
      title: null,
      date_hiked: null,
      conditions: extractConditions(text),
    });
    const roll = rollupConditions([
      mk("u1", "Snow at 5,500 ft. Mosquitoes thick."),
      mk("u2", "Snow free below the basin... wait, snowfields above 5,600 ft remain."),
      mk("u3", "Dry trail, no conditions to report."),
    ]);
    expect(roll.snow.mention_count).toBe(2);
    expect(roll.snow.total_reports).toBe(3);
    expect(roll.snow.report_urls).toEqual(["u1", "u2"]);
    expect(roll.snow.snow_lines_ft).toContain(5500);
    expect(roll.summary.some((s) => s.includes("2 of 3"))).toBe(true);
  });
});
