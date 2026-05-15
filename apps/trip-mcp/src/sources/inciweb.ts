/**
 * InciWeb RSS feed parser.
 *
 * Cloudflare Workers don't ship a DOM parser; we use cheap regex
 * extraction over the RSS XML. The feed is a flat <item> list under
 * <channel>; we filter for Pacific Northwest based on description and
 * forest-name keywords.
 */

import { createFetchClient } from "@mcp-stack/http-fetch";
import type { Env } from "../types.js";
import { cached, TTL } from "../cache.js";
import { userAgent } from "../tools/utils.js";

const FEED_URL = "https://inciweb.wildfire.gov/incidents/rss.xml";

const PNW_KEYWORDS = [
  "washington",
  "oregon",
  "idaho",
  "olympic national",
  "mt. baker",
  "mount baker",
  "mt baker",
  "okanogan",
  "wenatchee",
  "gifford pinchot",
  "umatilla",
  "deschutes",
  "willamette",
  "rogue river",
  "siskiyou",
  "siuslaw",
  "mt. hood",
  "mount hood",
  "mt hood",
  "fremont",
  "winema",
  "ochoco",
  "malheur",
  "wallowa",
  "whitman",
  "boise national",
  "payette",
  "salmon-challis",
  "salmon challis",
  "sawtooth",
  "nez perce",
  "clearwater",
  "panhandle",
  "north cascades",
  "mt. rainier",
  "mount rainier",
  "colville",
];

export interface InciwebItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m && m[1] ? decodeEntities(m[1]).trim() : "";
}

export function parseInciwebFeed(xml: string): InciwebItem[] {
  const items: InciwebItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1] ?? "";
    items.push({
      title: extractTag(block, "title"),
      link: extractTag(block, "link"),
      pubDate: extractTag(block, "pubDate"),
      description: extractTag(block, "description"),
    });
  }
  return items;
}

function isPnw(item: InciwebItem): boolean {
  const hay = `${item.title} ${item.description}`.toLowerCase();
  return PNW_KEYWORDS.some((k) => hay.includes(k));
}

export async function getInciwebFeed(env: Env): Promise<InciwebItem[]> {
  const key = "inciweb:pnw";
  return cached(env, key, TTL.WFIGS, async () => {
    const c = createFetchClient({
      userAgent: userAgent(env.CONTACT),
      defaultHeaders: { Accept: "application/rss+xml, application/xml, text/xml" },
      timeoutMs: 15_000,
      retries: 1,
    });
    const res = await c.fetch(FEED_URL);
    if (!res.ok) return [];
    const xml = await res.text();
    return parseInciwebFeed(xml).filter(isPnw);
  });
}
