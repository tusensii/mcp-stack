# trip-mcp design principles

Settled via user interview (Aug 2026), recorded in issue #77. These
govern all trip-mcp work; new-tool issues reference this file instead of
restating conventions.

## 1. PNW-only, depth over breadth

No geographic expansion. Investment goes into richer data per area —
more curated fields, more sources, better composition — not more
regions. Non-PNW queries route to `web_research` / plain web search.

## 2. Impersonal

No user modeling: no stored pace, fitness, gear inventory, or home
location. Tools take explicit parameters (`pace_mph`, `origin`,
`elevation_ft`) with documented defaults instead of profiles. A default
like "seattle" is a convenience constant, not a memory of the user.

## 3. Day hikes and multi-night trips are equal citizens

No tool may assume overnight (permits, camps) or day-trip (single-day
weather windows). Overnight-specific capability ships as its own tool
(e.g. `get_camp_water_beta`) rather than as assumptions baked into
shared tools.

## 4. Chart-ready series everywhere

Any tool returning multi-point quantitative data emits arrays of flat
`{x-key, y-key(s)}` objects with consistent units — **feet, °F, miles,
mph, cfs** — plus a `provenance` block labeling each field's source and
confidence. A consumer should be able to hand a series directly to a
charting library without reshaping. Pattern established by
`get_trail_weather_profile` (`{mile, elevation_ft, temp_f, precip_pct}`).

Payloads stay bounded: downsample rather than emitting unbounded series
(≤ ~100 points per series; time-series capped per tool description).

## 5. À la carte tools first

New capability ships as a discrete tool before being folded into
`research_trip` orchestration. Orchestrator improvements come after the
tool layer is solid.

## 6. Standing conventions

- **Per-source graceful degradation**: one upstream failure degrades to
  a named caveat (`source_label: reason`); other sources are unaffected;
  handlers never throw.
- **Sources block**: URL + fetch timestamp + license/attribution +
  confidence for every upstream consulted. Open-Meteo requires CC BY 4.0
  attribution; WTA and other scraped sources use the
  content-used-with-attribution string.
- **Ranger-station prominence**: safety-critical topics (crossings,
  snow, avalanche, road washouts) surface ranger-station contact info
  from the registry; no tool output ever declares conditions "safe."
- **Curated data is labeled**: registry-style curation ships at
  low-to-medium confidence with explicit staleness caveats ("typical
  year", "call ahead"), never presented as live ground truth.
- **Caches**: KV-tiered TTLs in `cache.ts`; scraped sources ≤ 24h.
  Version cache keys (`:v2:`) when a parser/endpoint fix would otherwise
  serve stale wrong data for its TTL.
- **Keyless where possible**: prefer keyless public APIs (Open-Meteo,
  USGS, avalanche.org, OSRM demo) over keyed ones; keys that exist are
  Worker secrets with named-caveat degradation when missing.
