import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { postBooking, fetchStudioDetail } from "../otf/endpoints.js";
import { textContent, errorContent, buildBookingOutput, getClassDurationMinutes } from "./utils.js";
import { OtfApiError } from "../otf/client.js";
import {
  getCalendarConfig,
  buildCalendarClient,
  createWorkoutBlocks,
} from "../otf/calendar.js";
import type { Env } from "../server.js";

export function registerBookClassTool(server: McpServer, env: Env): void {
  server.tool(
    "otf_book_class",
    "Book an OTF class by class_id (from otf_list_classes). " +
      "Returns full class details including local and UTC start/end times, studio address, " +
      "and IANA timezone — ready to feed directly into a Google Calendar create_event call. " +
      "Also returns the cancellation deadline. " +
      "When Google Calendar integration is configured, also creates 'WO' and 'PWO' blocks on " +
      "the user's personal calendar (private, with the work-email attendee) — pass " +
      "create_calendar_blocks: false to opt out.",
    {
      class_id: z.string().describe("The class ID from otf_list_classes output."),
      waitlist_if_full: z
        .boolean()
        .optional()
        .default(true)
        .describe("Join the waitlist if the class is full. Default true."),
      create_calendar_blocks: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Create 'WO' (during class) and 'PWO' (30-min post-workout) blocks on the user's " +
            "personal Google Calendar. Default true. Silently skipped if calendar secrets " +
            "(GOOGLE_OAUTH_CLIENT_ID etc.) are not configured.",
        ),
    },
    async ({ class_id, waitlist_if_full, create_calendar_blocks }) => {
      try {
        const rawBooking = await postBooking(class_id, waitlist_if_full, env);
        const studioDetail = await fetchStudioDetail(rawBooking.class.studio.id, env);
        const booking = buildBookingOutput(rawBooking, studioDetail);

        let calendar_blocks: Record<string, unknown> | null = null;
        if (create_calendar_blocks) {
          const config = getCalendarConfig(env);
          if (!config) {
            calendar_blocks = {
              status: "skipped",
              reason: "Google Calendar secrets not configured (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_CALENDAR_ID). Booking succeeded; add blocks manually if desired.",
            };
          } else {
            try {
              const cal = buildCalendarClient(config);
              const durationMin = getClassDurationMinutes(rawBooking.class.type);
              const classEndUtc = new Date(
                new Date(rawBooking.class.starts_at).getTime() + durationMin * 60_000,
              ).toISOString();
              const ids = await createWorkoutBlocks(
                cal,
                config.calendarId,
                rawBooking.class.starts_at,
                classEndUtc,
              );
              calendar_blocks = { status: "created", ...ids };
            } catch (e) {
              calendar_blocks = {
                status: "error",
                error: e instanceof Error ? e.message : String(e),
                note: "Booking succeeded; calendar blocks could not be created. Please add WO/PWO blocks manually.",
              };
            }
          }
        }

        return textContent({ ...booking, calendar_blocks });
      } catch (e) {
        if (e instanceof OtfApiError) {
          if (e.code === "BOOKING_ALREADY_BOOKED" || e.code === "ALREADY_BOOKED") {
            return errorContent("This class is already booked.");
          }
          if (e.code === "OUTSIDE_WINDOW") {
            return errorContent("This class is outside the booking window and cannot be booked.");
          }
          return errorContent(e.message);
        }
        if (e instanceof Error) return errorContent(e.message);
        throw e;
      }
    },
  );
}
