# otf-mcp

Cloudflare Worker MCP server for Orangetheory Fitness: browse classes, book,
cancel, list bookings, and pull historical performance data. Optional Google
Calendar integration auto-creates "WO" / "PWO" busy blocks on each booking.

## Tools

| Tool | What it does |
|---|---|
| `otf_search_studios` | Find studios by name/city/zip. |
| `otf_list_classes` | List class schedule for a studio + date range. |
| `otf_class_filter` | Server-side filter over `list_classes` (coach, time-of-day bucket, day-of-week, exclude-already-booked). |
| `otf_book_class` / `otf_cancel_booking` | Book or cancel. Booking optionally creates WO/PWO calendar blocks; cancellation removes them. |
| `otf_list_bookings` | Upcoming + recent bookings. |
| `otf_member_info` | Your member profile + home studio. |
| `otf_performance_trend` | Heart-rate-zone history across recent classes. |
| `otf_calendar_test` | Verification: writes and immediately deletes a dummy calendar event. |

## Deploy

```bash
# OTF auth — captured once via a local bootstrap script (AWS Cognito SRP)
pnpm bootstrap-auth                          # interactive: prompts for OTF email + password
# the script prints the two values below; paste them into:
wrangler secret put OTF_REFRESH_TOKEN
wrangler secret put OTF_DEVICE_KEY

# Path-secret gate
wrangler secret put MCP_PATH_SECRET          # 32-byte URL-safe random

# Optional Google Calendar integration (set all five to enable):
pnpm google-auth                             # OAuth flow → prints refresh token
wrangler secret put GOOGLE_OAUTH_CLIENT_ID
wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
wrangler secret put GOOGLE_OAUTH_REFRESH_TOKEN
wrangler secret put GOOGLE_CALENDAR_ID       # usually `primary`
wrangler secret put OTF_CALENDAR_ATTENDEE    # email to cross-post busy blocks to

pnpm deploy
```

## Use

URL pattern: `https://otf-mcp.<your-subdomain>.workers.dev/s/<MCP_PATH_SECRET>/mcp`

## Architecture

- `src/index.ts` — Worker entry.
- `src/server.ts` — `Env` interface, MCP server builder.
- `src/otf/*.ts` — OTF API client, endpoints, calendar integration.
- `src/tools/*.ts` — One file per tool.
- `scripts/bootstrap-auth.ts` — One-shot Cognito SRP login to capture the refresh token (runs locally, not in the Worker, because Workers runtime can't do SRP crypto).
- `scripts/google-auth.ts` — OAuth flow to capture a Google refresh token.

Auth is provided by `@mcp-stack/auth-cognito` (refresh-token only). Calendar
auth is provided by `@mcp-stack/auth-oauth-google`.
