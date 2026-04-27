import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthEnv } from "../otf/auth.js";
import { searchStudiosByGeo } from "../otf/endpoints.js";
import type { StudioOutput } from "../otf/types.js";
import { textContent, errorContent } from "./utils.js";
import { OtfApiError } from "../otf/client.js";

export function registerSearchStudiosTool(server: McpServer, env: AuthEnv): void {
  server.tool(
    "otf_search_studios",
    "Find OTF studios near a location. Requires lat/lon — geocode location names " +
    "using your own knowledge or web search before calling. " +
    "For the user's home studio, use otf_member_info instead.",
    {
      latitude: z.number().describe("Latitude of the search center (required)."),
      longitude: z.number().describe("Longitude of the search center (required)."),
      distance_miles: z
        .number()
        .optional()
        .default(25)
        .describe("Search radius in miles. Default 25. OTF studios are sparse — small radii may return nothing."),
      max_results: z.number().int().min(1).max(50).optional().default(10).describe("Max results to return. Default 10."),
    },
    async ({ latitude, longitude, distance_miles, max_results }) => {
      try {
        const studios = await searchStudiosByGeo(latitude, longitude, distance_miles, env);
        const results: StudioOutput[] = studios.slice(0, max_results).map(s => ({
          studio_uuid: s.studioUUId,
          studio_name: s.studioName ?? "",
          address: {
            street: s.studioLocation.address1 ?? "",
            city: s.studioLocation.city ?? "",
            state: s.studioLocation.state ?? "",
            postal_code: s.studioLocation.postalCode ?? "",
            country: s.studioLocation.country ?? "",
          },
          timezone: s.timeZone ?? "UTC",
          phone: s.studioLocation.phoneNumber ?? "",
          distance_miles: s.distance,
        }));
        return textContent(results);
      } catch (e) {
        if (e instanceof OtfApiError) return errorContent(e.message);
        if (e instanceof Error) return errorContent(e.message);
        throw e;
      }
    },
  );
}
