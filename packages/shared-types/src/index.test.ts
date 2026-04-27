import { describe, it, expect } from "vitest";
import type { TimeWindow, Location, BookingStatus, IsoDate, IsoDateTime } from "./index.js";

describe("shared-types", () => {
  it("TimeWindow accepts ISO datetime strings with optional timezone", () => {
    const w: TimeWindow = {
      start: "2026-04-27T13:00:00Z",
      end: "2026-04-27T14:00:00Z",
      timezone: "America/Los_Angeles",
    };
    expect(w.start).toBe("2026-04-27T13:00:00Z");
  });

  it("Location allows null and missing fields", () => {
    const partial: Location = { city: "Seattle", region: "WA", address1: null };
    expect(partial.city).toBe("Seattle");
    expect(partial.address1).toBeNull();
    expect(partial.country).toBeUndefined();
  });

  it("BookingStatus is the documented union", () => {
    const states: BookingStatus[] = ["pending", "confirmed", "cancelled", "completed"];
    expect(states).toHaveLength(4);
  });

  it("IsoDate and IsoDateTime are string aliases", () => {
    const d: IsoDate = "2026-04-27";
    const dt: IsoDateTime = "2026-04-27T13:00:00Z";
    expect(typeof d).toBe("string");
    expect(typeof dt).toBe("string");
  });
});
