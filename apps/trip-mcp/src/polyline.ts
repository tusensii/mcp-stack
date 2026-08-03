/**
 * Polyline geometry helpers for elevation/weather profile tools:
 * haversine distance, cumulative mileage, and even-spacing resampling.
 * Pure functions — unit tested in polyline.test.ts.
 */

export interface PolyPoint {
  lat: number;
  lon: number;
}

export interface ProfilePoint extends PolyPoint {
  /** Cumulative trail miles from the first input point. */
  mile: number;
}

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_MILE = 1_609.344;

export function haversineM(a: PolyPoint, b: PolyPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Cumulative distance in meters at each vertex; [0] is always 0. */
export function cumulativeM(points: PolyPoint[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1]! + haversineM(points[i - 1]!, points[i]!));
  }
  return out;
}

export function metersToMiles(m: number): number {
  return m / METERS_PER_MILE;
}

export function metersToFeet(m: number): number {
  return m * 3.28084;
}

/**
 * Resample a polyline to at most `targetCount` evenly distance-spaced
 * points (linear interpolation between vertices, endpoints always kept).
 * Inputs already at or under the target are annotated with mileage but
 * otherwise returned as-is — upsampling would invent detail the mapped
 * line doesn't have.
 */
export function resamplePolyline(points: PolyPoint[], targetCount: number): ProfilePoint[] {
  if (points.length === 0) return [];
  const cum = cumulativeM(points);
  const total = cum[cum.length - 1]!;

  if (points.length <= targetCount || total === 0) {
    return points.map((p, i) => ({ lat: p.lat, lon: p.lon, mile: round3(metersToMiles(cum[i]!)) }));
  }

  const out: ProfilePoint[] = [];
  let seg = 0;
  for (let i = 0; i < targetCount; i++) {
    const target = (total * i) / (targetCount - 1);
    while (seg < points.length - 2 && cum[seg + 1]! < target) seg++;
    const segStart = cum[seg]!;
    const segLen = cum[seg + 1]! - segStart;
    const t = segLen > 0 ? (target - segStart) / segLen : 0;
    const a = points[seg]!;
    const b = points[seg + 1]!;
    out.push({
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      mile: round3(metersToMiles(target)),
    });
  }
  return out;
}

/** Result of chaining multiple polyline segments end-to-end. */
export interface ChainResult {
  points: PolyPoint[];
  /** Segments incorporated into the chain. */
  segments_used: number;
  /** Gap sizes (meters) that were straight-line bridged (> join tol, <= gap max). */
  bridged_gaps_m: number[];
  /** Matching segments that could not be connected to the chain. */
  leftover_segments: number;
  /** True when the chain stopped because it hit the length cap. */
  capped: boolean;
}

const JOIN_TOLERANCE_M = 30;
const GAP_BRIDGE_MAX_M = 50;
/** 30 miles — guard against runaway matches on long-distance routes. */
const CHAIN_MAX_LENGTH_M = 48_280;

function segLengthM(seg: PolyPoint[]): number {
  const cum = cumulativeM(seg);
  return cum[cum.length - 1] ?? 0;
}

/**
 * Chain polyline segments (OSM ways) end-to-end into one line. Long
 * trails are typically split across multiple OSM ways; a profile built
 * from a single way silently truncates.
 *
 * Deterministic: starts from the segment endpoint nearest `start` (the
 * trailhead hint), then greedily appends the unused segment whose
 * endpoint is closest to the running chain end — joined seamlessly
 * within `joinTolM`, or straight-line bridged (recorded per-gap) up to
 * `gapMaxM`. Stops when nothing is within `gapMaxM` or the length cap
 * is reached.
 */
export function chainSegments(
  segments: PolyPoint[][],
  start: PolyPoint,
  joinTolM = JOIN_TOLERANCE_M,
  gapMaxM = GAP_BRIDGE_MAX_M,
  maxTotalM = CHAIN_MAX_LENGTH_M,
): ChainResult {
  const usable = segments.filter((s) => s.length >= 2);
  if (usable.length === 0) {
    return { points: [], segments_used: 0, bridged_gaps_m: [], leftover_segments: 0, capped: false };
  }

  // Starting segment: endpoint nearest the hint, oriented away from it.
  let bestIdx = 0;
  let bestDist = Infinity;
  let bestReversed = false;
  usable.forEach((seg, i) => {
    const dFirst = haversineM(start, seg[0]!);
    const dLast = haversineM(start, seg[seg.length - 1]!);
    if (dFirst < bestDist) {
      bestDist = dFirst;
      bestIdx = i;
      bestReversed = false;
    }
    if (dLast < bestDist) {
      bestDist = dLast;
      bestIdx = i;
      bestReversed = true;
    }
  });

  const used = new Set<number>([bestIdx]);
  const first = usable[bestIdx]!;
  const chain: PolyPoint[] = bestReversed ? [...first].reverse() : [...first];
  let totalM = segLengthM(chain);
  const bridged: number[] = [];
  let capped = false;

  while (totalM < maxTotalM) {
    const end = chain[chain.length - 1]!;
    let nextIdx = -1;
    let nextDist = Infinity;
    let nextReversed = false;
    usable.forEach((seg, i) => {
      if (used.has(i)) return;
      const dFirst = haversineM(end, seg[0]!);
      const dLast = haversineM(end, seg[seg.length - 1]!);
      if (dFirst < nextDist) {
        nextDist = dFirst;
        nextIdx = i;
        nextReversed = false;
      }
      if (dLast < nextDist) {
        nextDist = dLast;
        nextIdx = i;
        nextReversed = true;
      }
    });
    if (nextIdx < 0 || nextDist > gapMaxM) break;

    used.add(nextIdx);
    const seg = usable[nextIdx]!;
    const oriented = nextReversed ? [...seg].reverse() : [...seg];
    if (nextDist > joinTolM) bridged.push(Math.round(nextDist));
    // Drop the duplicate join vertex when seamless.
    chain.push(...(nextDist <= joinTolM ? oriented.slice(1) : oriented));
    totalM += segLengthM(oriented) + nextDist;
    if (totalM >= maxTotalM) {
      capped = true;
      break;
    }
  }

  return {
    points: chain,
    segments_used: used.size,
    bridged_gaps_m: bridged,
    leftover_segments: usable.length - used.size,
    capped,
  };
}

/** Bounding box [minLon, minLat, maxLon, maxLat] around a point. */
export function bboxAroundPoint(
  lat: number,
  lon: number,
  radiusKm: number,
): [number, number, number, number] {
  const kmPerDegLat = 111.32;
  const dLat = radiusKm / kmPerDegLat;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = radiusKm / (kmPerDegLat * cosLat);
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
