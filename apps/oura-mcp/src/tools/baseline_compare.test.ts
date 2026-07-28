import { describe, it, expect } from "vitest";
import { isPossiblyStaleNight, STALE_THRESHOLD_HOURS } from "./baseline_compare.js";

describe("isPossiblyStaleNight (issue #46)", () => {
  it("is false when the night ended recently (well within the threshold)", () => {
    const bedtimeEnd = "2026-07-28T08:00:00Z";
    const now = new Date("2026-07-28T10:00:00Z"); // 2h later
    expect(isPossiblyStaleNight(bedtimeEnd, now)).toBe(false);
  });

  it("is true when the night ended more than the threshold before now", () => {
    const bedtimeEnd = "2026-07-27T06:50:00Z";
    // ~24h later, well past STALE_THRESHOLD_HOURS
    const now = new Date("2026-07-28T07:00:00Z");
    expect(isPossiblyStaleNight(bedtimeEnd, now)).toBe(true);
  });

  it("is false exactly at the threshold boundary (strictly greater-than)", () => {
    const bedtimeEnd = "2026-07-28T00:00:00Z";
    const now = new Date(Date.parse(bedtimeEnd) + STALE_THRESHOLD_HOURS * 3_600_000);
    expect(isPossiblyStaleNight(bedtimeEnd, now)).toBe(false);
  });

  it("is true just past the threshold boundary", () => {
    const bedtimeEnd = "2026-07-28T00:00:00Z";
    const now = new Date(Date.parse(bedtimeEnd) + STALE_THRESHOLD_HOURS * 3_600_000 + 60_000);
    expect(isPossiblyStaleNight(bedtimeEnd, now)).toBe(true);
  });

  it("returns false for an unparseable bedtime_end rather than throwing", () => {
    expect(isPossiblyStaleNight("not-a-date", new Date())).toBe(false);
  });

  it("reproduces the #46 scenario: a matched night older than intended is flagged", () => {
    // From the issue: bedtime 2026-07-26 22:41 -> 2026-07-27 06:50, queried
    // at ~7am on 2026-07-28 (query time), expecting the night of 07-27->07-28.
    const bedtimeEnd = "2026-07-27T06:50:00-07:00";
    const queryTime = new Date("2026-07-28T07:00:00-07:00");
    expect(isPossiblyStaleNight(bedtimeEnd, queryTime)).toBe(true);
  });
});
