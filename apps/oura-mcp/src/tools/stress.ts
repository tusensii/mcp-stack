import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import { getDailyStress } from "../oura/endpoints.js";
import { resolveDateRange, validateDateRange, textContent, errorContent } from "./utils.js";

export function registerStressTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_daily_stress",
    "Returns daily stress metrics: stress_high (seconds in high-stress state), " +
      "recovery_high (seconds in high-recovery state), and day_summary label " +
      "(restored/normal/stressful/unknown). Both time fields are in SECONDS. " +
      "Dates: \"day\" is the calendar day the stress measurements were taken on.",
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
        const data = await getDailyStress(client, range, max_pages);
        return textContent(data);
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
