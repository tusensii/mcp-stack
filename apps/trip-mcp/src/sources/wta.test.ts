/**
 * Snapshot/regex tests for WTA HTML parsers.
 *
 * Fixtures below are reduced from real responses captured from the live WTA
 * site (probed 2026-04-29) — see the SELECTOR NOTES at the top of `wta.ts`
 * for the verified endpoints. When WTA redesigns, this is the canary:
 *   1) update the fixtures here to a fresh sample, then
 *   2) update the parsers in `wta.ts` until the tests pass again.
 */

import { describe, expect, it } from "vitest";
import {
  parseHikeListing,
  parseTripReport,
  parseTripReportListing,
} from "./wta.js";

// Real-shape fixture from /@@search_tripreport_listing?title=Enchantments
// (each card is a <div class="item"> containing an <h3 class="listitem-title">
// whose link text encodes "HIKE — DATE").
const TRIP_REPORT_LISTING_FIXTURE = `
<div id="trip-reports">
  <div class="item">
    <div class="item-row">
      <div class="item-header">
        <h3 class="listitem-title">
          <a href="https://www.wta.org/go-hiking/trip-reports/trip_report-2025-10-15.150858539502">
            The Enchantments &mdash; Oct. 15, 2025
          </a>
        </h3>
        <div class="region"><span class="region">Central Cascades &gt; Leavenworth Area</span></div>
      </div>
      <div class="col nine">
        <div class="CreatorInfo">
          <span itemprop="author">
            <a class="wta-icon-headline" href="/@@backpacks/scrnm-jane">
              <span class="wta-icon-headline__text">Jane Hiker</span>
            </a>
          </span>
        </div>
        <div class="report-text show-excerpt">
          <div>
            <div class="trip-report-full-text"><p>Snow patches above 7000 ft. Larches turning gold. Bugs gone.</p></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="item">
    <div class="item-row">
      <div class="item-header">
        <h3 class="listitem-title">
          <a href="https://www.wta.org/go-hiking/trip-reports/trip_report-2025-10-12.102849876949">
            Colchuck Lake &mdash; Oct. 12, 2025
          </a>
        </h3>
        <div class="region"><span class="region">Central Cascades &gt; Leavenworth Area</span></div>
      </div>
      <div class="col nine">
        <div class="CreatorInfo">
          <span itemprop="author">
            <a class="wta-icon-headline" href="/@@backpacks/scrnm-bob">
              <span class="wta-icon-headline__text">Bob Walker</span>
            </a>
          </span>
        </div>
        <div class="report-text show-excerpt">
          <div>
            <div class="trip-report-full-text"><p>Trail clear of snow to lake.</p></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`;

describe("parseTripReportListing", () => {
  it("extracts cards with title, url, author, hike, date, blurb", () => {
    const out = parseTripReportListing(TRIP_REPORT_LISTING_FIXTURE);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out).toHaveLength(2);

    const a = out[0];
    expect(a.url).toBe(
      "https://www.wta.org/go-hiking/trip-reports/trip_report-2025-10-15.150858539502",
    );
    expect(a.hike_name).toBe("The Enchantments");
    expect(a.title).toMatch(/Enchantments/);
    expect(a.date_hiked).toBe("2025-10-15");
    expect(a.author).toMatch(/Jane/);
    expect(a.conditions_blurb).toMatch(/snow|larch|bug/i);

    const b = out[1];
    expect(b.hike_name).toBe("Colchuck Lake");
    expect(b.date_hiked).toBe("2025-10-12");
    expect(b.author).toMatch(/Bob/);
  });

  it("returns [] on empty/garbage input rather than throwing", () => {
    expect(parseTripReportListing("")).toEqual([]);
    expect(parseTripReportListing("<html><body>nothing here</body></html>")).toEqual([]);
  });
});

