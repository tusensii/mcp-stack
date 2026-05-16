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
}

export function buildServer(env: Env): McpServer {
  const server = new McpServer({
    name: "github-mcp",
    version: "0.1.0",
  });

  const client = new GitHubClient(env.GITHUB_TOKEN);
  registerAllTools(server, client, env.GITHUB_DEFAULT_REPO);

  return server;
}
