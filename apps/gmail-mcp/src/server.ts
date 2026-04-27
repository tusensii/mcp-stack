import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildGmailClient } from "./gmail.js";
import { registerAllTools } from "./tools/index.js";
import type { Env } from "./types.js";

export function buildServer(env: Env): McpServer {
  const server = new McpServer({
    name: "gmail-mcp",
    version: "1.0.0",
  });

  const gmail = buildGmailClient(env);
  registerAllTools(server, gmail);

  return server;
}
