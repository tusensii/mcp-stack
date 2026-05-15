/**
 * Google Calendar integration for the OTF Worker.
 *
 * Adds two private "WO" + "PWO" blocks to the user's personal calendar
 * after each class booking, and removes them on cancellation. The
 * calendar integration is optional — if any of the GOOGLE_* secrets are
 * missing, the booking + cancellation tools degrade gracefully and skip
 * the calendar work.
 *
 * Auth flow: refresh-token-only OAuth via `@mcp-stack/auth-oauth-google`.
 * One-shot SRP-equivalent setup happens out-of-band via
 * `apps/otf-mcp/scripts/google-auth.ts` — that script captures the
 * refresh token; the Worker only ever uses it to mint short-lived
 * access tokens.
 *
 * Scope is `https://www.googleapis.com/auth/calendar.events` only —
 * narrower than `calendar`. Cannot read or modify ACLs, settings, or
 * other calendars' metadata.
 */

import { google, type calendar_v3 } from "googleapis";
import { buildGoogleOAuthClient } from "@mcp-stack/auth-oauth-google";
import type { Env } from "../server.js";

/** Length of the post-workout block. */
export const PWO_DURATION_MINUTES = 30;

/** Tolerance when matching calendar events to a class start/end time. */
const EVENT_MATCH_TOLERANCE_MS = 60_000;

export interface CalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
  attendee: string;
}

/**
 * Read calendar config from env. Returns null if any secret is missing —
 * callers should treat that as "calendar integration disabled" and skip.
 */
export function getCalendarConfig(env: Env): CalendarConfig | null {
  const {
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REFRESH_TOKEN,
    GOOGLE_CALENDAR_ID,
    OTF_CALENDAR_ATTENDEE,
  } = env;
  if (
    !GOOGLE_OAUTH_CLIENT_ID ||
    !GOOGLE_OAUTH_CLIENT_SECRET ||
    !GOOGLE_OAUTH_REFRESH_TOKEN ||
    !GOOGLE_CALENDAR_ID ||
    !OTF_CALENDAR_ATTENDEE
  ) {
    return null;
  }
  return {
    clientId: GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
    refreshToken: GOOGLE_OAUTH_REFRESH_TOKEN,
    calendarId: GOOGLE_CALENDAR_ID,
    attendee: OTF_CALENDAR_ATTENDEE,
  };
}

export function buildCalendarClient(config: CalendarConfig): calendar_v3.Calendar {
  const auth = buildGoogleOAuthClient({
    keys: { client_id: config.clientId, client_secret: config.clientSecret },
    credentials: { refresh_token: config.refreshToken },
  });
  return google.calendar({ version: "v3", auth });
}

export interface WorkoutBlocksCreated {
  wo_event_id: string;
  pwo_event_id: string;
}

/**
 * Create both blocks. WO = class start → class end. PWO = class end →
 * class end + 30 min. Both are private, no Meet URL, attendee comes from
 * the OTF_CALENDAR_ATTENDEE secret. `sendUpdates: "none"` keeps these
 * silent — they're passive busy markers, not meeting invites.
 */
export async function createWorkoutBlocks(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  classStartUtc: string,
  classEndUtc: string,
  attendee: string,
): Promise<WorkoutBlocksCreated> {
  const wo = await calendar.events.insert({
    calendarId,
    sendUpdates: "none",
    requestBody: {
      summary: "WO",
      start: { dateTime: classStartUtc },
      end: { dateTime: classEndUtc },
      attendees: [{ email: attendee }],
      visibility: "private",
      reminders: { useDefault: false },
    },
  });

  const pwoEnd = new Date(
    new Date(classEndUtc).getTime() + PWO_DURATION_MINUTES * 60_000,
  ).toISOString();
  const pwo = await calendar.events.insert({
    calendarId,
    sendUpdates: "none",
    requestBody: {
      summary: "PWO",
      start: { dateTime: classEndUtc },
      end: { dateTime: pwoEnd },
      attendees: [{ email: attendee }],
      visibility: "private",
      reminders: { useDefault: false },
    },
  });

  if (!wo.data.id || !pwo.data.id) {
    throw new Error("Calendar API did not return event IDs for WO/PWO");
  }
  return { wo_event_id: wo.data.id, pwo_event_id: pwo.data.id };
}

export interface WorkoutBlocksDeleteResult {
  deleted: Array<"WO" | "PWO">;
  missing: Array<"WO" | "PWO">;
}

/**
 * Find and delete WO/PWO blocks matching the cancelled class. Match by
 * event title + start time within a 60-second tolerance, so back-to-back
 * classes the user occasionally books don't collide.
 */
export async function deleteWorkoutBlocks(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  classStartUtc: string,
  classEndUtc: string,
): Promise<WorkoutBlocksDeleteResult> {
  const classStartMs = new Date(classStartUtc).getTime();
  const classEndMs = new Date(classEndUtc).getTime();

  const searchStart = new Date(
    classStartMs - EVENT_MATCH_TOLERANCE_MS,
  ).toISOString();
  const searchEnd = new Date(
    classEndMs + (PWO_DURATION_MINUTES + 1) * 60_000,
  ).toISOString();

  const list = await calendar.events.list({
    calendarId,
    timeMin: searchStart,
    timeMax: searchEnd,
    singleEvents: true,
    maxResults: 50,
  });

  const events = list.data.items ?? [];
  const woMatch = events.find(
    (e) =>
      e.summary === "WO" &&
      e.start?.dateTime !== undefined &&
      e.start.dateTime !== null &&
      Math.abs(new Date(e.start.dateTime).getTime() - classStartMs) <
        EVENT_MATCH_TOLERANCE_MS,
  );
  const pwoMatch = events.find(
    (e) =>
      e.summary === "PWO" &&
      e.start?.dateTime !== undefined &&
      e.start.dateTime !== null &&
      Math.abs(new Date(e.start.dateTime).getTime() - classEndMs) <
        EVENT_MATCH_TOLERANCE_MS,
  );

  const deleted: Array<"WO" | "PWO"> = [];
  const missing: Array<"WO" | "PWO"> = [];

  if (woMatch?.id) {
    await calendar.events.delete({ calendarId, eventId: woMatch.id });
    deleted.push("WO");
  } else {
    missing.push("WO");
  }
  if (pwoMatch?.id) {
    await calendar.events.delete({ calendarId, eventId: pwoMatch.id });
    deleted.push("PWO");
  } else {
    missing.push("PWO");
  }

  return { deleted, missing };
}
