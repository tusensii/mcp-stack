/**
 * Washington Trails Association (WTA) scraper.
 *
 * WTA is a Plone site with no public REST API. We scrape HTML respectfully:
 *   - per-invocation in-memory rate limit of one request / 1500ms
 *   - User-Agent identifies us and provides contact info
 *   - results are aggressively cached at the call site (TTL.WTA_*).
 *
 * --------------------------------------------------------------------------
 * VERIFIED ENDPOINTS / SELECTORS (probed 2026-04-29)
 * --------------------------------------------------------------------------
 * Trip-report SEARCH (the chrome page at /go-outside/trip-reports loads
 * results via XHR against an internal listing view — we hit that view
 * directly to get just the result HTML):
 *
 *     GET https://www.wta.org/@@search_tripreport_listing?title=Q&b_size=N
 *
 *   - Param `title=` filters server-side. `searchable_text=` and
 *     `SearchableText=` are silently IGNORED (return all 270k+ reports).
 *     The form on /go-outside/trip-reports submits `searchabletext=` to
 *     the page, which client-side JS rewrites into `title=` for this
 *     endpoint. We skip the rewrite and call the listing endpoint directly.
 *   - There is NO JSON variant. `format=json` is ignored.
 *
 * Each card in the listing is shaped like:
 *
 *     <div class="item">
 *       <div class="item-row">
 *         <div class="item-header">
 *           <h3 class="listitem-title">
 *             <a href="https://www.wta.org/go-hiking/trip-reports/trip_report-2025-10-15.150858539502">
 *               The Enchantments — Oct. 15, 2025
 *             </a>
 *           </h3>
 *           <div class="region"><span class="region">Central Cascades &gt; Leavenworth Area</span></div>
 *         </div>
 *         ...
 *         <span class="wta-icon-headline__text">Leavenworth Rangers</span>
 *         ...
 *         <div class="trip-report-full-text"><p>...blurb...</p></div>
 *
 * Key gotchas:
 *   - Report URLs live under /go-hiking/trip-reports/ (NOT /go-outside/).
 *   - The link text contains BOTH the hike name AND the hike date,
 *     separated by an em dash ("—" U+2014). We split on " — " or " &mdash; ".
 *   - Date in the link text is a short form like "Apr. 29, 2026" or
 *     "Oct. 15, 2025"; parseDate() handles both.
 *
 * Trip-report DETAIL page (e.g.
 * /go-hiking/trip-reports/trip_report-2025-10-15.150858539502):
 *
 *   - Title:    <h1 class="documentFirstHeading">
 *                 <a href="/go-hiking/hikes/SLUG">HIKE</a> — Wednesday, Oct. 15, 2025
 *               </h1>
 *   - Author:   <div class="date-and-author">...<span class="wta-icon-headline__text">NAME</span>
 *   - Conditions: <div id="trip-conditions">
 *                   <div class="trip-condition"><h4>Type of Hike</h4><span>Overnight</span></div>
 *                   <div class="trip-condition"><h4>Snow</h4><span>...</span></div> ...
 *               (NOTE: legacy <dl class="trip-conditions"> is GONE on current site)
 *   - Hike:     /go-hiking/hikes/SLUG link, also surfaced in
 *               <div class="related-hike-links"><ul><li><a href=".../hikes/SLUG">NAME</a>
 *   - Body:     <div id="tripreport-body"><div id="tripreport-body-text">...<p>...</p>...
 *
 * Hike SEARCH (/go-hiking/hikes?searchable_text=Q): server-rendered, this
 * one DOES respect `searchable_text=`.
 *   - Card:   <div class="search-result-item">
 *   - Title:  <h3 class="listitem-title"><a href="/go-hiking/hikes/SLUG"><span>NAME</span></a>
 *   - Region: <div class="region">REGION</div>      (sibling of listitem-title)
 *   - Stats:  <dl class="hike-stats">
 *               <div class="hike-length">...<dd><span>7.0 miles, roundtrip</span></dd>
 *               <div class="hike-gain">...<dd><span>1,400</span> feet</dd>
 *               <div class="hike-rating">...<div class="current-rating" ...>3.29</div>
 * --------------------------------------------------------------------------
 *
 * Selectors here are FRAGILE. Every parser is regex-based and tolerant of
 * missing fields — degraded output is empty arrays / nulls, never throws.
 * The vitest fixture in `wta.test.ts` is the canary for breaking changes;
 * keep it anchored on these selectors.
 */

