import { describe, it, expect, vi } from "vitest";
import { getSleepPeriodsByDay } from "./endpoints.js";
import type { OuraClient } from "./client.js";
import type { SleepPeriod } from "./types.js";

const period = (day: string, bedtime_start: string): SleepPeriod =>
  ({ id: day, day, type: "long_sleep", bedtime_start, bedtime_end: `${day}T07:30:00-07:00` }) as unknown as SleepPeriod;

describe("getSleepPeriodsByDay (issue #113)", () => {
  it("pads the upstream window by one day each side and filters back to the requested days", async () => {
    const paginate = vi.fn().mockResolvedValue([
      period("2026-08-25", "2026-08-24T23:40:00-07:00"), // padding leak — must be dropped
      period("2026-08-26", "2026-08-25T23:34:00-07:00"),
      period("2026-08-29", "2026-08-29T00:07:00-07:00"), // latest night, day == end_date
      period("2026-08-30", "2026-08-29T23:50:00-07:00"), // padding leak — must be dropped
    ]);
    const client = { paginate } as unknown as OuraClient;

    const out = await getSleepPeriodsByDay(client, { start_date: "2026-08-26", end_date: "2026-08-29" });

    expect(paginate).toHaveBeenCalledWith(
      "/sleep",
      { start_date: "2026-08-25", end_date: "2026-08-30" },
      undefined,
    );
    expect(out.map((p) => p.day)).toEqual(["2026-08-26", "2026-08-29"]);
  });

  it("pads across a month boundary", async () => {
    const paginate = vi.fn().mockResolvedValue([]);
    const client = { paginate } as unknown as OuraClient;
    await getSleepPeriodsByDay(client, { start_date: "2026-09-01", end_date: "2026-09-30" });
    expect(paginate.mock.calls[0]?.[1]).toEqual({ start_date: "2026-08-31", end_date: "2026-10-01" });
  });
});
