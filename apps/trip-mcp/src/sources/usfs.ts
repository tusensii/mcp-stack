/**
 * USFS forest alerts/notices page scrape (issue #85 road-status slice).
 * fs.usda.gov has no API for road conditions; the alerts-notices page
 * per forest is the closest scrapeable surface. Standard scrape rules:
 * ≤24h cache, attribution, degrade to null on any failure.
 *
 * The extraction is deliberately modest: we report whether a road is
 * MENTIONED in current alerts (with a snippet), not a parsed
 * open/closed state — absence of a mention is NOT confirmation a road
 * is open, and callers must say so.
 */

import type { Env } from "../types.js";
import { TTL, cached } from "../cache.js";

const MIN_INTERVAL_MS = 1100;
let lastFetchAt = 0;

export function forestAlertsUrl(slug: string): string {
  return `https://www.fs.usda.gov/alerts/${slug}/alerts-notices`;
}

async function throttledFetch(env: Env, url: string): Promise<Response> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  return fetch(url, {
    headers: {
      "User-Agent": `pnw-trip-mcp/0.1 (research aggregator; ${env.CONTACT})`,
      Accept: "text/html,*/*;q=0.5",
    },
  });
}

/** Fetch + flatten a forest's alerts page to plain text (24h cache). */
export async function getForestAlertsText(env: Env, slug: string): Promise<string | null> {
  const key = `usfs:alerts:${slug}`;
  return cached(env, key, TTL.WTA_LIST, async () => {
    try {
      const res = await throttledFetch(env, forestAlertsUrl(slug));
      if (!res.ok) return null;
      const html = await res.text();
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&amp;|&#\d+;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      return null;
    }
  });
}

/**
 * Case-insensitive road-name mention lookup in flattened alerts text.
 * Tries the full name, then a simplified form ("Suiattle River Rd
 * (FR 26)" → "Suiattle"), returning a snippet around the first hit.
 */
export function findRoadMention(text: string, roadName: string): string | null {
  const t = text.toLowerCase();
  const noParens = roadName.replace(/\s*\([^)]*\)/g, "").trim();
  const candidates = [
    roadName,
    noParens,
    // "Suiattle River Rd" and "Suiattle River Road" must both match —
    // drop the road-type suffix entirely and search the base name.
    noParens.replace(/\s+(?:rd|road|hwy|highway|dr|drive)\.?$/i, ""),
    roadName.split(/[(/]| FR | fr /)[0] ?? roadName,
  ]
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length >= 5);
  for (const c of candidates) {
    const idx = t.indexOf(c);
    if (idx >= 0) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(text.length, idx + c.length + 220);
      return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
    }
  }
  return null;
}
