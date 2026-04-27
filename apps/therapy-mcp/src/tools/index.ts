import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthEnv } from "../sh/auth.js";
import { registerMemberInfoTool } from "./member_info.js";
import { registerListAvailabilityTool } from "./list_availability.js";
import { registerListAppointmentsTool } from "./list_appointments.js";
import { registerBookAppointmentTool } from "./book_appointment.js";
import { registerCancelAppointmentTool } from "./cancel_appointment.js";

export function registerAllTools(server: McpServer, env: AuthEnv): void {
  registerMemberInfoTool(server, env);
  registerListAvailabilityTool(server, env);
  registerListAppointmentsTool(server, env);
  registerBookAppointmentTool(server, env);
  registerCancelAppointmentTool(server, env);
}
