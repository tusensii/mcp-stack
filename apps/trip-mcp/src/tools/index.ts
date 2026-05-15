import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../types.js";
import { registerFindAreasTools } from "./find_areas.js";
import { registerPermitTools } from "./permits.js";
import { registerWeatherTools } from "./weather.js";
import { registerConditionsTools } from "./conditions.js";
import { registerTripReportTools } from "./trip_reports.js";
import { registerRouteInfoTools } from "./route_info.js";
import { registerSafetyTools } from "./safety.js";
import { registerWebResearchTools } from "./web_research.js";
import { registerResearchTripTool } from "./research_trip.js";

export function registerAllTools(server: McpServer, env: Env): void {
  registerFindAreasTools(server, env);
  registerPermitTools(server, env);
  registerWeatherTools(server, env);
  registerConditionsTools(server, env);
  registerTripReportTools(server, env);
  registerRouteInfoTools(server, env);
  registerSafetyTools(server, env);
  registerWebResearchTools(server, env);
  registerResearchTripTool(server, env);
}
