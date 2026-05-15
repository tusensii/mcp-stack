import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../sh/auth.js";
import {
  createAppointmentRequest,
  fetchOrganizationsCurrent,
} from "../sh/endpoints.js";
import {
  textContent,
  errorContent,
  toUtc,
  addMinutesToIso,
  formatLocation,
} from "./utils.js";
import type { AuthEnv } from "../sh/auth.js";

const DURATION_MINUTES = 50;
const TIMEZONE = "America/Los_Angeles";

export function registerBookAppointmentTool(
  server: McpServer,
  env: AuthEnv
): void {
  const practitionerName = env.PRACTITIONER_DISPLAY_NAME ?? "your therapist";
  server.tool(
    "therapy_book_appointment",
    `Submit a therapy appointment request with ${practitionerName}. Returns a PENDING request — the practitioner must accept manually. You'll receive an email when confirmed. Use starts_at_utc from therapy_list_availability.`,
    {
      starts_at_utc: z
        .string()
        .describe(
          "ISO 8601 UTC timestamp for appointment start (e.g. '2026-04-22T01:00:00.000Z'). Must match an available slot from therapy_list_availability."
        ),
      location_id: z
        .number()
        .optional()
        .describe(
          "Location ID. 29900 = Eastlake Office (default), 29902 = Telehealth."
        ),
    },
    async ({ starts_at_utc, location_id }) => {
      try {
        const session = await getSession(env);
        const org = await fetchOrganizationsCurrent(env);

        const result = await createAppointmentRequest(
          env,
          starts_at_utc,
          location_id
        );

        const ar = result.appointment_request;
        const locationId =
          ar.location_id ?? location_id ?? session.defaultLocationId;
        const loc = org.locations.find((l) => l.id === locationId);
        const location = loc
          ? formatLocation(loc)
          : { id: locationId, name: "Unknown", phone: "" };

        const startsAtLocal = ar.starts_at;
        const endsAtLocal =
          ar.ends_at ?? addMinutesToIso(startsAtLocal, DURATION_MINUTES);
        const endsAtUtc = toUtc(endsAtLocal);

        const deadlineMs =
          new Date(startsAtLocal).getTime() -
          session.cancellationWindowHours * 60 * 60 * 1000;

        return textContent({
          appointment_request_id: ar.id,
          status: ar.status,
          starts_at_local: startsAtLocal,
          starts_at_utc: toUtc(startsAtLocal),
          ends_at_local: endsAtLocal,
          ends_at_utc: endsAtUtc,
          duration_minutes: DURATION_MINUTES,
          timezone: TIMEZONE,
          location,
          practitioner_name: practitionerName,
          service_name: "Individual Therapy",
          cancellation_deadline_local: addMinutesToIso(
            startsAtLocal,
            -session.cancellationWindowHours * 60
          ),
          cancellation_deadline_utc: new Date(deadlineMs).toISOString(),
          note: `Pending practitioner acceptance. You'll receive a confirmation email from Sessions Health when ${practitionerName} accepts.`,
        });
      } catch (e) {
        return errorContent(e instanceof Error ? e.message : String(e));
      }
    }
  );
}
