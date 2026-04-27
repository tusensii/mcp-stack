import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSession } from "../sh/auth.js";
import { fetchClientsMe, fetchOrganizationsCurrent } from "../sh/endpoints.js";
import { textContent, errorContent, formatLocation } from "./utils.js";
import type { AuthEnv } from "../sh/auth.js";

export function registerMemberInfoTool(server: McpServer, env: AuthEnv): void {
  server.tool(
    "therapy_member_info",
    "Returns your Sessions Health profile: client details, practice info, practitioner, service code, locations, and portal features. Use for debugging or introspection.",
    {},
    async () => {
      try {
        const [session, me, org] = await Promise.all([
          getSession(env),
          fetchClientsMe(env),
          fetchOrganizationsCurrent(env),
        ]);

        const locations = org.locations.map(formatLocation);

        return textContent({
          client: {
            id: me.client.id,
            name: me.client.name,
            email: me.client.email,
            timezone: me.client.time_zone,
          },
          practice: {
            name: me.organization.name,
            phone: org.organization.phone_number,
            timezone: me.organization.time_zone,
          },
          practitioner: {
            name: "your therapist",
            availability_id: session.availabilityId,
          },
          service: {
            id: session.serviceCodeId,
            name: "Individual Therapy",
            code: "90834",
            duration_minutes: 50,
          },
          locations,
          default_location_id: session.defaultLocationId,
          cancellation_window_hours: session.cancellationWindowHours,
          portal_features: me.client.portal_features,
        });
      } catch (e) {
        return errorContent(e instanceof Error ? e.message : String(e));
      }
    }
  );
}