import type { Env } from "../types.js";
import { TTL, cached } from "../cache.js";

const BASE = "https://www.wta.org";
const MIN_INTERVAL_MS = 1500;

/** Module-scoped (per worker invocation) timestamp of the last WTA fetch. */
let lastFetchAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function rateLimitedFetch(env: Env, url: string): Promise<Response> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastFetchAt);
  if (wait > 0) await sleep(wait);
  lastFetchAt = Date.now();
  return fetch(url, {
    headers: {
      "User-Agent": `pnw-trip-mcp/0.1 (research aggregator; ${env.CONTACT})`,
      Accept: "text/html,*/*;q=0.5",
    },
  });
}

export interface TripReportSummary {
  title: string;
  url: string;
  author: string | null;
  hike_name: string | null;
  date_hiked: string | null; // ISO YYYY-MM-DD when parseable
  conditions_blurb: string | null;
}

export interface TripReportDetail {
  url: string;
  title: string | null;
  author: string | null;
  hike_name: string | null;
  date_hiked: string | null;
  /** Free-form key/value table of conditions categories. */
  conditions: Record<string, string>;
  body: string | null;
}

export interface HikeSummary {
  hike_name: string;
  url: string;
  region: string | null;
  length_miles: number | null;
  gain_ft: number | null;
  rating: number | null;
}

/* ----------------------------- helpers ----------------------------- */

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function absUrl(href: string): string {
  if (!href) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return BASE + href;
  return `${BASE}/${href}`;
}

/** Parse "Saturday, Jul. 13, 2024" / "Oct. 15, 2025" / "2024-07-13" → ISO date. */
function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Drop any trailing weekday prefix and stray punctuation.
  const cleaned = raw.replace(/\s+/g, " ").trim().replace(/^[A-Za-z]+,\s*/, "");
  // ISO short-circuit.
  const iso = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Date.parse handles "Oct. 15, 2025" and "Jul 13, 2024" reliably enough.
  const t = Date.parse(cleaned);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

/**
 * Listing-card titles look like "The Enchantments — Apr. 17, 2026" but the
 * surrounding HTML often dumps region and author into the same flattened
 * string after our regex captures past the </a>. Extract the date with a
 * dedicated month-pattern instead of greedy-anything-after-emdash, and
 * use the date's position to clip the hike name cleanly.
 */
const DATE_RE =
  /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4}\b/i;

function splitTitleAndDate(raw: string): { hike: string; date: string | null } {
  const s = decodeEntities(raw).replace(/\s+/g, " ").trim();
  const dm = s.match(DATE_RE);
  if (dm && dm.index !== undefined) {
    const date = dm[0];
    let hike = s.slice(0, dm.index).trim();
    // Strip a trailing em/en dash or hyphen that separates name from date.
    hike = hike.replace(/[\s—–\-]+$/u, "").trim();
    return { hike, date };
  }
  // Fallback: split on the em dash if no date pattern present.
  const m = s.match(/^(.*?)\s+[—–\-]\s+(.+)$/);
  if (m) return { hike: m[1].trim(), date: m[2].trim() };
  return { hike: s, date: null };
}

/* ------------------------ trip report search ----------------------- */

