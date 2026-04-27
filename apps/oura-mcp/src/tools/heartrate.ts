import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getHeartrate } from "../oura/endpoints.js";
import { validateDatetimeRange, textContent, errorContent } from "./utils.js";

export function registerHeartrateTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_heartrate",
    "Returns time-series heart rate samples as { bpm, source, timestamp } objects. " +
      "source is one of: awake, rest, sleep, session, live, workout. " +
      "Timestamps are ISO 8601. Samples are ~5-minute intervals during rest/sleep. " +
      "Default cap: 24-hour window. To query longer windows, set max_pages explicitly.",
    {
      start_datetime: z
        .string()
        .describe("Start datetime ISO 8601, e.g. 2026-04-18T22:00:00-07:00"),
      end_datetime: z
        .string()
        .describe("End datetime ISO 8601, e.g. 2026-04-19T08:00:00-07:00"),
      max_pages: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Max pagination pages (default 5). Set explicitly to allow >24h windows."),
    },
    async ({ start_datetime, end_datetime, max_pages }) => {
      const explicit = max_pages !== undefined;
      const err = validateDatetimeRange(start_datetime, end_datetime, explicit);
      if (err) return errorContent(err);
      try {
        const data = await getHeartrate(client, { start_datetime, end_datetime }, max_pages);
        return textContent(data);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
