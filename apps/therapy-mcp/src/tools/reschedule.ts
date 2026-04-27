/**
 * therapy_reschedule — atomically move an existing appointment to a new slot.
 *
 * Order of operations is load-bearing (see spec §"Behavior — MUST follow this order"):
 *   1. Validate the new slot is open
 *   2. Submit the new booking (POST /appointment_requests)
 *   3. Confirm step 2 succeeded
 *   4. Cancel the old appointment
 *   5. Return success — or a LOUD warning if step 4 fails after step 2
 *
 * The post-step-2 cancellation failure is the dangerous case: the user
 * is at risk of two overlapping bookings, so the message is explicit and
 * actionable rather than a generic error.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../sh/auth.js";
import {
  fetchAppointments,
  fetchAvailabilityRange,
  createAppointmentRequest,
  cancelAppointmentRequest,
} from "../sh/endpoints.js";
import {
  textContent,
  errorContent,
  toUtc,
  toLocalIso,
  lateCancelInfo,
  lateCancelMessage,
} from "./utils.js";
import type { AuthEnv } from "../sh/auth.js";

const TIMEZONE = "America/Los_Angeles";

/**
 * Extract the YYYY-MM-DD date in the practitioner's local timezone for a UTC
 * timestamp. The availability /range endpoint takes local-date strings, not
 * UTC instants, so we must shift before slicing.
 */
function localDateString(utcIso: string, timezone = TIMEZONE): string {
  // sv-SE locale gives "YYYY-MM-DD HH:MM:SS" in the target timezone
  const localStr = new Date(utcIso).toLocaleString("sv-SE", {
    timeZone: timezone,
  });
  return localStr.slice(0, 10);
}