/**
 * Search WTA trip reports by free-text query.
 *
 * Hits the internal listing view directly. The chrome page at
 * /go-outside/trip-reports renders a near-empty shell that XHR-fetches this
 * same endpoint, so going straight to it skips ~50KB of irrelevant chrome.
 */
export async function searchTripReports(
  env: Env,
  query: string,
  limit = 15,
): Promise<TripReportSummary[]> {
  const key = `wta:search:${query.toLowerCase()}:${limit}`;
  return cached(env, key, TTL.WTA_LIST, async () => {
    try {
      const url = `${BASE}/@@search_tripreport_listing?title=${encodeURIComponent(query)}&b_size=${limit}`;
      const res = await rateLimitedFetch(env, url);
      if (!res.ok) {
        console.warn(`[wta.searchTripReports] HTTP ${res.status} for ${url}`);
        return [];
      }
      const html = await res.text();
      const parsed = parseTripReportListing(html).slice(0, limit);
      if (parsed.length === 0) {
        const hasAnchor = html.includes("listitem-title");
        const hasContainer = html.includes('id="trip-reports"');
        const looksBlocked =
          html.includes("cdn-cgi/challenge") ||
          html.includes("Just a moment") ||
          html.toLowerCase().includes("captcha");
        console.warn(
          `[wta.searchTripReports] zero parsed for "${query}": ` +
            `bytes=${html.length} hasAnchor=${hasAnchor} hasContainer=${hasContainer} ` +
            `blocked=${looksBlocked} head=${html.slice(0, 200).replace(/\s+/g, " ")}`,
        );
      }
      return parsed;
    } catch (e) {
      console.warn("[wta.searchTripReports] failed:", (e as Error).message);
      return [];
    }
  });
}

/**
 * Parse the @@search_tripreport_listing HTML.
 *
 * Anchored on `<h3 class="listitem-title"><a href="...">HIKE — DATE</a></h3>`.
 * After each card-anchor we walk up to ~3KB of trailing HTML for the
 * region, author and blurb — fields appear in any order across templates.
 */
export function parseTripReportListing(html: string): TripReportSummary[] {
  const out: TripReportSummary[] = [];
  // Title link inside <h3 class="listitem-title">. Capture group 3 is the
  // window of HTML following the link (until the next listitem-title or EOF).
  const cardRe =
    /<h3[^>]*class="[^"]*listitem-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,3500}?)(?=<h3[^>]*class="[^"]*listitem-title|$)/gi;

  for (const m of html.matchAll(cardRe)) {
    const href = m[1];
    const titleRaw = m[2];
    const tail = m[3] ?? "";
    if (!href || !titleRaw) continue;

    const titleText = stripTags(titleRaw);
    const { hike, date } = splitTitleAndDate(titleText);

    const regionM =
      tail.match(/class="[^"]*region[^"]*"[^>]*>\s*<span[^>]*class="[^"]*region[^"]*"[^>]*>([\s\S]*?)<\/span>/i) ??
      tail.match(/class="[^"]*region[^"]*"[^>]*>([\s\S]*?)<\//i);

    const authorM =
      tail.match(
        /class="[^"]*wta-icon-headline__text[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      ) ??
      tail.match(/<span[^>]*itemprop="author"[^>]*>([\s\S]*?)<\/span>/i);

    const blurbM =
      tail.match(
        /class="[^"]*trip-report-full-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ) ??
      tail.match(/class="[^"]*report-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ??
      tail.match(/<p[^>]*>([\s\S]*?)<\/p>/i);

    // Compose a clean title from the parsed pieces rather than the raw
    // captured anchor text, which often picks up region + author noise
    // when the listing template wraps the heading loosely.
    const cleanTitle = date ? `${hike} — ${date}` : hike || titleText;
    out.push({
      title: cleanTitle,
      url: absUrl(href),
      author: authorM ? stripTags(authorM[1]) : null,
      hike_name: hike || null,
      date_hiked: parseDate(date),
      // hike_name is the search-relevant field; conditions_blurb gets a
      // brief excerpt of the report body when present.
      conditions_blurb: blurbM ? stripTags(blurbM[1]).slice(0, 400) : (regionM ? stripTags(regionM[1]) : null),
    });
  }
  return out;
}

