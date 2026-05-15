# therapy-mcp

Cloudflare Worker MCP server for Sessions Health (`sessionshealth.com`),
a Rails-based therapy practice portal. Lets an LLM view, book, cancel,
and reschedule appointments via the same flows a logged-in patient uses.

## Tools

| Tool | What it does |
|---|---|
| `therapy_list_availability` | Open appointment slots in a date range. |
| `therapy_book_appointment` | Submit a new appointment request (PENDING until practitioner accepts). |
| `therapy_list_appointments` | Confirmed + pending + cancelled appointments in one unified shape. |
| `therapy_cancel_appointment` | Cancel an appointment by ID. |
| `therapy_reschedule` | Atomic move between slots — book new, then cancel old, with loud warning if cleanup fails. |
| `therapy_member_info` | Profile + practice info + practitioner + locations + portal features. |

## Deploy

```bash
# Sessions Health credentials
wrangler secret put STC_EMAIL
wrangler secret put STC_PASSWORD
wrangler secret put STC_BASE_URL                # e.g. https://YOUR_PRACTICE.sessionshealth.com

# Path-secret gate
wrangler secret put MCP_PATH_SECRET             # 32-byte URL-safe random

# Optional display label (defaults to "your therapist")
wrangler secret put PRACTITIONER_DISPLAY_NAME

pnpm deploy
```

## Use

URL pattern: `https://therapy-mcp.<your-subdomain>.workers.dev/s/<MCP_PATH_SECRET>/mcp`

## Architecture

- `src/index.ts` — Worker entry.
- `src/server.ts` — `Env` interface, MCP server builder.
- `src/sh/auth.ts` — Sessions Health login + practitioner/service-code
  discovery flow (GET `/clients/me` → `/clients/{id}/appointments`,
  preferring CPT 90834 "Individual Therapy" over consultation slots).
- `src/sh/client.ts` — `shGet`/`shPost`/`shPatch` wrappers with the
  XHR headers Sessions Health requires for writes.
- `src/sh/endpoints.ts` — One function per portal endpoint.
- `src/tools/*.ts` — One file per tool.

Auth is provided by `@mcp-stack/auth-rails` — Devise-style sign-in with
dual CSRF tokens (form + meta) and auto re-auth on 401.