export function registerRescheduleTool(
  server: McpServer,
  env: AuthEnv
): void {
  server.tool(
    "therapy_reschedule",
    "Atomically move an existing therapy appointment (confirmed or pending) to a new slot. Books the new slot first, then cancels the old one. If the new booking fails, your existing appointment is untouched. If cancellation of the old appointment fails AFTER the new booking succeeds, you'll receive a loud warning and may need to manually cancel one of the two bookings in the Sessions Health portal.",
    {
      appointment_id: z
        .union([z.number(), z.string()])
        .describe(
          "Existing appointment ID. Number for confirmed, string 'req_<id>' for pending."
        ),
      new_starts_at_utc: z
        .string()
        .describe("ISO 8601 UTC timestamp for the target slot."),
      acknowledge_late_cancel: z
        .boolean()
        .optional()
        .describe(
          "Required true if the existing appointment is in late-cancel window."
        ),
    },
    async ({ appointment_id, new_starts_at_utc, acknowledge_late_cancel = false }) => {
      try {
        const session = await getSession(env);

        // Resolve the existing appointment. The model passes either a number
        // (confirmed event's appointment_request_id) or a "req_<n>" string
        // (pending appointment_request id). Both ultimately resolve to a
        // numeric appointment_request id — that's the only cancel endpoint.
        let oldRequestId: number;
        let isPending: boolean;
        if (typeof appointment_id === "string") {
          if (!appointment_id.startsWith("req_")) {
            return errorContent(
              `Invalid appointment_id "${appointment_id}". String IDs must start with "req_" (pending appointments). For confirmed appointments pass the numeric appointment_request_id.`
            );
          }
          const n = Number(appointment_id.slice(4));
          if (!Number.isFinite(n)) {
            return errorContent(
              `Invalid appointment_id "${appointment_id}". Could not parse numeric id from "req_" prefix.`
            );
          }
          oldRequestId = n;
          isPending = true;
        } else {
          oldRequestId = appointment_id;
          isPending = false;
        }

        // Look up the existing appointment to find starts_at for the late-cancel gate.
        const data = await fetchAppointments(env);
        const confirmedEvent = data.events.find(
          (e) => e.appointment_request_id === oldRequestId
        );
        const pendingAr = data.appointment_requests?.find(
          (ar) => ar.id === oldRequestId
        );
        const oldStartsAt = confirmedEvent?.starts_at ?? pendingAr?.starts_at;

        if (!oldStartsAt) {
          return errorContent(
            `Existing appointment not found (id: ${appointment_id}). It may already be cancelled. ` +
              `Re-fetch with therapy_list_appointments to confirm current state.`
          );
        }

        // Late-cancel gate (reuses existing logic from cancel_appointment.ts)
        const { deadlineMs, isLateCancel } = lateCancelInfo(
          oldStartsAt,
          session.cancellationWindowHours
        );
        if (isLateCancel && !acknowledge_late_cancel) {
          return errorContent(
            lateCancelMessage(
              oldStartsAt,
              session.cancellationWindowHours,
              deadlineMs
            )
          );
        }

        // ─── Step 1: validate slot availability ──────────────────────────────
        // Compare instants (UTC ms), not raw strings, since Sessions Health
        // returns time_intervals.starts_at with a local offset.
        const targetMs = new Date(new_starts_at_utc).getTime();
        if (!Number.isFinite(targetMs)) {
          return errorContent(
            `Invalid new_starts_at_utc "${new_starts_at_utc}". Expected ISO 8601 UTC timestamp.`
          );
        }
        const localDate = localDateString(new_starts_at_utc);
        const days = await fetchAvailabilityRange(env, localDate, localDate);

        const slotIsAvailable = days.some((day) =>
          day.time_intervals.some(
            (interval) =>
              interval.status === "available" &&
              new Date(interval.starts_at).getTime() === targetMs
          )
        );
        if (!slotIsAvailable) {
          return errorContent(
            `Slot ${new_starts_at_utc} is not available. Use therapy_list_availability to see open slots. Your existing appointment is still intact.`
          );
        }

        // ─── Step 2: submit the new booking ──────────────────────────────────
        // If this throws, the existing appointment is untouched (step 4 has
        // not run). Surface a clear "intact" message.
        let newRequestId: number;
        let newStartsAtLocal: string;
        try {
          const created = await createAppointmentRequest(env, new_starts_at_utc);
          // Step 3: confirm submission succeeded — endpoint must return an id.
          const ar = created.appointment_request;
          if (!ar || typeof ar.id !== "number") {
            return errorContent(
              `Booking submission did not return a valid appointment_request id. ` +
                `Your existing appointment is still intact. Try again, or check the Sessions Health portal.`
            );
          }
          newRequestId = ar.id;
          newStartsAtLocal = ar.starts_at;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorContent(
            `Booking submission failed: ${msg}. Your existing appointment is still intact.`
          );
        }

        // ─── Step 4: cancel the old appointment ──────────────────────────────
        // Both pending and confirmed cancel through the same endpoint
        // (PATCH /appointment_requests/{id}/cancel). For confirmed events
        // we use the linked appointment_request_id (already resolved above).
        try {
          await cancelAppointmentRequest(env, oldRequestId);
        } catch (e) {
          // Step 4 failed AFTER step 2 succeeded — this is the dangerous case.
          // Make it actionable: tell the user exactly what happened and what
          // they need to do.
          const msg = e instanceof Error ? e.message : String(e);
          return errorContent(
            `Cancellation failed after new booking succeeded: ` +
              `New appointment request created (id: req_${newRequestId}) but old appointment ` +
              `(id: ${appointment_id}) could not be cancelled. ` +
              `You may have two bookings for overlapping times — please manually cancel one ` +
              `in the Sessions Health portal. (Underlying error: ${msg})`
          );
        }

        // ─── Step 5: success ─────────────────────────────────────────────────
        const newStartsAtUtcNorm = toUtc(newStartsAtLocal);
        const newStartsAtLocalNorm = toLocalIso(newStartsAtLocal);

        return textContent({
          old_appointment_id: appointment_id,
          new_appointment_request_id: newRequestId,
          new_starts_at_utc: newStartsAtUtcNorm,
          new_starts_at_local: newStartsAtLocalNorm,
          was_late_cancel: isLateCancel,
          status: "pending" as const,
          message:
            `Rescheduled. Old ${isPending ? "pending request" : "confirmed appointment"} ` +
            `(${appointment_id}) cancelled; new request submitted (req_${newRequestId}) ` +
            `for ${newStartsAtLocalNorm}. New request is PENDING — Chris must accept manually. ` +
            `You'll receive a confirmation email from Sessions Health when accepted.`,
        });
      } catch (e) {
        return errorContent(e instanceof Error ? e.message : String(e));
      }
    }
  );
}
