import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getSessions } from "../oura/endpoints.js";
import { resolveDateRange, validateDateRange, textContent, errorContent } from "./utils.js";

export function registerSessionTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_sessions",
    "Returns ONLY user-initiated sessions logged manually in the Oura app " +
      "(meditation, breathing, relaxation, rest, and user-logged naps). " +
      "Does NOT include auto-detected naps from the sleep stream — for those, " +
      "use `oura_naps` (or `oura_sleep_detail` and filter where type is 'nap' or 'late_nap'). " +
      "Includes type, start/end datetime, mood rating, and HRV/HR sample arrays. " +
      "Dates: \"day\" is the calendar day the session occurred (derived from start_datetime).",
    {
      start_date: z.string().optional().describe("Start date YYYY-MM-DD. Defaults to today minus 6 days (7-day inclusive window)."),
      end_date: z.string().optional().describe("End date YYYY-MM-DD. Defaults to today."),
      max_pages: z.number().int().min(1).max(20).optional().describe("Max pagination pages (default 5)."),
    },
    async ({ start_date, end_date, max_pages }) => {
      const range = resolveDateRange(start_date, end_date);
      const err = validateDateRange(range.start_date, range.end_date);
      if (err) return errorContent(err);
      try {
        const data = await getSessions(client, range, max_pages);
        return textContent(data);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
