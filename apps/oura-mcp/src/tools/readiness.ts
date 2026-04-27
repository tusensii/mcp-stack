import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailyReadiness } from "../oura/endpoints.js";
import { resolveDateRange, validateDateRange, textContent, errorContent } from "./utils.js";

export function registerReadinessTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_daily_readiness",
    "Returns daily readiness scores (0-100) and contributor breakdown. " +
      "Contributors include HRV balance, resting heart rate, sleep balance, " +
      "activity balance, body temperature, and sleep regularity.",
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
        const data = await getDailyReadiness(client, range, max_pages);
        return textContent(data);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
