# oura-mcp

Cloudflare Worker MCP server exposing the Oura Ring v2 API plus a layer of
analytics on top (rolling baselines, correlations, anomaly detection,
recovery forecasts). 22 tools total — the largest app in the stack.

## Tools

### Raw metrics (pass-through to Oura v2)
`oura_sleep`, `oura_readiness`, `oura_activity`, `oura_heartrate`,
`oura_workout`, `oura_session`, `oura_stress`, `oura_resilience`,
`oura_spo2`, `oura_vo2max`, `oura_tag`, `oura_ring_config`,
`oura_personal_info`, `oura_daily_summary`

### Analytics (computed over Oura data)
| Tool | What it does |
|---|---|
| `oura_baseline_compare` | Current vs personal rolling baseline (mean ± stddev → z-score). |
| `oura_period_compare` | Two arbitrary date ranges side-by-side. |
| `oura_correlation` | Pearson over a date range with optional lag; supports `tag:<name>` as a binary metric. |
| `oura_intervention_analysis` | Before/after a date with a configurable exclusion window for transition noise. |
| `oura_anomaly_detect` | Rolling z-score scan with configurable threshold. |
| `oura_recovery_forecast` | Linear-fit + 50% regression-to-mean for tomorrow's readiness, with confidence band. |
| `oura_alcohol_impact` | Tag-day vs non-tag-day comparison across HRV/deep sleep/RHR/readiness, plus HRV recovery estimate. |
| `oura_weekly_digest` | Composite weekly summary with rule-based highlights + watch-outs. |

## Deploy

```bash
# Oura PAT — https://cloud.ouraring.com/personal-access-tokens
# NOTE: Oura deprecated personal access tokens in December 2025 and no
# longer issues new ones. See "Auth status" below before relying on this.
wrangler secret put OURA_PAT

# Path-secret gate
wrangler secret put MCP_PATH_SECRET    # 32-byte URL-safe random

pnpm deploy
```

## Use

URL pattern: `https://oura-mcp.<your-subdomain>.workers.dev/s/<MCP_PATH_SECRET>/mcp`

## Architecture

- `src/index.ts` — Worker entry.
- `src/server.ts` — `Env` interface, builds `OuraClient`, MCP server builder.
- `src/oura/client.ts` — Thin REST client over the Oura v2 API.
- `src/oura/stats.ts` — Shared math: mean, median, stddev, z-score, Pearson,
  linear-fit, percentile-from-z (Abramowitz–Stegun). Kept in the app until a
  third non-trivial consumer needs the same primitives.
- `src/oura/metrics.ts` — Maps the documented metric union to the right Oura
  endpoint, plus `mainSleepPerDay()` for canonical sleep-period selection.
- `src/tools/*.ts` — One file per tool.

Auth is provided by `@mcp-stack/auth-bearer` (static PAT).

## Auth status (PAT deprecation)

The Oura API v2 spec (`openapi-1.37`) states that personal access tokens
were deprecated in December 2025 and can no longer be created. The PAT this
Worker uses was issued before that cutoff and is **grandfathered**: as of
2026-08-29 it still authenticates every endpoint (verified live — daily
scores, sleep periods and HRV series all returned current data; see #62).
Oura has not published a sunset date for existing tokens.

Implications:

- Do not revoke or regenerate `OURA_PAT` — a replacement cannot be issued.
  If it is ever lost or rejected (HTTP 401 on every call), the only path
  forward is the OAuth2 migration tracked in #63.
- OAuth2 migration is blocked on a manual owner step: registering an OAuth
  application at https://cloud.ouraring.com/oauth/applications to obtain a
  client id/secret. Once that exists, the plan is a one-shot bootstrap
  script (authorization-code flow → refresh token stored as a Wrangler
  secret) and refresh-on-401 in `OuraClient`, with no tool schema changes.
- Re-check cadence: nothing to re-verify unless calls start failing with
  401. A 401 from `api.ouraring.com` with a token that previously worked
  means the grandfathering ended.
