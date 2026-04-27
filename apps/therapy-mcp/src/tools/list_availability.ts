import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSession } from "../sh/auth.js";
import { fetchAvailabilityRange } from "../sh/endpoints.js";
import { textContent, errorContent, addMinutesToIso, toUtc } from "./utils.js";
import type { AuthEnv } from "../sh/auth.js";

const DURATION_MINUTES = 50; // Individual Therapy session duration
const TIMEZONE = "America/Los_Angeles";

export function registerListAvailabilityTool(
  server: McpServer,
  env: AuthEnv
): void {
  server.tool(
    "therapy_list_availability",
    "Returns open appointment slots for your therapist within a date range. Defaults to the next 30 days. Use starts_at_utc from a slot as input to therapy_book_appointment.",
    {
      start_date: z
        .string()
        .optional()
        .describe("YYYY-MM-DD start date, defaults to today"),
      end_date: z
        .string()
        .optional()
        .describe("YYYY-MM-DD end date, defaults to start + 30 days"),
      available_only: z
        .boolean()
        .optional()
        .describe("Filter out unavailable slots, defaults to true"),
    },
    async ({ start_date, end_date, available_only = true }) => {
      try {
        const today = new Date();
        const startDate = start_date ?? today.toISOString().slice(0, 10);
        const endDate =
          end_date ??
          new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);

        const session = await getSession(env);
        const days = await fetchAvailabilityRange(env, startDate, endDate);

        const slots = [];
        for (const day of days) {
          if (available_only && day.status === "unavailable") continue;
          for (const interval of day.time_intervals) {
            if (available_only && interval.status === "unavailable") continue;

            const startsAtLocal = interval.starts_at;
            const startsAtUtc = toUtc(startsAtLocal);
            const endsAtLocal = addMinutesToIso(startsAtLocal, DURATION_MINUTES);
            const endsAtUtc = toUtc(endsAtLocal);

            slots.push({
              starts_at_local: startsAtLocal,
              starts_at_utc: startsAtUtc,
              ends_at_local: endsAtLocal,
              ends_at_utc: endsAtUtc,
              duration_minutes: DURATION_MINUTES,
              timezone: TIMEZONE,
              availability_id: session.availabilityId,
              service_code_id: session.serviceCodeId,
              location_id: session.defaultLocationId,
            });
          }
        }

        return textContent(slots);
      } catch (e) {
        return errorContent(e instanceof Error ? e.message : String(e));
      }
    }
  );
}
