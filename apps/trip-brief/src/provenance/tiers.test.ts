import { describe, expect, it } from "vitest";
import {
  ProvenanceError,
  SourceLedger,
  assertSpecificClaim,
  disposition,
  fact,
  factFromPayload,
  hedgePrefix,
  weakestTier,
} from "./tiers.ts";
import { ProvenancePolicySchema } from "../config/schema.ts";

const DEFAULT_POLICY = ProvenancePolicySchema.parse(undefined);

describe("assertSpecificClaim", () => {
  // The exact failure: a rec.gov catalog id rendered as the party's permit.
  it("refuses a lookup-tier value as a specific claim", () => {
    const permitId = fact("4098362", { tier: "lookup-inference" });
    expect(() => assertSpecificClaim(permitId, DEFAULT_POLICY, "permit number")).toThrow(
      ProvenanceError,
    );
  });

  it("names the fact and points at the reservation block", () => {
    const permitId = fact("4098362", { tier: "lookup-inference" });
    try {
      assertSpecificClaim(permitId, DEFAULT_POLICY, "permit number");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("permit number");
      expect((err as Error).message).toContain("4098362");
      expect((err as Error).message).toContain("reservation");
    }
  });

  it("allows it once the config takes the risk deliberately", () => {
    const policy = ProvenancePolicySchema.parse({ allow_lookup_facts: true });
    const permitId = fact("4098362", { tier: "lookup-inference" });
    expect(() => assertSpecificClaim(permitId, policy, "permit number")).not.toThrow();
  });

  it("never blocks stronger tiers", () => {
    for (const tier of ["live-instrument", "official-static", "community"] as const) {
      expect(() =>
        assertSpecificClaim(fact(1, { tier }), DEFAULT_POLICY, "x"),
      ).not.toThrow();
    }
  });
});

describe("disposition", () => {
  it("hedges low-confidence facts by default rather than promoting them", () => {
    const f = fact("something", { tier: "live-instrument", confidence: "low" });
    expect(disposition(f, DEFAULT_POLICY)).toBe("hedge");
  });

  it("excludes low-confidence facts when the policy says to", () => {
    const policy = ProvenancePolicySchema.parse({ low_confidence: "exclude" });
    const f = fact("something", { tier: "official-static", confidence: "low" });
    expect(disposition(f, policy)).toBe("exclude");
  });

  it("always hedges lookup-tier facts", () => {
    expect(disposition(fact("x", { tier: "lookup-inference" }), DEFAULT_POLICY)).toBe("hedge");
  });

  it("renders high-confidence instrument data plainly", () => {
    expect(disposition(fact(42, { tier: "live-instrument" }), DEFAULT_POLICY)).toBe("render");
  });
});

describe("hedgePrefix", () => {
  it("makes the reason for hedging visible", () => {
    expect(hedgePrefix(fact("x", { tier: "lookup-inference" }))).toBe("Unverified lookup:");
    expect(hedgePrefix(fact("x", { tier: "community" }))).toBe("Reported by hikers:");
    expect(hedgePrefix(fact("x", { tier: "live-instrument", confidence: "low" }))).toBe(
      "Low confidence:",
    );
    expect(hedgePrefix(fact("x", { tier: "live-instrument" }))).toBe("");
  });
});

describe("weakestTier", () => {
  it("takes the worst input tier", () => {
    expect(weakestTier("live-instrument", "community")).toBe("community");
    expect(weakestTier("official-static", "lookup-inference")).toBe("lookup-inference");
    expect(weakestTier("live-instrument", "live-instrument")).toBe("live-instrument");
  });
});

describe("factFromPayload", () => {
  it("inherits confidence and the first source", () => {
    const f = factFromPayload(
      {
        data: { discharge_cfs: 128 },
        sources: [{ url: "https://waterdata.usgs.gov/x", name: "USGS", fetched_at: "now" }],
        confidence: "medium",
        caveats: [],
      },
      "live-instrument",
      (d) => d.discharge_cfs,
    );
    expect(f?.value).toBe(128);
    expect(f?.confidence).toBe("medium");
    expect(f?.source?.name).toBe("USGS");
  });

  it("returns null for an empty payload", () => {
    expect(
      factFromPayload({ data: null, sources: [], confidence: "low", caveats: [] }, "community", () => 1),
    ).toBeNull();
  });
});

describe("SourceLedger", () => {
  it("deduplicates by URL, keeping the strongest tier", () => {
    const ledger = new SourceLedger();
    const source = { url: "https://example.org/a", name: "A", fetched_at: "t" };
    ledger.add(source, "community");
    ledger.add(source, "live-instrument");
    const entries = ledger.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.tier).toBe("live-instrument");
  });

  it("orders strongest tier first, then by name — stable across runs", () => {
    const ledger = new SourceLedger();
    ledger.add({ url: "https://z.example/1", name: "Zebra", fetched_at: "t" }, "community");
    ledger.add({ url: "https://a.example/1", name: "Alpha", fetched_at: "t" }, "community");
    ledger.add({ url: "https://n.example/1", name: "NWS", fetched_at: "t" }, "live-instrument");
    expect(ledger.entries().map((e) => e.source.name)).toEqual(["NWS", "Alpha", "Zebra"]);
  });

  it("ignores sources with no URL", () => {
    const ledger = new SourceLedger();
    ledger.add(undefined, "community");
    expect(ledger.entries()).toEqual([]);
  });
});
