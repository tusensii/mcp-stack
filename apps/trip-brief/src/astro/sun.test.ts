import { describe, expect, it } from "vitest";
import { sunTimes, terrainSunset } from "./sun.ts";
import { formatTime } from "../util/datetime.ts";

const ROYAL_BASIN = { lat: 47.8235, lon: -123.1085 };
const TZ = "America/Los_Angeles";

/** Minutes between two instants, for tolerance assertions. */
function minutesApart(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60_000;
}

describe("sunTimes", () => {
  it("puts late-August sunrise and sunset in the right hour at 47.8N", () => {
    const sun = sunTimes("2026-08-21", ROYAL_BASIN.lat, ROYAL_BASIN.lon);
    // The abridged algorithm is good to a couple of minutes; the tolerance
    // here is set to catch sign and epoch errors, not to certify seconds.
    expect(minutesApart(sun.sunrise!, new Date("2026-08-21T13:15:00Z"))).toBeLessThan(6);
    expect(minutesApart(sun.sunset!, new Date("2026-08-22T03:15:00Z"))).toBeLessThan(6);
  });

  it("centres sunrise and sunset on solar noon", () => {
    const sun = sunTimes("2026-08-21", ROYAL_BASIN.lat, ROYAL_BASIN.lon);
    const midpoint = (sun.sunrise!.getTime() + sun.sunset!.getTime()) / 2;
    expect(Math.abs(midpoint - sun.solar_noon.getTime()) / 60_000).toBeLessThan(1);
  });

  it("puts solar noon at the longitude's offset from UTC noon", () => {
    // 123.11°W is 8h12m of rotation west of Greenwich, so local apparent noon
    // lands a little after 20:12 UTC once the equation of time is applied.
    const sun = sunTimes("2026-08-21", ROYAL_BASIN.lat, ROYAL_BASIN.lon);
    expect(minutesApart(sun.solar_noon, new Date("2026-08-21T20:12:00Z"))).toBeLessThan(20);
  });

  it("matches published solstice daylight lengths for the latitude", () => {
    // Seattle (same latitude band) runs ~15h59m at the June solstice and
    // ~8h25m at the December solstice.
    const june = sunTimes("2026-06-21", ROYAL_BASIN.lat, ROYAL_BASIN.lon);
    const december = sunTimes("2026-12-21", ROYAL_BASIN.lat, ROYAL_BASIN.lon);
    expect(Math.abs(june.daylight_minutes! - 959)).toBeLessThan(10);
    expect(Math.abs(december.daylight_minutes! - 505)).toBeLessThan(10);
  });

  it("puts civil dusk after sunset", () => {
    const sun = sunTimes("2026-08-21", ROYAL_BASIN.lat, ROYAL_BASIN.lon);
    expect(sun.civil_dusk!.getTime()).toBeGreaterThan(sun.sunset!.getTime());
    // Civil twilight at this latitude in August runs roughly half an hour.
    expect(minutesApart(sun.civil_dusk!, sun.sunset!)).toBeGreaterThan(25);
    expect(minutesApart(sun.civil_dusk!, sun.sunset!)).toBeLessThan(45);
  });

  it("reports no sunrise above the Arctic Circle in midwinter", () => {
    const sun = sunTimes("2026-12-21", 78.2, 15.6); // Longyearbyen
    expect(sun.sunrise).toBeNull();
    expect(sun.sunset).toBeNull();
    expect(sun.daylight_minutes).toBeNull();
  });

  it("formats into the trip timezone deterministically", () => {
    const sun = sunTimes("2026-08-21", ROYAL_BASIN.lat, ROYAL_BASIN.lon);
    expect(formatTime(sun.sunrise, TZ)).toBe(formatTime(sun.sunrise, TZ));
    expect(formatTime(sun.sunrise, TZ)).toMatch(/^6:\d\d AM$/);
  });
});

describe("terrainSunset", () => {
  it("subtracts the configured shade minutes", () => {
    const sun = sunTimes("2026-08-21", ROYAL_BASIN.lat, ROYAL_BASIN.lon);
    const shaded = terrainSunset(sun.sunset, 60);
    expect(minutesApart(shaded!, sun.sunset!)).toBe(60);
  });

  it("is null when the trip does not configure terrain shade", () => {
    const sun = sunTimes("2026-08-21", ROYAL_BASIN.lat, ROYAL_BASIN.lon);
    expect(terrainSunset(sun.sunset, undefined)).toBeNull();
  });
});
