import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/index.js";

export interface Env {
  OTF_REFRESH_TOKEN: string;
  OTF_DEVICE_KEY: string;
  MCP_PATH_SECRET: string;
  // Optional: Google Calendar integration. When all four are set, OTF
  // booking creates WO/PWO blocks and cancellation removes them.
  // Tools degrade gracefully (skip + note) if any are missing.
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REFRESH_TOKEN?: string;
  GOOGLE_CALENDAR_ID?: string;
  // Email address to attach as attendee on WO/PWO calendar blocks.
  // Required for the calendar integration to activate; absence triggers
  // the same graceful skip as missing GOOGLE_* secrets.
  OTF_CALENDAR_ATTENDEE?: string;
}

export function buildServer(env: Env): McpServer {
  const server = new McpServer({
    name: "otf-mcp",
    version: "0.1.0",
  });

  registerAllTools(server, env);
  return server;
}
