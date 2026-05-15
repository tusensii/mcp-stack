# mcp-stack

Five Model Context Protocol servers — Oura, Orangetheory, a therapy practice
portal, Gmail, and PNW backpacking research — built on Cloudflare Workers
and a small set of shared TypeScript primitives. One pnpm monorepo, 52 tools,
~3000 lines of app code on top of ~1500 lines of reusable auth + HTTP +
observability packages.

## Why this exists

I wanted a real test of the "build your own MCP" pattern across surface areas
that don't share an auth model: a public PAT API (Oura), a refresh-token
OAuth flow (Gmail, Google Calendar), an AWS Cognito refresh flow with
out-of-band SRP bootstrap (OTF), a Devise/Rails session-cookie portal
(Sessions Health), and a half-dozen no-auth public APIs (NWS, NPS, USGS,
WSDOT, etc.).

The shared packages exist because the *third* time I wrote
"cookie jar + retries + 5xx backoff + Retry-After", I extracted it. Same
story for the auth packages: each captures a flow that took real
trial-and-error to get right (the two-token Rails CSRF rotation, the
Cognito-SRP-in-Workers impossibility, the OAuth JSON-shape variance). Adding
a sixth MCP should be a wire-up exercise, not a rebuild.

It's also a portfolio piece. The architecture choices, the per-app trade-offs,
and the discipline around secrets, types, and bundle size are the work.

## Architecture

```
mcp-stack/
├── packages/                # shared, build-time only
│   ├── mcp-core             # path-secret check + thin wrapper over @modelcontextprotocol/sdk + agents
│   ├── http-fetch           # fetch wrapper: per-instance cookie jar, retries, timeouts, typed errors
│   ├── auth-rails           # Devise-style sign-in: form CSRF → POST → meta CSRF, auto re-auth on 401
│   ├── auth-cognito         # AWS Cognito refresh-token flow (SRP bootstrap lives in apps/otf-mcp/scripts/)
│   ├── auth-oauth-google    # configured OAuth2Client from google-auth-library
│   ├── auth-bearer          # static PAT header injection
│   ├── shared-types         # cross-MCP types (Location, TimeWindow, BookingStatus)
│   └── observability        # structured JSON logger gated on DEBUG / OBSERVABILITY env flags
└── apps/                    # one Worker per app, each independent at runtime
    ├── oura-mcp             # 22 tools — raw Oura v2 + analytics layer
    ├── otf-mcp              # 9 tools  — Orangetheory booking + Google Calendar blocks
    ├── therapy-mcp          # 6 tools  — Sessions Health (Rails) portal
    ├── gmail-mcp            # 6 tools  — Gmail read/compose/labels/filters
    └── trip-mcp             # 9 tools  — PNW backpacking research (NWS, NPS, RIDB, WTA, OSM, ...)
```

Apps import from `packages/*` via pnpm workspace resolution. Wrangler bundles
each app independently — no cross-app shared state, no shared KV, no shared
Durable Objects. Secrets live per-Worker.

## Tools by app

See each Worker's README for the full tool list and deploy steps:

- [`apps/oura-mcp`](apps/oura-mcp/README.md) — sleep, readiness, activity, HRV, plus baseline-compare / correlation / anomaly-detection / weekly-digest analytics
- [`apps/otf-mcp`](apps/otf-mcp/README.md) — search studios, book/cancel classes, performance trends, optional calendar integration
- [`apps/therapy-mcp`](apps/therapy-mcp/README.md) — list/book/reschedule/cancel appointments via Sessions Health
- [`apps/gmail-mcp`](apps/gmail-mcp/README.md) — list/get/compose/modify/delete emails, manage labels and server-side filters
- [`apps/trip-mcp`](apps/trip-mcp/README.md) — research_trip orchestrator + permits/weather/conditions/route-info/safety/web-search

## Local development

```bash
# Prereqs: Node 20+, pnpm 10+

git clone https://github.com/tusensii/mcp-stack.git
cd mcp-stack
pnpm install

pnpm type-check      # tsc --noEmit across every package + app
pnpm test            # vitest across every package + app
pnpm audit           # pinned-secure via pnpm.overrides; should be empty

# Run one app locally with hot reload (trip-mcp shown — others use `pnpm --filter <app> exec wrangler dev`)
pnpm --filter trip-mcp dev
```

Each app's `README.md` documents the secrets it needs. Set them with
`wrangler secret put <NAME>` from the app directory; `wrangler.jsonc`
in each app names the Worker and compatibility flags but holds no secrets.

## Deploy

```bash
pnpm deploy:oura
pnpm deploy:otf
pnpm deploy:therapy
pnpm deploy:gmail
pnpm deploy:trip
```

Each is a thin alias for `pnpm --filter <app> deploy`, which runs
`wrangler deploy` in that app's directory. There is no root build step —
Wrangler bundles TypeScript source directly.

## Connect to claude.ai

Each deployed Worker exposes an MCP endpoint at
`https://<worker>.<your-subdomain>.workers.dev/s/<MCP_PATH_SECRET>/mcp`.

Add as a custom connector in **claude.ai → Settings → Connectors → Add
custom connector**. The path-secret is the only gate — keep it
secret, rotate it if you ever leak it. (Stronger auth — bearer tokens or
OAuth on top — is an obvious next step but unnecessary for personal use.)

## Tech stack

- **Runtime:** Cloudflare Workers (ESM modules format, `nodejs_compat`)
- **Language:** TypeScript strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`
- **Package manager:** pnpm workspaces (`packages/*`, `apps/*`)
- **MCP SDK:** `@modelcontextprotocol/sdk` + Cloudflare's `agents`
- **Validation:** Zod (v3)
- **Tests:** vitest, run from the workspace root
- **CI:** GitHub Actions — typecheck + test on every push and PR

## Repo conventions

- Node 20+, pnpm 10+
- ESM only (`"type": "module"` everywhere)
- TypeScript strict; no build step at the package level — Wrangler bundles source directly
- Per-app secrets via `wrangler secret put`; nothing sensitive committed
- Transitive CVE fixes via `pnpm.overrides` in the root `package.json` until upstream re-pins

## Security

See [`.github/SECURITY.md`](.github/SECURITY.md) for the vulnerability
reporting flow.

## License

[MIT](LICENSE) © tusensii
