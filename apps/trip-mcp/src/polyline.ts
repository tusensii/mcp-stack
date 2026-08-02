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
