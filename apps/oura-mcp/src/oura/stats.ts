/**
 * Statistics helpers shared across the Oura analytics tools.
 *
 * Kept narrow: only the math the tools actually need (mean, median,
 * stddev, z-score, Pearson correlation, linear-fit slope, normal-CDF
 * percentile). Promoted to a workspace package only when a third
 * consumer with non-trivial overlap appears — for now this lives in
 * `apps/oura-mcp/`.
 */

/** Filter helper: drop nulls/undefined and NaNs from a number array. */
export function defined(xs: ReadonlyArray<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const x of xs) {
    if (x !== null && x !== undefined && Number.isFinite(x)) out.push(x);
  }
  return out;
}

export function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return NaN;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

export function median(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Sample stddev (Bessel's correction: n-1). Returns 0 when n < 2. */
export function stddev(xs: ReadonlyArray<number>, mu?: number): number {
  if (xs.length < 2) return 0;
  const m = mu ?? mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return Math.sqrt(s / (xs.length - 1));
}

export function zScore(value: number, mu: number, sigma: number): number {
  if (sigma === 0 || !Number.isFinite(sigma)) return 0;
  return (value - mu) / sigma;
}

/**
 * Categorize a z-score for human consumption.
 * Thresholds match the spec: |z|>1.5 = well_*, 0.5<|z|<1.5 = above/below,
 * |z|<0.5 = near.
 */
export function interpretZ(z: number): "well_above" | "above" | "near" | "below" | "well_below" {
  if (z > 1.5) return "well_above";
  if (z > 0.5) return "above";
  if (z < -1.5) return "well_below";
  if (z < -0.5) return "below";
  return "near";
}

/**
 * Approximate normal CDF percentile (0-100) from a z-score using the
 * Abramowitz-Stegun rational approximation. Good to ~4 decimals,
 * adequate for the "where does today fall" framing in baseline_compare.
 */
export function percentileFromZ(z: number): number {
  return Math.round(normalCdf(z) * 1000) / 10;
}

function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Pearson correlation between two equally-sized arrays. Returns 0 when
 * either array is empty, lengths mismatch, or either has zero variance.
 */
export function pearson(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return 0;
  return num / denom;
}

export function interpretPearson(
  r: number,
):
  | "strong_positive"
  | "moderate_positive"
  | "weak_positive"
  | "none"
  | "weak_negative"
  | "moderate_negative"
  | "strong_negative" {
  const abs = Math.abs(r);
  const sign = r >= 0 ? "positive" : "negative";
  if (abs >= 0.6) return `strong_${sign}` as "strong_positive" | "strong_negative";
  if (abs >= 0.3) return `moderate_${sign}` as "moderate_positive" | "moderate_negative";
  if (abs >= 0.1) return `weak_${sign}` as "weak_positive" | "weak_negative";
  return "none";
}

/**
 * Linear-fit slope (least squares) over a uniformly-spaced series.
 * Treats the index as x; returns slope in units of value per index step.
 * Used for trend direction in recovery_forecast and weekly_digest.
 */
export function linearSlope(values: ReadonlyArray<number>): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(i);
  const mx = (n - 1) / 2;
  const my = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    num += dx * ((values[i] as number) - my);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

/** Categorize a slope as improving/stable/declining; threshold is in units/day. */
export function interpretSlope(
  slope: number,
  stableBand = 0.1,
): "improving" | "stable" | "declining" {
  if (slope > stableBand) return "improving";
  if (slope < -stableBand) return "declining";
  return "stable";
}
