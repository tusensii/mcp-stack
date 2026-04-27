import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export interface Env {
  STC_EMAIL: string;
  STC_PASSWORD: string;
  MCP_PATH_SECRET: string;
}

export function buildServer(env: Env): McpServer {
  const server = new McpServer({
    name: "therapy-mcp",
    version: "0.1.0",
  });
  registerAllTools(server, env);
  return server;
}
