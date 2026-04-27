import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../sh/auth.js";
import {
  fetchAppointments,
  cancelAppointmentRequest,
} from "../sh/endpoints.js";
import {
  textContent,
  errorContent,
  lateCancelInfo,
  lateCancelMessage,
} from "./utils.js";
import type { AuthEnv } from "../sh/auth.js";

export function registerCancelAppointmentTool(
  server: McpServer,
  env: AuthEnv
): void {
  server.tool(
    "therapy_cancel_appointment",
    "Cancel a therapy appointment. If inside the cancellation window, requires acknowledge_late_cancel: true to proceed (policy may charge a late-cancel fee).",
    {
      appointment_request_id: z
        .number()
        .describe(
          "The appointment_request_id from therapy_list_appointments or therapy_book_appointment."
        ),
      acknowledge_late_cancel: z
        .boolean()
        .optional()
        .describe(
          "Required true if cancelling inside the cancellation window. Re-call with true to confirm late cancellation."
        ),
    },
    async ({ appointment_request_id, acknowledge_late_cancel = false }) => {
      try {
        const session = await getSession(env);

        // Fetch appointments to get starts_at for the window check.
        // Check both confirmed events and pending appointment_requests — the gate must
        // cover pending appointments too (they start out pending and may be inside the window).
        const data = await fetchAppointments(env);

        // event_id "22420788-260414" is a different ID space — find by appointment_request_id field.
        const confirmedEvent = data.events.find(
          (e) => e.appointment_request_id === appointment_request_id
        );
        const pendingAr = data.appointment_requests?.find(
          (ar) => ar.id === appointment_request_id
        );

        // Resolve the start time from whichever record we found
        const startsAtRaw = confirmedEvent?.starts_at ?? pendingAr?.starts_at;

        if (startsAtRaw) {
          const { deadlineMs, isLateCancel } = lateCancelInfo(
            startsAtRaw,
            session.cancellationWindowHours
          );

          if (isLateCancel && !acknowledge_late_cancel) {
            return errorContent(
              lateCancelMessage(
                startsAtRaw,
                session.cancellationWindowHours,
                deadlineMs
              )
            );
          }
        } else if (!acknowledge_late_cancel) {
          // Appointment not found in confirmed or pending — fail closed
          return errorContent(
            `Appointment ${appointment_request_id} not found in confirmed or pending list. ` +
              `Re-call with acknowledge_late_cancel: true to proceed anyway.`
          );
        }

        await cancelAppointmentRequest(env, appointment_request_id);

        const wasLateCancel = startsAtRaw
          ? lateCancelInfo(startsAtRaw, session.cancellationWindowHours)
              .isLateCancel
          : false;

        return textContent({
          appointment_request_id,
          status: "cancelled",
          was_late_cancel: wasLateCancel,
          cancellation_policy: `${session.cancellationWindowHours}-hour cancellation window per Sessions Health portal configuration`,
        });
      } catch (e) {
        return errorContent(e instanceof Error ? e.message : String(e));
      }
    }
  );
}
