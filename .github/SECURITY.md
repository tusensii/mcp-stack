# Security Policy

## Reporting a Vulnerability

Please report vulnerabilities privately. **Do not open a public GitHub issue.**

Email: `cmichaelpetrie+mcp-stack-security@gmail.com`

Expected response time: within 7 days. I'll acknowledge the report,
investigate, and coordinate a fix or mitigation before any public disclosure.

## Scope

This is a personal project — no SLA, no bug bounty. Reports are appreciated
all the same.

In scope:
- Anything in `packages/*` (the shared auth/http/observability primitives).
- The `MCP_PATH_SECRET` gating in `packages/mcp-core` (constant-time compare,
  path parsing).
- Credential-handling logic in any app.
- Path-injection or argument-injection in `apps/github-mcp` tools (repo
  resolver regex, label encoding, etc.).
- Transitive-dependency CVEs not already pinned via `pnpm.overrides` in the
  root `package.json`.

Out of scope:
- Anything requiring the attacker to already hold a valid `MCP_PATH_SECRET`
  or Cloudflare account credentials.
- Upstream services (Oura, OTF, Sessions Health, Gmail). Report those to
  the respective vendor.
