import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthEnv } from "../otf/auth.js";
import { postBooking, fetchStudioDetail } from "../otf/endpoints.js";
import { textContent, errorContent, buildBookingOutput } from "./utils.js";
import { OtfApiError } from "../otf/client.js";

export function registerBookClassTool(server: McpServer, env: AuthEnv): void {
  server.tool(
    "otf_book_class",
    "Book an OTF class by class_id (from otf_list_classes). " +
    "Returns full class details including local and UTC start/end times, studio address, " +
    "and IANA timezone — ready to feed directly into a Google Calendar create_event call. " +
    "Also returns the cancellation deadline.",
    {
      class_id: z.string().describe("The class ID from otf_list_classes output."),
      waitlist_if_full: z
        .boolean()
        .optional()
        .default(true)
        .describe("Join the waitlist if the class is full. Default true."),
    },
    async ({ class_id, waitlist_if_full }) => {
      try {
        const rawBooking = await postBooking(class_id, waitlist_if_full, env);
        const studioDetail = await fetchStudioDetail(rawBooking.class.studio.id, env);
        const booking = buildBookingOutput(rawBooking, studioDetail);
        return textContent(booking);
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
