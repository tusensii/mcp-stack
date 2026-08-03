# trip-mcp

PNW backpacking & camping research MCP server. Single Cloudflare Worker exposing
12 outcome-oriented tools that aggregate Recreation.gov, NWS, NPS, USFS, WSDOT,
WFIGS, InciWeb, WTA, OSM, USGS, and Open-Meteo data.

## Tools

| Tool | What it does |
|---|---|
| `research_trip` | Top-level orchestrator. Fans out to all sources in parallel and returns a synthesized brief plus `suggested_followups`. |
| `find_areas` | Resolves a free-text query to canonical PNW area records; WTA hiking-guide fallback for off-registry WA trails. |
| `get_permits` | All permit options for an area (Rec.gov + self-issued). |
| `check_availability` | Live RIDB availability for a permit/campground + date range. |
| `get_weather` | NWS daily/hourly forecast + active alerts + AFD; optional Open-Meteo elevation-adjusted block. |
| `get_elevation_profile` | Distance-indexed elevation series along a trail polyline (points, OSM id, or trail name). |
| `get_trail_weather_profile` | Chart-ready {mile, elevation, temp, precip} series along a trail. |
| `get_trip_reports` | Recent WTA trip reports for an area or trail. |
| `get_conditions` | Combined NPS + USFS + WSDOT + WFIGS + InciWeb. |
| `get_route_info` | OSM trails/trailheads/water + USGS elevation. |
| `get_safety_brief` | Curated safety brief: bear canisters, river crossings, ranger stations. |
| `web_research` | Brave Search across PNW outdoor community sources (NWHikers, Peakbagger, etc.). |

## Deploy

```bash
# 1. Create KV namespace and put its ID in wrangler.jsonc
wrangler kv:namespace create CACHE

# 2. Set secrets
wrangler secret put MCP_PATH_SECRET   # 32-byte URL-safe random
wrangler secret put RIDB_API_KEY      # https://ridb.recreation.gov/
wrangler secret put NPS_API_KEY       # https://www.nps.gov/subjects/developer/get-started.htm
wrangler secret put WSDOT_API_KEY     # https://wsdot.wa.gov/traffic/api/
wrangler secret put CONTACT           # email or URL — required by NWS UA
wrangler secret put BRAVE_API_KEY     # optional — https://brave.com/search/api/

# 3. Deploy
pnpm deploy
```

## Use

URL pattern: `https://trip-mcp.<sub>.workers.dev/s/<MCP_PATH_SECRET>/mcp`

Add as a custom connector in claude.ai → Settings → Connectors → Add custom connector.

## Architecture

- `src/index.ts` — Worker entry, delegates to `@mcp-stack/mcp-core/worker`.
- `src/server.ts` — Builds the McpServer, registers tools, exposes `safety_footer` prompt.
- `src/areas.ts` — Hand-curated registry of PNW destinations.
- `src/cache.ts` — KV-backed tiered TTL cache.
- `src/sources/*.ts` — One file per data source (RIDB, NWS, NPS, WSDOT, WFIGS, InciWeb, WTA, OSM, USGS, Brave).
- `src/tools/*.ts` — One file per tool. Each calls source modules and returns a `ToolPayload<T>` with `data`, `sources[]`, `confidence`, `caveats[]`.

## Caveats

- `get_conditions` NPS alerts require the free `NPS_API_KEY` secret (nps.gov/subjects/developer/get-started.htm); a missing key surfaces as a named caveat rather than an HTTP status.
- WSDOT pass conditions require the free `WSDOT_API_KEY` access code (wsdot.wa.gov/traffic/api/), passed as the `AccessCode` query param. A 401 means the code is missing, expired, or rotated — re-issue and `wrangler secret put WSDOT_API_KEY`.
- WTA has no API; the scraper uses regex-based HTML parsing and will need babysitting when WTA redesigns. Snapshot test in `src/sources/wta.test.ts`.
- USFS forest-page scraping is not yet implemented; `get_conditions` returns an empty `usfs_alerts` array with a caveat.
- Auth is shared-secret-in-URL — fine for ≤10 trusted friends, not acceptable for the Anthropic Connectors Directory submission. Marketplace prep requires OAuth 2.1 (see Phase 3 in the original build plan).
- Brave Search is optional; `web_research` degrades gracefully without `BRAVE_API_KEY`.

## Safety

This server surfaces information used in life-safety decisions (river crossings,
snow, exposure, wildlife). Every tool result includes `caveats[]` and a
confidence enum. Claude is instructed (via the `safety_footer` prompt resource)
to append a disclaimer pointing users at ranger stations and the Ten Essentials.
This is research assistance, not a substitute for ground-truth.
