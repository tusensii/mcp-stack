/**
 * Web search via Brave Search API. Used by `web_research` for obscure
 * routes (peakbagging, NWHikers, Reddit threads, Cascadeclimbers, etc.).
 *
 * Free tier: 2,000 queries/month. Tool degrades gracefully when no key
 * is configured — returns an empty payload with a caveat pointing the
 * user at a manual search URL.
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import { cached, TTL } from "../cache.js";
import type { Env } from "../types.js";
import { userAgent } from "../tools/utils.js";

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  source_domain: string;
  age?: string;
}

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

const PNW_OUTDOOR_DOMAINS = [
  "nwhikers.net",
  "summitpost.org",
  "peakbagger.com",
  "cascadeclimbers.com",
  "wta.org",
  "reddit.com/r/WashingtonHikers",
  "reddit.com/r/PNWhiking",
  "reddit.com/r/WildernessBackpacking",
  "mountaineers.org",
  "caltopo.com",
  "stephabegg.com",
];

interface BraveResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      age?: string;
      profile?: { name?: string; long_name?: string };
    }>;
  };
}

export async function searchWeb(
  env: Env,
  query: string,
  opts: { site_allowlist?: string[]; limit?: number } = {},
): Promise<{ results: WebResult[]; query_used: string; used_brave: boolean }> {
  const limit = Math.min(opts.limit ?? 8, 20);
  const sites = opts.site_allowlist;
  const queryWithSites = sites && sites.length
    ? `${query} (${sites.map((s) => `site:${s}`).join(" OR ")})`
    : query;

  if (!env.BRAVE_API_KEY) {
    return { results: [], query_used: queryWithSites, used_brave: false };
  }

  const cacheKey = `web:brave:${queryWithSites}:${limit}`;
  return cached(env, cacheKey, TTL.WEB, async () => {
    const client = createFetchClient({
      userAgent: userAgent(env.CONTACT),
      defaultHeaders: {
        "X-Subscription-Token": env.BRAVE_API_KEY!,
        Accept: "application/json",
      },
      timeoutMs: 10_000,
    });

    const url = new URL(BRAVE_ENDPOINT);
    url.searchParams.set("q", queryWithSites);
    url.searchParams.set("count", String(limit));
    url.searchParams.set("safesearch", "moderate");

    try {
      const data = await client.json<BraveResponse>(url.toString());
      const results: WebResult[] = (data.web?.results ?? []).slice(0, limit).map((r) => {
        const u = r.url ?? "";
        let domain = "";
        try {
          domain = new URL(u).hostname.replace(/^www\./, "");
        } catch {
          domain = "";
        }
        return {
          title: r.title ?? "",
          url: u,
          snippet: r.description ?? "",
          source_domain: domain,
          age: r.age,
        };
      });
      return { results, query_used: queryWithSites, used_brave: true };
    } catch {
      return { results: [], query_used: queryWithSites, used_brave: true };
    }
  });
}

export const PNW_DEFAULT_SITES = PNW_OUTDOOR_DOMAINS;
