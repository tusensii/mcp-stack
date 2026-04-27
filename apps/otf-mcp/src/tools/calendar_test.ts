import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { textContent, errorContent } from "./utils.js";
import { getCalendarConfig, buildCalendarClient } from "../otf/calendar.js";
import type { Env } from "../server.js";

/**
 * Verification tool that only registers when the four GOOGLE_OAUTH_*
 * + GOOGLE_CALENDAR_ID secrets are present. Creates a one-minute test
 * event, reads it back, deletes it. Use this immediately after
 * configuring the calendar secrets to confirm OAuth + Calendar API
 * access are working before booking real classes.
 *
 * Returns the test event id + a one-line summary; the event is gone by
 * the time the tool returns. Safe to invoke any number of times.
 */
export function registerCalendarTestTool(server: McpServer, env: Env): void {
  if (!getCalendarConfig(env)) return;

  server.tool(
    "otf_calendar_test",
    "Verify Google Calendar OAuth + API access for the OTF Worker. Creates a 1-minute test " +
      "event titled 'OTF MCP Test', reads it back, deletes it. Returns success or an actionable " +
      "error. Only registered when calendar secrets are configured.",
    {},
    async () => {
      const config = getCalendarConfig(env);
      if (!config) {
        return errorContent("Calendar config missing — this tool should not have registered.");
      }
      try {
        const cal = buildCalendarClient(config);
        const start = new Date(Date.now() + 5 * 60_000);
        const end = new Date(start.getTime() + 60_000);

        const created = await cal.events.insert({
          calendarId: config.calendarId,
          sendUpdates: "none",
          requestBody: {
            summary: "OTF MCP Test",
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
            visibility: "private",
            reminders: { useDefault: false },
          },
        });
        const eventId = created.data.id;
        if (!eventId) throw new Error("Calendar API did not return an event id");

        const readBack = await cal.events.get({
          calendarId: config.calendarId,
          eventId,
        });

        await cal.events.delete({ calendarId: config.calendarId, eventId });

        return textContent({
          status: "ok",
          calendar_id: config.calendarId,
          test_event_id: eventId,
          read_back_summary: readBack.data.summary ?? null,
          message: "OAuth + Calendar API working. Test event created, read, and deleted cleanly.",
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return errorContent(
          `Calendar test failed: ${msg}. Check that all four GOOGLE_OAUTH_* + GOOGLE_CALENDAR_ID secrets are set correctly and the OAuth client has the calendar.events scope.`,
        );
      }
    },
  );
}
