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
}

function parseDefaultLabels(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function buildServer(env: Env): McpServer {
  const server = new McpServer({
    name: "github-mcp",
    version: "0.1.0",
  });

  const client = new GitHubClient(env.GITHUB_TOKEN);
  registerAllTools(server, client, env.GITHUB_DEFAULT_REPO, parseDefaultLabels(env.GITHUB_DEFAULT_LABELS));

  return server;
}
