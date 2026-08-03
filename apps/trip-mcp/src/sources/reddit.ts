/**
 * Reddit trip-report search (r/WashingtonHikers, r/PNWhiking) via the
 * public listing JSON (issue #81 Part B).
 *
 * Honesty note (probed 2026-08-02): Reddit aggressively blocks
 * unauthenticated JSON from datacenter IP ranges (403 with an HTML
 * challenge), which very likely includes Cloudflare Workers egress. This
 * client sets a proper User-Agent, detects the block, and degrades to []
 * so the trip-report flow caveats it as a named failure. If the
 * degradation proves permanent in production, the fix is a Reddit OAuth
 * app (client-credentials) — the interface here won't need to change.
 */

import type { Env } from "../types.js";
import { TTL, cached } from "../cache.js";

const SUBREDDITS = ["WashingtonHikers", "PNWhiking"];
const MIN_INTERVAL_MS = 1100;

let lastFetchAt = 0;

async function throttled(env: Env, url: string): Promise<Response> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  return fetch(url, {
    headers: {
      "User-Agent": `pnw-trip-mcp/0.1 (research aggregator; ${env.CONTACT})`,
      Accept: "application/json",
    },
  });
}

export interface RedditReport {
  title: string;
  url: string;
  author: string | null;
  subreddit: string;
  date_posted: string | null; // ISO YYYY-MM-DD
  blurb: string | null;
}

interface RedditListing {
  data?: {
    children?: Array<{
      data?: {
        title?: string;
        permalink?: string;
        author?: string;
        subreddit?: string;
        created_utc?: number;
        selftext?: string;
      };
    }>;
  };
}

/** Search both hiking subreddits; returns [] (never throws) on failure. */
export async function searchRedditReports(
  env: Env,
  query: string,
  limitPerSub = 5,
): Promise<{ reports: RedditReport[]; errors: string[] }> {
  const key = `reddit:search:${query.toLowerCase()}:${limitPerSub}`;
  return cached(env, key, TTL.WEB, async () => {
    const reports: RedditReport[] = [];
    const errors: string[] = [];
    for (const sub of SUBREDDITS) {
      try {
        const url =
          `https://old.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}` +
          `&restrict_sr=1&sort=new&t=year&limit=${limitPerSub}`;
        const res = await throttled(env, url);
        const text = await res.text();
        if (!res.ok) {
          errors.push(`reddit r/${sub}: http_${res.status}${res.status === 403 ? " (likely datacenter-IP block; OAuth app would fix)" : ""}`);
          continue;
        }
        let listing: RedditListing;
        try {
          listing = JSON.parse(text) as RedditListing;
        } catch {
          errors.push(`reddit r/${sub}: non-JSON response (blocked or markup change)`);
          continue;
        }
        for (const child of listing.data?.children ?? []) {
          const d = child.data;
          if (!d?.title || !d.permalink) continue;
          reports.push({
            title: d.title,
            url: `https://www.reddit.com${d.permalink}`,
            author: d.author ?? null,
            subreddit: sub,
            date_posted:
              typeof d.created_utc === "number"
                ? new Date(d.created_utc * 1000).toISOString().slice(0, 10)
                : null,
            blurb: d.selftext ? d.selftext.replace(/\s+/g, " ").trim().slice(0, 400) : null,
          });
        }
      } catch (e) {
        errors.push(`reddit r/${sub}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { reports, errors };
  });
}
