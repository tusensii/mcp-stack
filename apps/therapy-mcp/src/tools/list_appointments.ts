import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchAppointments, fetchOrganizationsCurrent } from "../sh/endpoints.js";
import { getSession } from "../sh/auth.js";
import {
  textContent,
  errorContent,
  toUtc,
  toLocalIso,
  addMinutesToIso,
  formatLocation,
} from "./utils.js";
import type { AuthEnv } from "../sh/auth.js";
import type { LocationFull } from "../sh/types.js";

const TIMEZONE = "America/Los_Angeles";

export function registerListAppointmentsTool(
  server: McpServer,
  env: AuthEnv
): void {
  server.tool(
    "therapy_list_appointments",
    "Returns your therapy appointments: confirmed (accepted by Chris) and pending (submitted but not yet accepted). Defaults to upcoming within 90 days. IMPORTANT: pending appointments require Chris to manually accept — do NOT tell the user they are 'booked' for pending ones.",
    {
      include_past: z
        .boolean()
        .optional()
        .describe("Include past appointments, defaults to false"),
      days_ahead: z
        .number()
        .optional()
        .describe("Days ahead to fetch, defaults to 90"),
      days_back: z
        .number()
        .optional()
        .describe("Days back to include when include_past=true, defaults to 30"),
    },
    async ({ include_past = false, days_ahead = 90, days_back = 30 }) => {
      try {
        const session = await getSession(env);
        const [data, org] = await Promise.all([
          fetchAppointments(env),
          fetchOrganizationsCurrent(env),
        ]);

        const now = Date.now();
        const cutoffFuture = now + days_ahead * 24 * 60 * 60 * 1000;
        const cutoffPast = include_past
          ? now - days_back * 24 * 60 * 60 * 1000
          : now;

        const locationMap = new Map<number, LocationFull>(
          org.locations.map((l) => [l.id, l])
        );

        const practitionerMap = new Map<number, string>(
          data.users.map((u) => [u.id, u.name])
        );

        const confirmed = data.events
          .filter((e) => {
            const startMs = new Date(e.starts_at).getTime();
            return startMs >= cutoffPast && startMs <= cutoffFuture;
          })
          .map((e) => {
            const startsAtLocal = e.starts_at;
            const endsAtLocal = e.ends_at;
            const startsAtUtc = toUtc(startsAtLocal);
            const endsAtUtc = toUtc(endsAtLocal);

            const durationMs =
              new Date(endsAtLocal).getTime() -
              new Date(startsAtLocal).getTime();
            const durationMinutes = Math.round(durationMs / 60_000);

            const loc = locationMap.get(e.location_id);
            const location = loc
              ? formatLocation(loc)
              : { id: e.location_id, name: "Unknown", phone: "" };

            const deadlineMs =
              new Date(startsAtLocal).getTime() -
              session.cancellationWindowHours * 60 * 60 * 1000;

            return {
              status: "confirmed" as const,
              event_id: e.id,
              // event_id format "22420788-260414" is a different ID space from appointment_request_id
              appointment_request_id: e.appointment_request_id ?? null,
              starts_at_local: startsAtLocal,
              starts_at_utc: startsAtUtc,
              ends_at_local: endsAtLocal,
              ends_at_utc: endsAtUtc,
              duration_minutes: durationMinutes,
              timezone: TIMEZONE,
              location,
              practitioner_name:
                practitionerMap.get(e.user_id) ?? "your therapist",
              service_name: "Individual Therapy",
              cancellation_deadline_local: addMinutesToIso(
                startsAtLocal,
                -session.cancellationWindowHours * 60
              ),
              cancellation_deadline_utc: new Date(deadlineMs).toISOString(),
              can_cancel_free: now < deadlineMs,
            };
          });

        // Pending requests from the same endpoint — not yet accepted by the practitioner
        const pending = (data.appointment_requests ?? [])
          .filter((ar) => {
            if (ar.status !== "pending") return false;
            const startMs = new Date(ar.starts_at).getTime();
            return startMs >= cutoffPast && startMs <= cutoffFuture;
          })
          .map((ar) => {
            // Sessions Health stores appointment_request times in server timezone (CDT -05:00).
            // Convert to UTC first, then to Pacific for local display.
            const startsAtUtc = toUtc(ar.starts_at);
            const endsAtUtc = toUtc(ar.ends_at);
            const startsAtLocal = toLocalIso(startsAtUtc);
            const endsAtLocal = toLocalIso(endsAtUtc);
            const durationMs = new Date(endsAtUtc).getTime() - new Date(startsAtUtc).getTime();

            const loc = locationMap.get(ar.location_id);
            const location = loc
              ? formatLocation(loc)
              : { id: ar.location_id, name: "Unknown", phone: "" };

            // Anchor deadline to UTC to avoid any local-time offset confusion
            const deadlineMs =
              new Date(startsAtUtc).getTime() -
              session.cancellationWindowHours * 60 * 60 * 1000;

            return {
              status: "pending" as const,
              event_id: null,
              appointment_request_id: ar.id,
              starts_at_local: startsAtLocal,
              starts_at_utc: startsAtUtc,
              ends_at_local: endsAtLocal,
              ends_at_utc: endsAtUtc,
              duration_minutes: Math.round(durationMs / 60_000),
              timezone: TIMEZONE,
              location,
              practitioner_name: "your therapist",
              service_name: "Individual Therapy",
              cancellation_deadline_local: toLocalIso(new Date(deadlineMs).toISOString()),
              cancellation_deadline_utc: new Date(deadlineMs).toISOString(),
              can_cancel_free: now < deadlineMs,
            };
          });

        // Sort confirmed + pending together by start time
        const all = [...confirmed, ...pending].sort(
          (a, b) =>
            new Date(a.starts_at_utc).getTime() -
            new Date(b.starts_at_utc).getTime()
        );

        return textContent(all);
      } catch (e) {
        return errorContent(e instanceof Error ? e.message : String(e));
      }
    }
  );
}
