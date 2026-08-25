/**
 * Provenance tiering (#105).
 *
 * The permit-ID failure was a sourcing failure: a catalog lookup with a null
 * name rendered with the same visual authority as an NWS observation. Every
 * value that reaches the report is wrapped in a `Fact` carrying the tier it
 * came from, and the build refuses to print a `lookup-inference` fact as a
 * specific claim unless the config explicitly allows it.
 */

import type { Confidence, Source, ToolPayload } from "../mcp/client.ts";
import type { ProvenancePolicy, ProvenanceTier } from "../config/schema.ts";

export interface Fact<T> {
  value: T;
  tier: ProvenanceTier;
  confidence: Confidence;
  /** The source the value is cited to, when there is exactly one. */
  source?: Source;
  /** Free-text note rendered alongside a hedged fact. */
  note?: string;
}

export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceError";
  }
}

export const TIER_LABEL: Record<ProvenanceTier, string> = {
  "live-instrument": "Live instrument / issued forecast",
  "official-static": "Official published",
  community: "Community report",
  "lookup-inference": "Catalog lookup / inference",
};

/** Rank used to decide which tier wins when facts are merged. */
const TIER_RANK: Record<ProvenanceTier, number> = {
  "live-instrument": 3,
  "official-static": 2,
  community: 1,
  "lookup-inference": 0,
};

export function fact<T>(
  value: T,
  opts: {
    tier: ProvenanceTier;
    confidence?: Confidence;
    source?: Source;
    note?: string;
  },
): Fact<T> {
  return {
    value,
    tier: opts.tier,
    confidence: opts.confidence ?? "high",
    ...(opts.source ? { source: opts.source } : {}),
    ...(opts.note ? { note: opts.note } : {}),
  };
}

/** Build a fact from a trip-mcp payload, inheriting its confidence and first source. */
export function factFromPayload<T, V>(
  payload: ToolPayload<T>,
  tier: ProvenanceTier,
  select: (data: T) => V,
): Fact<V> | null {
  if (payload.data == null) return null;
  const value = select(payload.data);
  if (value == null) return null;
  return {
    value,
    tier,
    confidence: payload.confidence,
    ...(payload.sources[0] ? { source: payload.sources[0] } : {}),
  };
}

/** The weaker of two tiers — a derived fact is only as good as its worst input. */
export function weakestTier(...tiers: ProvenanceTier[]): ProvenanceTier {
  return tiers.reduce((worst, t) => (TIER_RANK[t] < TIER_RANK[worst] ? t : worst));
}

export type Disposition = "render" | "hedge" | "exclude";

/**
 * How a fact should be treated given the policy.
 *
 * Low-confidence results are never silently promoted: they either carry
 * visible hedging or they are dropped, per `provenance.low_confidence`.
 */
export function disposition(f: Fact<unknown>, policy: ProvenancePolicy): Disposition {
  if (f.confidence === "low") {
    return policy.low_confidence === "exclude" ? "exclude" : "hedge";
  }
  if (f.tier === "lookup-inference") return "hedge";
  if (f.tier === "community" && f.confidence === "medium") return "hedge";
  return "render";
}

/**
 * Gate for a *specific claim* — a permit number, a site count, a quota, any
 * value a reader would act on as fact. Lookup-tier values fail here unless
 * `allow_lookup_facts` is set.
 *
 * Narrative and clearly-attributed text does not go through this gate; use
 * `disposition` for that.
 */
export function assertSpecificClaim(
  f: Fact<unknown>,
  policy: ProvenancePolicy,
  label: string,
): void {
  if (f.tier !== "lookup-inference") return;
  if (policy.allow_lookup_facts) return;
  throw new ProvenanceError(
    `Refusing to render "${label}" as a specific claim: the value ` +
      `(${JSON.stringify(f.value)}) is lookup-inference tier — catalog metadata ` +
      `or inference, not a fact published for this trip. Either supply it from a ` +
      `source of truth (for reservation facts, the confirmation — see the ` +
      `\`reservation\` config block), or set ` +
      `\`provenance.allow_lookup_facts: true\` to accept the risk deliberately.`,
  );
}

/** Prefix applied to hedged prose so the hedging is visible, not implied. */
export function hedgePrefix(f: Fact<unknown>): string {
  if (f.confidence === "low") return "Low confidence:";
  if (f.tier === "lookup-inference") return "Unverified lookup:";
  if (f.tier === "community") return "Reported by hikers:";
  return "";
}

/**
 * Collects every cited source for the single end-of-report citations section
 * (#103: citations and methodology in one optional end section, never inline
 * mini-headers).
 */
export class SourceLedger {
  readonly #byUrl = new Map<string, { source: Source; tier: ProvenanceTier }>();

  add(source: Source | undefined, tier: ProvenanceTier): void {
    if (!source?.url) return;
    const existing = this.#byUrl.get(source.url);
    if (existing && TIER_RANK[existing.tier] >= TIER_RANK[tier]) return;
    this.#byUrl.set(source.url, { source, tier });
  }

  addPayload(payload: ToolPayload<unknown>, tier: ProvenanceTier): void {
    for (const source of payload.sources) this.add(source, tier);
  }

  addFact(f: Fact<unknown> | null | undefined): void {
    if (f?.source) this.add(f.source, f.tier);
  }

  /** Stable ordering: strongest tier first, then by name, so output is deterministic. */
  entries(): Array<{ source: Source; tier: ProvenanceTier }> {
    return [...this.#byUrl.values()].sort((a, b) => {
      const rank = TIER_RANK[b.tier] - TIER_RANK[a.tier];
      if (rank !== 0) return rank;
      const name = a.source.name.localeCompare(b.source.name);
      if (name !== 0) return name;
      return a.source.url.localeCompare(b.source.url);
    });
  }

  urls(): string[] {
    return this.entries().map((e) => e.source.url);
  }
}
