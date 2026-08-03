/**
 * NWHikers.net (phpBB forum) trip-report search — scrape-with-attribution
 * like WTA (issue #81 Part B).
 *
 * Honesty note (probed 2026-08-02): nwhikers.net fronts a JavaScript
 * anti-bot challenge ("Please refresh this page") for non-browser
 * clients, which a Worker cannot execute. The parser detects the
 * challenge and degrades to [] with a named error so the trip-report
 * flow caveats it rather than failing. If NWHikers relaxes the
 * challenge, this starts working with no code change.
 */

import type { Env } from "../types.js";
import { TTL, cached } from "../cache.js";

const BASE = "https://www.nwhikers.net";
const MIN_INTERVAL_MS = 1500;

let lastFetchAt = 0;

async function throttled(env: Env, url: string): Promise<Response> {
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

export interface NwhikersReport {
  title: string;
  url: string;
  date_posted: string | null;
}

function looksBlocked(html: string): boolean {
  return (
    html.length < 4000 &&
    (/refresh.{0,20}this page/i.test(html) || /challenge|captcha|just a moment/i.test(html))
  );
}

/** Parse phpBB search results: `<a href="viewtopic.php?t=N" class="topictitle">`. */
export function parseNwhikersSearch(html: string): NwhikersReport[] {
  const out: NwhikersReport[] = [];
  const rowRe =
    /<a[^>]*href="(?:\.\/)?(viewtopic\.php\?[^"]*t=\d+[^"]*)"[^>]*class="[^"]*topictitle[^"]*"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1200}?)(?=<a[^>]*class="[^"]*topictitle|$)/gi;
  for (const m of html.matchAll(rowRe)) {
    const href = m[1];
    const title = (m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!href || !title) continue;
    const tail = m[3] ?? "";
    const dateM = tail.match(
      /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i,
    );
    let date: string | null = null;
    if (dateM?.[1]) {
      const t = Date.parse(dateM[1]);
      if (!Number.isNaN(t)) date = new Date(t).toISOString().slice(0, 10);
    }
    out.push({
      title,
      url: `${BASE}/forums/${href.replace(/&amp;/g, "&")}`,
      date_posted: date,
    });
  }
  return out;
}

export async function searchNwhikersReports(
  env: Env,
  query: string,
  limit = 5,
): Promise<{ reports: NwhikersReport[]; errors: string[] }> {
  const key = `nwhikers:search:${query.toLowerCase()}:${limit}`;
  return cached(env, key, TTL.WEB, async () => {
    try {
      const url = `${BASE}/forums/search.php?search_keywords=${encodeURIComponent(query)}&mode=results`;
      const res = await throttled(env, url);
      const html = await res.text();
      if (!res.ok) {
        return { reports: [], errors: [`nwhikers: http_${res.status}`] };
      }
      if (looksBlocked(html)) {
        return {
          reports: [],
          errors: ["nwhikers: anti-bot challenge page served — forum unreachable from server-side clients"],
        };
      }
      return { reports: parseNwhikersSearch(html).slice(0, limit), errors: [] };
    } catch (e) {
      return { reports: [], errors: [`nwhikers: ${e instanceof Error ? e.message : String(e)}`] };
    }
  });
}
