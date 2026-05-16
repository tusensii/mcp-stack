# CLAUDE.md

Conventions for Claude Code sessions working in this repo. Read this
before picking up issues or proposing changes.

## Issue-driven self-repair workflow

The `apps/github-mcp` Worker exposes GitHub Issues tooling to Claude.ai
(via a custom connector). The workflow:

1. While using any of the deployed MCPs, Claude.ai notices a bug or
   improvement and files an issue against `tusensii/mcp-stack` using
   `github_create_issue`.
2. A Claude Code session in this repo pulls the queue with
   `gh issue list --label claude-task` and addresses one issue per branch
   / PR.
3. Closing the issue happens via `Closes #N` in the PR description.

### Title format

`[<app-name>] <imperative summary>`

Examples:
- `[oura-mcp] Description of oura_sleep_detail mentions stage durations in minutes but values are seconds`
- `[github-mcp] Add github_create_pull_request tool`
- `[packages/http-fetch] Honor Retry-After on 503 in addition to 429`

The prefix is what makes the queue scannable in `gh issue list`.

### Body format

Two sections, in this order:

```
## Why
<1-3 sentences on the motivation — the observed symptom or the use case>

## Acceptance criteria
- <specific, testable condition 1>
- <specific, testable condition 2>
```

Do **not** include a proposed fix in the issue body. Describe the symptom
and the desired behavior; the fix is decided in the PR.

### Labels

- `claude-task` — required on every issue Claude Code should pick up. This
  is the queue filter.
- `bug` xor `enhancement` — exactly one. Bugs are "current behavior contradicts
  documented behavior"; everything else is `enhancement`.
- `app:<app-name>` — e.g. `app:oura-mcp`. Useful once cross-app issues land.

Labels must exist on the repo before `github_create_issue` can apply them.
Create them once via the GitHub UI; after that the MCP can use them freely.

### Assignees

Don't assign issues. Claude Code filters on `claude-task`, not assignee.
Assigning the repo owner just clutters their notifications.

## Picking up an issue (Claude Code side)

```bash
gh issue list --label claude-task --state open
gh issue view <N>
git checkout -b issue-<N>-<short-slug>
# work
gh pr create --title "[<app>] <summary>" --body "Closes #<N>\n\n<changes>"
```

One issue → one branch → one PR. If an issue is too large for one PR,
file follow-up issues; don't pile changes into one branch.

## Repo conventions (general)

- Node 20+, pnpm 10+, ESM only.
- TypeScript strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`.
- No build step at the package level — Wrangler bundles app source directly.
- Per-app secrets via `wrangler secret put` from the app directory.
  Workspace-level wrangler isn't installed; use `pnpm wrangler` inside an
  app dir so it picks up that app's `wrangler.jsonc`.
- Transitive-CVE fixes go in `pnpm.overrides` in the root `package.json`
  until upstream re-pins; leave a comment noting which CVE / upstream issue.
- Run `pnpm -r type-check` and `pnpm -r test` before opening a PR.

## What lives where

- `packages/*` — reusable primitives. Generic enough that any app could
  consume them. New apps should reach for these before reinventing.
- `apps/*` — one Cloudflare Worker each. Independent at runtime; no shared
  state, no shared KV, no shared Durable Objects.
- Private siblings (therapy-mcp, otf-mcp) live in `tusensii/mcp-stack-private`
  and are out of scope for this repo. Don't reference them in public code or
  issues.

## Wrangler operations Claude Code may run autonomously

- `pnpm wrangler deploy` — from an app dir.
- `pnpm wrangler tail` — for live log streaming during smoke tests.
- `pnpm wrangler secret list` — names only; safe.
- `pnpm wrangler whoami`.

**Credential `secret put` (PATs, OAuth refresh tokens, API keys) is
always done by the user.** Non-credential `secret put` (e.g. updating
`GITHUB_DEFAULT_REPO`) may be done by Claude Code via stdin redirect.
