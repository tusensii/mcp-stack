import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthEnv } from "../otf/auth.js";
import { registerMemberInfoTool } from "./member_info.js";
import { registerSearchStudiosTool } from "./search_studios.js";
import { registerListClassesTool } from "./list_classes.js";
import { registerListBookingsTool } from "./list_bookings.js";
import { registerBookClassTool } from "./book_class.js";
import { registerCancelBookingTool } from "./cancel_booking.js";

export function registerAllTools(server: McpServer, env: AuthEnv): void {
  registerMemberInfoTool(server, env);
  registerSearchStudiosTool(server, env);
  registerListClassesTool(server, env);
  registerListBookingsTool(server, env);
  registerBookClassTool(server, env);
  registerCancelBookingTool(server, env);
}
