import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OuraClient } from "../oura/client.js";
import { OuraApiError } from "../oura/client.js";
import {
  getDailySleep,
  getDailyReadiness,
  getDailyActivity,
} from "../oura/endpoints.js";
import { todayInTz, daysAgoInTz, textContent, errorContent } from "./utils.js";

export function registerSummaryTools(server: McpServer, client: OuraClient): void {
  server.tool(
    "oura_summary_today",
    "Convenience tool: fetches today's and yesterday's sleep score, readiness score, " +
      "and activity score in parallel. Returns a compact merged object keyed by date. " +
      "Use this as the first tool when the user asks 'how am I doing?' or wants a daily overview. " +
      "Timezone: America/Los_Angeles. " +
      "Dates: keys in `dates` are morning-of-report dates (sleep score, readiness score, activity score all use this convention).",
    {},
    async () => {
      const today = todayInTz();
      const yesterday = daysAgoInTz(1);
      const params = { start_date: yesterday, end_date: today };

      try {
        const [sleep, readiness, activity] = await Promise.all([
          getDailySleep(client, params),
          getDailyReadiness(client, params),
          getDailyActivity(client, params),
        ]);

        const byDate: Record<
          string,
          {
            sleep_score: number | null;
            readiness_score: number | null;
            activity_score: number | null;
            steps: number | null;
            active_calories: number | null;
            sleep_contributors?: unknown;
            readiness_contributors?: unknown;
            activity_contributors?: unknown;
          }
        > = {};

        for (const d of sleep) {
          byDate[d.day] = {
            sleep_score: d.score,
            readiness_score: null,
            activity_score: null,
            steps: null,
            active_calories: null,
            sleep_contributors: d.contributors,
          };
        }
        for (const d of readiness) {
          if (!byDate[d.day]) {
            byDate[d.day] = {
              sleep_score: null,
              readiness_score: null,
              activity_score: null,
              steps: null,
              active_calories: null,
            };
          }
          byDate[d.day].readiness_score = d.score;
          byDate[d.day].readiness_contributors = d.contributors;
        }
        for (const d of activity) {
          if (!byDate[d.day]) {
            byDate[d.day] = {
              sleep_score: null,
              readiness_score: null,
              activity_score: null,
              steps: null,
              active_calories: null,
            };
          }
          byDate[d.day].activity_score = d.score;
          byDate[d.day].steps = d.steps;
          byDate[d.day].active_calories = d.active_calories;
          byDate[d.day].activity_contributors = d.contributors;
        }

        return textContent({ dates: byDate, timezone: "America/Los_Angeles" });
      } catch (e) {
        if (e instanceof OuraApiError) return errorContent(e.message);
        throw e;
      }
    },
  );
}