// Real-shape fixture from a /go-hiking/trip-reports/trip_report-... page.
const TRIP_REPORT_DETAIL_FIXTURE = `
<html><body>
  <h1 class="documentFirstHeading" itemprop="name">
    <a href="https://www.wta.org/go-hiking/hikes/enchantment-lakes">The Enchantments</a> &mdash; Wednesday, Oct. 15, 2025
  </h1>
  <div class="trip-report-metadata">
    <div class="date-and-author">
      <h4>Trip Report By</h4>
      <div class="CreatorInfo">
        <span itemprop="author">
          <a class="wta-icon-headline" href="/@@backpacks/scrnm-LR">
            <span class="wta-icon-headline__text">Leavenworth Rangers</span>
          </a>
        </span>
      </div>
    </div>
    <div class="trip-report-features">
      <div id="trip-conditions" class="alpha">
        <div class="trip-condition">
          <h4>Type of Hike</h4><span>Overnight</span>
        </div>
        <div class="trip-condition">
          <h4>Road</h4><span>Road suitable for all vehicles</span>
        </div>
        <div class="trip-condition">
          <h4>Snow</h4><span>Snowfields to cross - could be difficult</span>
        </div>
        <div class="trip-condition">
          <h4>Bugs</h4><span>No bugs</span>
        </div>
      </div>
    </div>
  </div>
  <div id="tripreport-body">
    <div id="tripreport-body-text" itemprop="text">
      <p>Started at 6am, made the lake by 9. Clear skies, swarms of mosquitoes earlier in the season but none now.</p>
    </div>
  </div>
</body></html>`;

describe("parseTripReport", () => {
  it("extracts title, hike, author, date, conditions, body", () => {
    const out = parseTripReport(
      TRIP_REPORT_DETAIL_FIXTURE,
      "https://www.wta.org/go-hiking/trip-reports/trip_report-x",
    );
    expect(out.hike_name).toBe("The Enchantments");
    expect(out.author).toBe("Leavenworth Rangers");
    expect(out.date_hiked).toBe("2025-10-15");
    expect(out.conditions.Snow).toMatch(/Snowfield/);
    expect(out.conditions.Bugs).toMatch(/No bugs/);
    expect(out.conditions.Road).toMatch(/all vehicles/);
    expect(out.conditions["Type of Hike"]).toBe("Overnight");
    expect(out.body).toMatch(/mosquitoes/);
  });
});

const HIKE_LISTING_FIXTURE = `
<div class="search-results">
  <div class="search-result-item">
    <div>
      <div class="item-header">
        <h3 class="listitem-title">
          <a href="https://www.wta.org/go-hiking/hikes/colchuck-lake">
            <span>Colchuck Lake</span>
          </a>
        </h3>
        <div class="region">Central Cascades &gt; Leavenworth Area</div>
      </div>
      <div class="hike-detail omega col nine">
        <dl class="hike-stats grid-container grid-container--auto-small">
          <div class="hike-length hike-stat hike-stats__stat">
            <dt>Length</dt>
            <dd><span>8.0 miles, roundtrip</span></dd>
          </div>
          <div class="hike-gain hike-stat hike-stats__stat">
            <dt>Elevation Gain</dt>
            <dd><span>2,280</span> feet</dd>
          </div>
          <div class="hike-rating hike-stat hike-stats__stat">
            <dt>Rating</dt>
            <dd>
              <div class="star-rating" style="width:99px">
                <div class="current-rating" style="width:94%">4.7</div>
              </div>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </div>
  <div class="search-result-item">
    <div>
      <div class="item-header">
        <h3 class="listitem-title">
          <a href="https://www.wta.org/go-hiking/hikes/snow-lake">
            <span>Snow Lake</span>
          </a>
        </h3>
        <div class="region">Snoqualmie Region &gt; Snoqualmie Pass</div>
      </div>
      <div class="hike-detail omega col nine">
        <dl class="hike-stats">
          <div class="hike-length hike-stat hike-stats__stat">
            <dt>Length</dt>
            <dd><span>7.2 miles, roundtrip</span></dd>
          </div>
          <div class="hike-gain hike-stat hike-stats__stat">
            <dt>Elevation Gain</dt>
            <dd><span>1,800</span> feet</dd>
          </div>
          <div class="hike-rating hike-stat hike-stats__stat">
            <dt>Rating</dt>
            <dd>
              <div class="star-rating">
                <div class="current-rating" style="width:88%">4.4</div>
              </div>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  </div>
</div>`;

describe("parseHikeListing", () => {
  it("extracts hike name, url, region, length, gain, rating", () => {
    const out = parseHikeListing(HIKE_LISTING_FIXTURE);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      hike_name: "Colchuck Lake",
      url: "https://www.wta.org/go-hiking/hikes/colchuck-lake",
      length_miles: 8.0,
      gain_ft: 2280,
      rating: 4.7,
    });
    expect(out[0].region).toMatch(/Leavenworth/);
    expect(out[1].hike_name).toBe("Snow Lake");
    expect(out[1].length_miles).toBe(7.2);
    expect(out[1].gain_ft).toBe(1800);
  });

  it("returns [] on empty input", () => {
    expect(parseHikeListing("")).toEqual([]);
  });
});
