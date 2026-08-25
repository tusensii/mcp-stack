# trip-brief

Config-driven generator for trip briefs and options cards. Pulls live data
from the deployed **trip-mcp** Worker, renders a React report, and emits both
a self-contained JSX file and a single-page mobile PDF.

This is the only app in `apps/*` that is **not** a Cloudflare Worker. It is a
Node CLI that runs on a laptop or in CI; it has no `wrangler.jsonc` and the
deploy workflow's app matrix does not include it.

## Why it exists

The Aug 2026 Royal Basin brief was built and refreshed by hand in a chat
sandbox — five data pulls, a patch script against inline JSX data, an esbuild
bundle, a Playwright render, a PDF post-pass — and every refresh repeated all
of it. Along the way the same failures kept recurring: prose tone drifted and
had to be corrected three times, links were added from memory, a
recreation.gov catalog ID got printed as the party's permit number, and the
itinerary put camp at the wrong lake because nobody had read the reservation.

Each of those is now a build step or a schema rule rather than a thing to
remember.

## Usage

```bash
export TRIP_MCP_URL='https://trip-mcp.<subdomain>.workers.dev/s/<path-secret>/mcp'

pnpm brief build configs/royal-basin-2026-08.json
pnpm brief build configs/weekend-options.json --out ./out
pnpm brief check configs/royal-basin-2026-08.json    # validate only, no network
```

Outputs land in `--out` (default `./dist`), one set per variant:

| File | What it is |
| --- | --- |
| `<slug>.jsx` | Self-contained React component, data inlined, JSX preserved. Paste into an artifact. |
| `<slug>.html` | The same component bundled with React, everything inline. What the PDF is rendered from. |
| `<slug>.pdf` | Single page, 430px wide, live links. |
| `<slug>.model.json` | The resolved model. Useful for diffing two refreshes. |
| `<slug>.offline.*` | The offline companion, when `outputs.offline` is set. |

Re-running refreshes every pull and rewrites everything. The refresh timestamp
is the last line of every document.

### Flags

| Flag | Effect |
| --- | --- |
| `--out <dir>` | Output directory. Default `./dist`. |
| `--no-pdf` | Skip Chromium. Fast loop when you are iterating on prose. |
| `--offline` | Force the offline variant regardless of `outputs.offline`. |
| `--link-check fail\|warn\|skip` | Override `provenance.link_check`. |
| `--quiet` | Summary only. |

### Environment

| Variable | Purpose |
| --- | --- |
| `TRIP_MCP_URL` | Full `https://<worker>/s/<path-secret>/mcp` endpoint. |
| `TRIP_MCP_ORIGIN` + `TRIP_MCP_PATH_SECRET` | Alternative to the above. |
| `TRIP_BRIEF_CHROMIUM` | Chromium binary for the PDF step. |
| `PLAYWRIGHT_BROWSERS_PATH` | Searched as a fallback for a Chromium. |

The path secret is the same `MCP_PATH_SECRET` the Worker checks. Keep it out
of the config files — those are meant to be committable.

## Config

Two document kinds share one file format, discriminated on `kind`:

- `"trip"` — the pre-trip brief. See `configs/royal-basin-2026-08.example.json`.
- `"options"` — the candidate comparison card. See `configs/weekend-options.example.json`.

Both accept `//` and `/* */` comments, because the reasoning behind a
threshold belongs next to the threshold.

### The reservation block is not optional

When `permit.required` is `true`, `reservation` is required and the build
refuses to start without it. The assigned camp area, the nights and the party
size come off the actual confirmation — pasted text, a screenshot you
transcribe, or manual entry, the schema does not care which, only that you
read it. The itinerary, the storm-exposure flag, the sanitation line and the
permit checklist all derive from those fields.

Without a confirmation on an unpermitted trip, the report says the camp
assignment is unverified rather than assuming where parties usually camp.

### Provenance

Every fact carries a tier:

| Tier | What it covers |
| --- | --- |
| `live-instrument` | NWS forecasts, USGS gauges, NWAC, Open-Meteo |
| `official-static` | Agency-published regulations, quotas, phones, road status |
| `community` | Trip reports and forum posts |
| `lookup-inference` | Catalog metadata and inference |

`lookup-inference` values cannot render as specific claims — IDs, numbers,
anything a reader would act on — unless `provenance.allow_lookup_facts` is
set. That is the rule that stops a rec.gov catalog record from appearing as
somebody's permit number. Low-confidence payloads either carry visible
hedging or are dropped, per `provenance.low_confidence`.

Links are fetched during the build. Under the default `link_check: "fail"` a
dead URL stops the build; under `"warn"` it renders as plain text and the
report records it. Nothing becomes a tappable link on the strength of the
generator remembering it.

## Prose

Report prose comes from templates in `src/prose/templates.ts`, never from
freehand generation, so the same data renders the same words every time. The
tone rules are written out in [STYLE.md](./STYLE.md) and the constructions
that had to be corrected by hand are encoded as a banned-phrase lint that runs
in tests and at build time. Tone violations in config-supplied prose exit the
CLI non-zero.

## How the pipeline fits together

```
config.json
   ↓  loadConfig            zod schema, comments stripped
   ↓  pullTrip              parallel MCP tool calls; a failed tool degrades to a caveat
   ↓  verifyLinks           every renderable URL fetched
   ↓  buildTripModel        templates + provenance tiers + sun times → resolved document
   ↓  bundleJsx             esbuild, jsx preserved, data inlined      → <slug>.jsx
   ↓  bundleBrowser         esbuild, React bundled, minified
   ↓  htmlShell                                                        → <slug>.html
   ↓  renderPdf             Chromium at 430px, height = scrollHeight × 1.02
   ↓  trimAndStamp          drop the phantom trailing page, set title → <slug>.pdf
```

The React components make no decisions — every string reaching them was
already produced by a template. That is what lets the standard brief and the
offline variant be the same document in two skins.

## Tests

```bash
pnpm test
```

The Chromium end-to-end render (`src/render/pdf.e2e.test.ts`) skips itself
unless a Chromium is resolvable, so `pnpm test` stays green on a CI runner
with no Playwright browsers. Run it anywhere `PLAYWRIGHT_BROWSERS_PATH` is
set to exercise the render half of the pipeline.

## Requirements

Node 20+ and pnpm, like the rest of the repo. The CLI runs through `tsx`, so
there is no build step. The PDF step additionally needs a Chromium; everything
else works without one.
