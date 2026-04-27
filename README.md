# mcp-stack

A pnpm monorepo housing four Cloudflare Workers MCP servers and the shared
primitives they're built on. Each Worker keeps its own deployed URL, secrets,
and DNS — the monorepo is a build-time consolidation, not a runtime one.

## Architecture

```
mcp-stack/
├── packages/                # shared, build-time only
│   ├── mcp-core             # path-secret check + thin wrapper over @modelcontextprotocol/sdk and agents
│   ├── http-fetch           # fetch wrapper: per-instance cookie jar, retries, timeouts, typed errors
│   ├── auth-rails           # Devise-style sign-in: form CSRF -> POST -> meta CSRF, auto re-auth on 401
│   ├── auth-cognito         # AWS Cognito refresh-token flow (SRP bootstrap lives in apps/otf-mcp/scripts/)
│   ├── auth-oauth-google    # configured OAuth2Client from google-auth-library
│   ├── auth-bearer          # static PAT header injection
│   ├── shared-types         # cross-MCP types (Location, TimeWindow, BookingStatus)
│   └── observability        # structured logger, gated on DEBUG / OBSERVABILITY env flags
└── apps/                    # one Worker per app, each independent at runtime
    ├── oura-mcp
    ├── otf-mcp
    ├── therapy-mcp
    └── gmail-mcp
```

Apps import from `packages/*` via pnpm workspace resolution. Wrangler bundles
each app independently; there is no cross-app shared state, no shared KV, no
shared Durable Objects. Secrets live per-Worker.

## Migration status

| App          | Worker name        | Source repo                            | Migrated | Verified |
| ------------ | ------------------ | -------------------------------------- | -------- | -------- |
| oura-mcp     | `oura-mcp`         | `../oura_mcp/`                         | no       | no       |
| therapy-mcp  | `therapy-mcp`      | `../sessions_health_mcp/`              | no       | no       |
| otf-mcp      | `otf-mcp`          | `../otf_mcp/`                          | no       | no       |
| gmail-mcp    | `gmail-mcp-worker` | `../gmail_mcp/gmail-mcp-worker/`       | no       | no       |

Migration order is fixed: scaffolding → oura → therapy → otf → gmail. Each
app must deploy and run cleanly for 24 hours before the next begins.

## Common commands

| Command                          | What it does                                                |
| -------------------------------- | ----------------------------------------------------------- |
| `pnpm install`                   | Install all workspace dependencies                          |
| `pnpm type-check`                | Run `tsc --noEmit` across every package and app             |
| `pnpm test`                      | Run vitest across every package and app                     |
| `pnpm deploy:oura` (etc.)        | Deploy one app via its wrangler config                      |

## Adding a new MCP

1. Create `apps/<name>/` with `wrangler.jsonc`, `src/index.ts`, `package.json`,
   `tsconfig.json` extending `../../tsconfig.base.json`.
2. Pick an auth package (or write a new one if no existing pattern fits).
3. Wire up `createMcpHandler` from `@mcp-stack/mcp-core`, register tools, deploy.

The packages exist so this stays a wire-up exercise, not a rebuild.

## Repo conventions

- Node 20+, pnpm 10+
- ESM only (`"type": "module"` everywhere)
- TypeScript strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`
- No build step at the package level — wrangler bundles TypeScript source directly
- Per-app secrets via `wrangler secret put`; nothing committed