/* -------------------------- trip report detail --------------------- */

export async function getTripReport(
  env: Env,
  reportUrl: string,
): Promise<TripReportDetail | null> {
  const key = `wta:report:${reportUrl}`;
  return cached(env, key, TTL.WTA_REPORT, async () => {
    try {
      const res = await rateLimitedFetch(env, reportUrl);
      if (!res.ok) return null;
      const html = await res.text();
      return parseTripReport(html, reportUrl);
    } catch (e) {
      console.warn("[wta.getTripReport] failed:", (e as Error).message);
      return null;
    }
  });
}

/**
 * Parse a single trip-report page.
 *
 * The h1 inline-encodes hike + date:
 *   <h1 class="documentFirstHeading">
 *     <a href="/go-hiking/hikes/SLUG">The Enchantments</a> — Wednesday, Oct. 15, 2025
 *   </h1>
 *
 * Conditions are now rendered as repeating <div class="trip-condition">
 * blocks under <div id="trip-conditions"> (the legacy <dl class="trip-conditions">
 * markup is GONE on the current site — a fallback for it is kept anyway).
 */
export function parseTripReport(html: string, url: string): TripReportDetail {
  // h1 inner HTML — split out the linked hike name from the trailing date.
  const h1M = html.match(
    /<h1[^>]*class="[^"]*documentFirstHeading[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
  );
  let hikeName: string | null = null;
  let dateRaw: string | null = null;
  let title: string | null = null;
  if (h1M) {
    const inner = h1M[1];
    const hikeLinkM = inner.match(
      /<a[^>]*href="[^"]*\/go-hiking\/hikes\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (hikeLinkM) hikeName = stripTags(hikeLinkM[1]);
    const flat = stripTags(inner);
    title = flat;
    const split = splitTitleAndDate(flat);
    if (!hikeName) hikeName = split.hike;
    dateRaw = split.date;
  }

  // Author — first wta-icon-headline__text inside the metadata block.
  const authorM =
    html.match(
      /<div[^>]*class="[^"]*date-and-author[^"]*"[^>]*>[\s\S]*?<span[^>]*class="[^"]*wta-icon-headline__text[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ) ??
    html.match(
      /<span[^>]*itemprop="author"[^>]*>[\s\S]*?<span[^>]*class="[^"]*wta-icon-headline__text[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );

  // Body.
  const bodyM =
    html.match(
      /<div[^>]*id="tripreport-body-text"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div[^>]*class="[^"]*comments)/i,
    ) ??
    html.match(/<div[^>]*id="tripreport-body"[^>]*>([\s\S]*?)<\/div>/i);

  // Conditions: prefer the current per-condition block markup, fall back
  // to the legacy <dl class="trip-conditions"> for older cached pages.
  const conditions: Record<string, string> = {};
  const condBlockM = html.match(
    /<div[^>]*id="trip-conditions"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
  );
  const condScope = condBlockM ? condBlockM[1] : html;
  const condRe =
    /<div[^>]*class="[^"]*trip-condition[^"]*"[^>]*>\s*<h4[^>]*>([\s\S]*?)<\/h4>\s*<span[^>]*>([\s\S]*?)<\/span>/gi;
  for (const c of condScope.matchAll(condRe)) {
    const k = stripTags(c[1]);
    const v = stripTags(c[2]);
    if (k) conditions[k] = v;
  }
  if (Object.keys(conditions).length === 0) {
    const dlM = html.match(
      /<dl[^>]*class="[^"]*trip-conditions[^"]*"[^>]*>([\s\S]*?)<\/dl>/i,
    );
    if (dlM) {
      const pairRe = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
      for (const p of dlM[1].matchAll(pairRe)) {
        const k = stripTags(p[1]);
        const v = stripTags(p[2]);
        if (k) conditions[k] = v;
      }
    }
  }

  return {
    url,
    title,
    author: authorM ? stripTags(authorM[1]) : null,
    hike_name: hikeName,
    date_hiked: parseDate(dateRaw),
    conditions,
    body: bodyM ? stripTags(bodyM[1]).slice(0, 4000) : null,
  };
}

