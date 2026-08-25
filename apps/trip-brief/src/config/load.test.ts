import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, stripJsonComments } from "./load.ts";
import { TripConfigSchema } from "./schema.ts";
import { TRIP_CONFIG_RAW } from "../test/fixtures.ts";

async function writeConfig(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "trip-brief-"));
  const path = join(dir, "config.json");
  await writeFile(path, contents, "utf8");
  return path;
}

describe("stripJsonComments", () => {
  it("removes line and block comments", () => {
    const input = `{
  // why 20: the group's stated ceiling
  "max_precip_pct": 20, /* inline */
  "note": "keep // this"
}`;
    expect(JSON.parse(stripJsonComments(input))).toEqual({
      max_precip_pct: 20,
      note: "keep // this",
    });
  });

  it("preserves line count so error positions stay usable", () => {
    const input = "{\n// a\n// b\n\"x\": 1\n}";
    expect(stripJsonComments(input).split("\n")).toHaveLength(5);
  });
});

describe("loadConfig", () => {
  it("loads a valid trip config", async () => {
    const path = await writeConfig(JSON.stringify(TRIP_CONFIG_RAW));
    const cfg = await loadConfig(path);
    expect(cfg.kind).toBe("trip");
    expect(cfg.slug).toBe("royal-basin-2026-08");
  });

  it("rejects an unknown kind", async () => {
    const path = await writeConfig('{"kind":"postcard"}');
    await expect(loadConfig(path)).rejects.toThrow(ConfigError);
  });

  it("reports every schema problem at once", async () => {
    const path = await writeConfig('{"kind":"trip","slug":"Bad Slug","title":""}');
    await expect(loadConfig(path)).rejects.toThrow(/slug|title/);
  });
});

// #104 — the schema is where a permitted trip without its confirmation stops.
describe("reservation requirement", () => {
  it("refuses a permitted trip with no reservation block", () => {
    const { reservation, ...withoutReservation } = TRIP_CONFIG_RAW;
    void reservation;
    const result = TripConfigSchema.safeParse(withoutReservation);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.join(".") === "reservation")).toBe(true);
    expect(result.error?.issues[0]?.message).toContain("source of truth");
  });

  it("allows an unpermitted trip with no reservation", () => {
    const { reservation, ...rest } = TRIP_CONFIG_RAW;
    void reservation;
    const result = TripConfigSchema.safeParse({
      ...rest,
      permit: { required: false, mechanism: "none" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects reserved nights outside the trip dates", () => {
    const result = TripConfigSchema.safeParse({
      ...TRIP_CONFIG_RAW,
      reservation: { ...TRIP_CONFIG_RAW.reservation, nights: ["2026-08-21", "2026-09-04"] },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("2026-09-04");
  });

  it("rejects a reversed date range", () => {
    const result = TripConfigSchema.safeParse({
      ...TRIP_CONFIG_RAW,
      dates: { start: "2026-08-23", end: "2026-08-21" },
    });
    expect(result.success).toBe(false);
  });
});
