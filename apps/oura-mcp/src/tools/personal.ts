import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getPersonalInfo } from "../oura/endpoints.js";
import { textContent, errorContent } from "./utils.js";

export function registerPersonalTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_personal_info",
    "Returns your Oura profile: age, weight (kg), height (m), biological sex, and email.",
    {},
    async () => {
      try {
        const data = await getPersonalInfo(client);
        return textContent(data);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