/* ------------------------------ hikes ------------------------------ */

export async function searchHikes(env: Env, query: string): Promise<HikeSummary[]> {
  const key = `wta:hikes:${query.toLowerCase()}`;
  return cached(env, key, TTL.WTA_LIST, async () => {
    try {
      // The hikes listing DOES respect `searchable_text=` (unlike trip reports).
      const url = `${BASE}/go-hiking/hikes?searchable_text=${encodeURIComponent(query)}`;
      const res = await rateLimitedFetch(env, url);
      if (!res.ok) return [];
      const html = await res.text();
      return parseHikeListing(html);
    } catch (e) {
      console.warn("[wta.searchHikes] failed:", (e as Error).message);
      return [];
    }
  });
}

/**
 * Parse /go-hiking/hikes search results.
 *
 *   <div class="search-result-item">
 *     <h3 class="listitem-title">
 *       <a href="/go-hiking/hikes/SLUG"><span>NAME</span></a>
 *     </h3>
 *     <div class="region">REGION</div>
 *     <dl class="hike-stats">
 *       <div class="hike-length">...<dd><span>7.0 miles, roundtrip</span>
 *       <div class="hike-gain">...<dd><span>1,400</span> feet
 *       <div class="hike-rating">...<div class="current-rating">3.29</div>
 */
export function parseHikeListing(html: string): HikeSummary[] {
  const out: HikeSummary[] = [];
  const cardRe =
    /<h3[^>]*class="[^"]*listitem-title[^"]*"[^>]*>\s*<a[^>]*href="([^"]*\/go-hiking\/hikes\/[^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,3500}?)(?=<h3[^>]*class="[^"]*listitem-title|$)/gi;

  for (const m of html.matchAll(cardRe)) {
    const url = absUrl(m[1]);
    const name = stripTags(m[2] ?? "");
    const tail = m[3] ?? "";
    if (!name) continue;

    const regionM =
      tail.match(/class="[^"]*region[^"]*"[^>]*>([\s\S]*?)<\//i) ??
      tail.match(/class="[^"]*hike-region[^"]*"[^>]*>([\s\S]*?)<\//i);

    const lenM =
      tail.match(
        /class="[^"]*hike-length[^"]*"[^>]*>[\s\S]*?<dd[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
      ) ??
      tail.match(/Length[^<]*<[^>]+>\s*([\d.]+)\s*miles/i) ??
      tail.match(/([\d.]+)\s*miles?/i);

    const gainM =
      tail.match(
        /class="[^"]*hike-gain[^"]*"[^>]*>[\s\S]*?<dd[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
      ) ??
      tail.match(/Gain[^<]*<[^>]+>\s*([\d,]+)\s*(?:feet|ft)/i) ??
      tail.match(/([\d,]+)\s*(?:feet|ft)\b/i);

    const ratingM =
      tail.match(/class="[^"]*current-rating[^"]*"[^>]*>([\s\S]*?)<\//i) ??
      tail.match(/class="[^"]*average-rating[^"]*"[^>]*>([\s\S]*?)<\//i);

    out.push({
      hike_name: name,
      url,
      region: regionM ? stripTags(regionM[1]) : null,
      length_miles: parseNumber(lenM?.[1]),
      gain_ft: parseNumber(gainM?.[1]),
      rating: parseNumber(ratingM?.[1]),
    });
  }
  return out;
}

function parseNumber(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = stripTags(raw).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
