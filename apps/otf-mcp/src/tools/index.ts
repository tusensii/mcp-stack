import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../server.js";
import { registerMemberInfoTool } from "./member_info.js";
import { registerSearchStudiosTool } from "./search_studios.js";
import { registerListClassesTool } from "./list_classes.js";
import { registerListBookingsTool } from "./list_bookings.js";
import { registerBookClassTool } from "./book_class.js";
import { registerCancelBookingTool } from "./cancel_booking.js";
import { registerClassFilterTool } from "./class_filter.js";
import { registerPerformanceTrendTool } from "./performance_trend.js";
import { registerCalendarTestTool } from "./calendar_test.js";

export function registerAllTools(server: McpServer, env: Env): void {
  registerMemberInfoTool(server, env);
  registerSearchStudiosTool(server, env);
  registerListClassesTool(server, env);
  registerListBookingsTool(server, env);
  registerBookClassTool(server, env);
  registerCancelBookingTool(server, env);
  registerClassFilterTool(server, env);
  registerPerformanceTrendTool(server, env);
  // Only registers if the four GOOGLE_OAUTH_* + GOOGLE_CALENDAR_ID secrets are present.
  registerCalendarTestTool(server, env);
}
