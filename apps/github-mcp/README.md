# github-mcp

Cloudflare Worker MCP server for full GitHub Issues management. Built so
Claude.ai (or any MCP client) can file, triage, and close issues against
any repo the configured PAT can reach — with a default repo baked in
for one-shot "open an issue" workflows.

## Tools

### Issues
| Tool | What it does |
|---|---|
| `github_create_issue` | Open a new issue (title, body, labels, assignees, milestone). |
| `github_get_issue` | Fetch one issue by number. |
| `github_list_issues` | List issues with state/label/assignee/creator filters. |
| `github_update_issue` | Edit title, body, state, labels, assignees, milestone. Supports `state_reason`. |
| `github_lock_issue` / `github_unlock_issue` | Lock/unlock conversation. |

### Comments
| Tool | What it does |
|---|---|
| `github_add_issue_comment` | Post a comment. |
| `github_list_issue_comments` | List comments on an issue. |
| `github_update_issue_comment` | Edit a comment by ID. |
| `github_delete_issue_comment` | Delete a comment by ID. |

### Labels
| Tool | What it does |
|---|---|
| `github_add_labels` | Additive — keeps existing labels. |
| `github_set_labels` | Replaces the full label set. |
| `github_remove_label` | Remove a single label from one issue. |
| `github_list_repo_labels` | List labels defined on a repo. |
| `github_create_label` | Create a repo-level label (name + hex color, optional description). |
| `github_update_label` | Rename / recolor / re-describe an existing repo label. |
| `github_delete_label` | Delete a repo label. Cascades: also removes it from every issue using it. |

### Assignees
| Tool | What it does |
|---|---|
| `github_add_assignees` | Additive assignment. |
| `github_remove_assignees` | Remove specific users. |

### Search
| Tool | What it does |
|---|---|
| `github_search_issues` | Cross-repo search using GitHub's query syntax. |

## Deploy

```bash
cd apps/github-mcp

# GitHub PAT — https://github.com/settings/tokens
# Fine-grained recommended. Required scope: Issues (read/write) on the
# repos you want to manage. Classic PATs need 'repo' scope.
pnpm wrangler secret put GITHUB_TOKEN

# URL-path gate — generate with: openssl rand -base64 32 | tr -d '/+=' | head -c 32
pnpm wrangler secret put MCP_PATH_SECRET

# Optional but recommended: default repo for tools called without 'repo' arg
pnpm wrangler secret put GITHUB_DEFAULT_REPO   # e.g. tusensii/mcp-stack

pnpm deploy
```

## Connect from Claude.ai

Settings → Connectors → Add custom connector

- **URL:** `https://github-mcp.<your-subdomain>.workers.dev/s/<MCP_PATH_SECRET>/mcp`
- **Auth:** none (the path secret gates access)

After connecting, in any conversation enable the connector and ask Claude
to file an issue. Without an explicit `repo` arg it'll target
`GITHUB_DEFAULT_REPO`.

## Architecture

- `src/index.ts` — Worker entry (shared `createMcpWorker`).
- `src/server.ts` — `Env` interface; builds `GitHubClient` and registers tools.
- `src/github/client.ts` — REST wrapper over `api.github.com`. Sends the
  standard `Accept: application/vnd.github+json` and
  `X-GitHub-Api-Version` headers. Auth via `@mcp-stack/auth-bearer`.
- `src/tools/utils.ts` — `resolveRepo` (arg or default), shared error handler.
- `src/tools/{issues,comments,labels,assignees,search}.ts` — one module per
  resource area.

## Security notes

The PAT is broad by design (Christopher's full account) so this MCP can
review or act on any of his repos. The Worker is gated behind a
URL-path secret, CORS-locked to `https://claude.ai`, and only ever
holds the token in the Wrangler secret store. If the path secret leaks,
rotate it via `pnpm wrangler secret put MCP_PATH_SECRET`; if the PAT
leaks, revoke at https://github.com/settings/tokens and re-issue.
