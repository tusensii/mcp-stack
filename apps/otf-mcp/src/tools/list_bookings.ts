import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthEnv } from "../otf/auth.js";
import { fetchBookings, fetchStudioDetail } from "../otf/endpoints.js";
import { textContent, errorContent, buildBookingOutput } from "./utils.js";
import { OtfApiError } from "../otf/client.js";

export function registerListBookingsTool(server: McpServer, env: AuthEnv): void {
  server.tool(
    "otf_list_bookings",
    "List your OTF bookings (upcoming and recent). Returns full class details " +
    "and cancellation deadline for each booking.",
    {
      start_date: z
        .string()
        .optional()
        .describe("Start date YYYY-MM-DD. Defaults to 7 days ago."),
      end_date: z
        .string()
        .optional()
        .describe("End date YYYY-MM-DD. Defaults to 14 days from today."),
      include_cancelled: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include cancelled bookings. Default true."),
      status_filter: z
        .array(
          z.enum(["booked", "waitlisted", "attended", "cancelled", "late_cancelled", "no_show"]),
        )
        .optional()
        .describe("Filter by status. If omitted, all statuses are returned."),
    },
    async ({ start_date, end_date, include_cancelled, status_filter }) => {
      try {
        const today = new Date();
        const startDt = start_date
          ? new Date(start_date + "T00:00:00Z")
          : new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const endDt = end_date
          ? new Date(end_date + "T23:59:59Z")
          : new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

        const rawBookings = await fetchBookings(
          startDt.toISOString(),
          endDt.toISOString(),
          include_cancelled,
          env,
        );

        const uniqueStudioUuids = [...new Set(rawBookings.map(b => b.class.studio.id))];
        const studioDetails = new Map(
          await Promise.all(
            uniqueStudioUuids.map(async uuid => [uuid, await fetchStudioDetail(uuid, env)] as const)
          )
        );
        let bookings = rawBookings.map(b => buildBookingOutput(b, studioDetails.get(b.class.studio.id)));

        if (status_filter && status_filter.length > 0) {
          bookings = bookings.filter(b => status_filter.includes(b.status));
        }

        bookings.sort((a, b) => a.class.start_time_utc.localeCompare(b.class.start_time_utc));
        return textContent(bookings);
      } catch (e) {
        if (e instanceof OtfApiError) return errorContent(e.message);
        if (e instanceof Error) return errorContent(e.message);
        throw e;
      }
    },
  );
}
