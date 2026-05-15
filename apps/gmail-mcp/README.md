# gmail-mcp

Cloudflare Worker MCP server exposing Gmail read/compose/label/filter operations
to LLM clients. Auth via Google OAuth refresh-token; no SMTP, no IMAP.

## Tools

| Tool | What it does |
|---|---|
| `gmail_list_emails` / `gmail_get_email` | Search inbox via Gmail's `q` syntax; fetch full message body + headers. |
| `gmail_compose` | Draft or send a message. Supports threading via `In-Reply-To`. |
| `gmail_modify` | Apply/remove labels on a message. |
| `gmail_delete` | Trash or permanently delete. |
| `gmail_labels` | List, create, rename, delete labels. |
| `gmail_filters` | List, create, delete server-side filters. |

## Deploy

```bash
# OAuth credentials (one-time, via Google Cloud Console "Desktop app" client)
wrangler secret put GMAIL_OAUTH_KEYS       # JSON: { "client_id": ..., "client_secret": ..., "redirect_uris": [...] }
wrangler secret put GMAIL_CREDENTIALS      # JSON: { "refresh_token": "..." } captured via OAuth flow

# Path-secret gate
wrangler secret put URL_SECRET             # 32-byte URL-safe random

pnpm deploy
```

## Use

URL pattern: `https://gmail-mcp-worker.<your-subdomain>.workers.dev/s/<URL_SECRET>/mcp`

Add as a custom connector in claude.ai → Settings → Connectors.

## Architecture

- `src/index.ts` — Worker entry, delegates to `@mcp-stack/mcp-core/worker`.
- `src/gmail.ts` — Builds a `googleapis.gmail` client from the OAuth credentials.
- `src/tools/*.ts` — One file per tool, each registers a Zod-schema'd handler.

Auth is provided by `@mcp-stack/auth-oauth-google`, which wraps the refresh
flow and translates expired credentials into `AuthExpired`.
