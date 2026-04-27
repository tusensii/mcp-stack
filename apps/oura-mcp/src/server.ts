import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { OuraClient } from "./oura/client.js";
import { registerAllTools } from "./tools/index.js";

export interface Env {
  OURA_PAT: string;
  MCP_PATH_SECRET: string;
}

export function buildServer(env: Env): McpServer {
  const server = new McpServer({
    name: "oura-mcp",
    version: "0.1.0",
  });

  const client = new OuraClient(env.OURA_PAT);
  registerAllTools(server, client);

  return server;
}
