import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export interface Env {
  OTF_REFRESH_TOKEN: string;
  OTF_DEVICE_KEY: string;
  MCP_PATH_SECRET: string;
}

export function buildServer(env: Env): McpServer {
  const server = new McpServer({
    name: "otf-mcp",
    version: "0.1.0",
  });

  registerAllTools(server, env);
  return server;
}
