import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailySpo2 } from "../oura/endpoints.js";
import { resolveDateRange, validateDateRange, textContent, errorContent } from "./utils.js";

export function registerSpo2Tools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_daily_spo2",
    "Returns average blood oxygen saturation (SpO2) percentage per night. " +
      "spo2_percentage.average is a percentage value (e.g. 97.3). " +
      "null means insufficient data for that night. " +
      "Dates: \"day\" is the morning the nightly SpO2 average is reported on (reflecting the overnight sleep ending that morning).",
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
        const data = await getDailySpo2(client, range, max_pages);
        return textContent(data);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
