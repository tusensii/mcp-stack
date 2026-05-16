# mcp-stack

Four Model Context Protocol servers — Oura, Gmail, PNW backpacking
research, and GitHub Issues — built on Cloudflare Workers and a small set
of shared TypeScript primitives. One pnpm monorepo, 54 tools, ~2500 lines
of app code on top of ~1500 lines of reusable auth + HTTP + observability
packages.

## Why this exists

I wanted a real test of the "build your own MCP" pattern across surface areas
that don't share an auth model: a public PAT API (Oura), a refresh-token
OAuth flow (Gmail), and a half-dozen no-auth public APIs aggregated under a
single research tool (NWS, NPS, USGS, WSDOT, RIDB, OSM, WTA, …).

The shared packages exist because the *third* time I wrote
"cookie jar + retries + 5xx backoff + Retry-After", I extracted it. The
auth packages each capture a flow that took real trial-and-error to get
right (OAuth refresh-token JSON-shape variance, static-PAT header
injection, and — in a private sibling repo — Devise/Rails dual-CSRF and
AWS Cognito SRP bootstrap). Adding the next MCP should be a wire-up
exercise, not a rebuild.

It's also a portfolio piece. The architecture choices, the per-app trade-offs,
and the discipline around secrets, types, and bundle size are the work.

## Architecture

```
mcp-stack/
├── packages/                # shared, build-time only
│   ├── mcp-core             # path-secret check + thin wrapper over @modelcontextprotocol/sdk + agents
│   ├── http-fetch           # fetch wrapper: per-instance cookie jar, retries, timeouts, typed errors
│   ├── auth-rails           # Devise-style sign-in: form CSRF → POST → meta CSRF, auto re-auth on 401
│   ├── auth-cognito         # AWS Cognito refresh-token flow
│   ├── auth-oauth-google    # configured OAuth2Client from google-auth-library
│   ├── auth-bearer          # static PAT header injection
│   ├── shared-types         # cross-MCP types (Location, TimeWindow, BookingStatus)
│   └── observability        # structured JSON logger gated on DEBUG / OBSERVABILITY env flags
└── apps/                    # one Worker per app, each independent at runtime
    ├── oura-mcp             # 22 tools — raw Oura v2 + analytics layer
    ├── gmail-mcp            # 6 tools  — Gmail read/compose/labels/filters
    ├── trip-mcp             # 9 tools  — PNW backpacking research (NWS, NPS, RIDB, WTA, OSM, ...)
    └── github-mcp           # 17 tools — full GitHub Issues management; queue for Claude Code self-repair
```

Apps import from `packages/*` via pnpm workspace resolution. Wrangler bundles
each app independently — no cross-app shared state, no shared KV, no shared
Durable Objects. Secrets live per-Worker.

`auth-rails` and `auth-cognito` are exercised by private MCPs not included
in this public repo (the consumer apps are reverse-engineered HTTP clients
against vendors with no public API, kept out of public source for
terms-of-service reasons). The packages themselves are generic — `auth-rails`
works against any Devise app; `auth-cognito` against any Cognito user pool
where SRP bootstrap is done out-of-band.

## Tools by app

See each Worker's README for the full tool list and deploy steps:

- [`apps/oura-mcp`](apps/oura-mcp/README.md) — sleep, readiness, activity, HRV, plus baseline-compare / correlation / anomaly-detection / weekly-digest analytics
- [`apps/gmail-mcp`](apps/gmail-mcp/README.md) — list/get/compose/modify/delete emails, manage labels and server-side filters
- [`apps/trip-mcp`](apps/trip-mcp/README.md) — research_trip orchestrator + permits/weather/conditions/route-info/safety/web-search
- [`apps/github-mcp`](apps/github-mcp/README.md) — issues CRUD + comments + labels + assignees + cross-repo search; powers the [issue-driven self-repair workflow](CLAUDE.md)

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
pnpm deploy:gmail
pnpm deploy:trip
pnpm deploy:github
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
