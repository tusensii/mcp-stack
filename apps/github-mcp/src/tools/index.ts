import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubClient } from "../github/client.js";
import { registerIssueTools } from "./issues.js";
import { registerCommentTools } from "./comments.js";
import { registerLabelTools } from "./labels.js";
import { registerAssigneeTools } from "./assignees.js";
import { registerSearchTools } from "./search.js";

export function registerAllTools(
  server: McpServer,
  client: GitHubClient,
  defaultRepo: string | undefined,
): void {
  registerIssueTools(server, client, defaultRepo);
  registerCommentTools(server, client, defaultRepo);
  registerLabelTools(server, client, defaultRepo);
  registerAssigneeTools(server, client, defaultRepo);
  registerSearchTools(server, client);
}
