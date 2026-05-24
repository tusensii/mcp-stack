import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GitHubClient } from "./github/client.js";
import { registerAllTools } from "./tools/index.js";

export interface Env {
  /** Personal access token. Classic or fine-grained — fine-grained recommended. */
  GITHUB_TOKEN: string;
  /** URL-path secret gating the Worker. Minimum 16 chars. */
  MCP_PATH_SECRET: string;
  /**
   * Default `owner/repo` used when a tool call omits the `repo` arg.
   * Optional — without it, every tool call must pass `repo`.
   */
  GITHUB_DEFAULT_REPO?: string;
  /**
   * Comma-separated label names automatically applied to every issue created
   * via `github_create_issue`. Merged with caller-supplied labels (deduped).
   * Optional — empty/unset means no default labels.
   */
  GITHUB_DEFAULT_LABELS?: string;
  /**
   * Comma-separated `owner/repo` allowlist. When set, tool calls targeting
   * any other repo are rejected before hitting the GitHub API.
   * `GITHUB_DEFAULT_REPO`, if set, is implicitly included. Optional — unset
   * means no Worker-level restriction (the PAT scope is the only gate).
   */
  GITHUB_ALLOWED_REPOS?: string;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseAllowedRepos(
  raw: string | undefined,
  defaultRepo: string | undefined,
): Set<string> | undefined {
  const list = parseCsv(raw).map((s) => s.toLowerCase());
  if (defaultRepo) list.push(defaultRepo.toLowerCase());
  if (list.length === 0) return undefined;
  return new Set(list);
}

export function buildServer(env: Env): McpServer {
  const server = new McpServer({
    name: "github-mcp",
    version: "0.1.0",
  });

  const client = new GitHubClient(env.GITHUB_TOKEN);
  registerAllTools(
    server,
    client,
    env.GITHUB_DEFAULT_REPO,
    parseCsv(env.GITHUB_DEFAULT_LABELS),
    parseAllowedRepos(env.GITHUB_ALLOWED_REPOS, env.GITHUB_DEFAULT_REPO),
  );

  return server;
}
