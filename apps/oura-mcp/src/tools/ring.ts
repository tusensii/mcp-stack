import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getRingConfiguration } from "../oura/endpoints.js";
import { textContent, errorContent } from "./utils.js";

export function registerRingTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_ring_configuration",
    "Returns hardware and firmware information about your Oura ring: size, color, design, firmware version.",
    {},
    async () => {
      try {
        const data = await getRingConfiguration(client);
        return textContent(data.data);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
