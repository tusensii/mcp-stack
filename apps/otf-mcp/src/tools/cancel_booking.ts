import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthEnv } from "../otf/auth.js";
import { deleteBooking, fetchBookings } from "../otf/endpoints.js";
import { textContent, errorContent, buildBookingOutput, toLocalIso } from "./utils.js";
import { LATE_CANCEL_WINDOW_HOURS } from "../otf/auth.js";
import { OtfApiError } from "../otf/client.js";

export function registerCancelBookingTool(server: McpServer, env: AuthEnv): void {
  server.tool(
    "otf_cancel_booking",
    "Cancel an OTF booking by booking_id (from otf_list_bookings or otf_book_class output). " +
    "If within 8 hours of class start, requires acknowledge_late_cancel_fee: true. " +
    "IMPORTANT: late cancels may incur a fee — do not set acknowledge_late_cancel_fee without " +
    "confirming with the user first.",
    {
      booking_id: z.string().describe("The booking_id from otf_list_bookings or otf_book_class."),
      acknowledge_late_cancel_fee: z
        .boolean()
        .optional()
        .describe(
          "Must be true if cancelling within 8 hours of class start. " +
          "Confirm with the user before setting this.",
        ),
    },
    async ({ booking_id, acknowledge_late_cancel_fee }) => {
      try {
        const now = new Date();
        const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const future = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);

        const allBookings = await fetchBookings(
          past.toISOString(),
          future.toISOString(),
          true,   // include cancelled bookings so we can detect already-cancelled state
          env,
        );

        const rawBooking = allBookings.find(b => b.id === booking_id);
        if (!rawBooking) {
          return errorContent(`Booking ${booking_id} not found. It may already be cancelled or outside the search window.`);
        }

        if (rawBooking.canceled) {
          return errorContent(`Booking ${booking_id} is already cancelled.`);
        }

        const classStartUtc = new Date(rawBooking.class.starts_at);
        const deadlineUtc = new Date(classStartUtc.getTime() - LATE_CANCEL_WINDOW_HOURS * 60 * 60 * 1000);
        const isLateCancelWindow = now >= deadlineUtc;

        if (isLateCancelWindow && !acknowledge_late_cancel_fee) {
          const tz = rawBooking.class.studio.time_zone ?? "UTC";
          return errorContent(
            `This cancellation is within the ${LATE_CANCEL_WINDOW_HOURS}-hour late cancel window. ` +
            `Class starts ${toLocalIso(classStartUtc.toISOString(), tz)} (${classStartUtc.toISOString()}). ` +
            `Cancellation deadline was ${toLocalIso(deadlineUtc.toISOString(), tz)} (${deadlineUtc.toISOString()}). ` +
            `A late cancel fee may apply. ` +
            `To proceed, call again with acknowledge_late_cancel_fee: true — but confirm with the user first.`,
          );
        }

        await deleteBooking(booking_id, env);

        const booking = buildBookingOutput({ ...rawBooking, canceled: true });
        return textContent({
          booking_id,
          status: "cancelled",
          was_late_cancel: isLateCancelWindow,
          class: booking.class,
        });
      } catch (e) {
        if (e instanceof OtfApiError) {
          if (e.status === 404) return errorContent(`Booking ${booking_id} not found or already cancelled.`);
          if (e.code === "BOOKING_CANCELED") return errorContent("Booking is already cancelled.");
          return errorContent(e.message);
        }
        if (e instanceof Error) return errorContent(e.message);
        throw e;
      }
    },
  );
}
