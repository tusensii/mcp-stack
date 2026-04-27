import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthEnv } from "../otf/auth.js";
import { fetchClasses, fetchStudioDetail } from "../otf/endpoints.js";
import type { ClassOutput, RawStudioDetail } from "../otf/types.js";
import { textContent, errorContent, buildClassOutput } from "./utils.js";
import { getHomeStudioUuid } from "./member_info.js";
import { OtfApiError } from "../otf/client.js";

export function registerListClassesTool(server: McpServer, env: AuthEnv): void {
  server.tool(
    "otf_list_classes",
    "Find bookable OTF classes at one or more studios in a date window. " +
    "Defaults to your home studio and the next 7 days. " +
    "Returns both local and UTC times with IANA timezone for calendar use.",
    {
      studio_uuids: z
        .array(z.string())
        .optional()
        .describe("Studio UUIDs to search. Defaults to your home studio from otf_member_info."),
      start_date: z
        .string()
        .optional()
        .describe("Start date YYYY-MM-DD. Defaults to today."),
      end_date: z
        .string()
        .optional()
        .describe("End date YYYY-MM-DD. Defaults to start_date + 7 days."),
      include_full: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include classes that are full or unavailable. Default false."),
      coach_name: z
        .string()
        .optional()
        .describe("Filter by coach name (case-insensitive substring match)."),
      class_type: z
        .string()
        .optional()
        .describe("Filter by class type, e.g. 'ORANGE_60', 'STRENGTH_50', 'TREAD_50', 'ORANGE_90'."),
    },
    async ({ studio_uuids, start_date, end_date, include_full, coach_name, class_type }) => {
      try {
        // Resolve studio UUIDs
        const uuids = studio_uuids && studio_uuids.length > 0
          ? studio_uuids
          : [await getHomeStudioUuid(env)];

        // Resolve date window
        const today = new Date().toISOString().slice(0, 10);
        const startStr = start_date ?? today;
        const endStr = end_date ?? offsetDate(startStr, 7);

        // Fetch classes and studio details in parallel
        const [rawClasses, studioMap] = await Promise.all([
          fetchClasses(uuids, env),
          fetchStudioDetails(uuids, env),
        ]);

        // Filter and build output
        const results: ClassOutput[] = [];
        for (const cls of rawClasses) {
          // Skip studio-cancelled classes
          if (cls.canceled) continue;

          // Date filter — use UTC date of class start
          const clsDate = cls.starts_at.slice(0, 10);
          if (clsDate < startStr || clsDate > endStr) continue;

          // Full/waitlist filter
          if (!include_full && (cls.full ?? false) && !(cls.waitlist_available ?? false)) continue;

          // Coach filter
          if (coach_name && !(cls.coach?.first_name?.toLowerCase().includes(coach_name.toLowerCase()))) continue;

          // Class type filter
          if (class_type && cls.type !== class_type) continue;

          const studioDetail = studioMap.get(cls.studio.id);
          if (!studioDetail) continue;

          results.push(buildClassOutput(cls, studioDetail));
        }

        results.sort((a, b) => a.start_time_utc.localeCompare(b.start_time_utc));
        return textContent(results);
      } catch (e) {
        if (e instanceof OtfApiError) return errorContent(e.message);
        if (e instanceof Error) return errorContent(e.message);
        throw e;
      }
    },
  );
}

async function fetchStudioDetails(
  uuids: string[],
  env: AuthEnv,
): Promise<Map<string, RawStudioDetail>> {
  const entries = await Promise.all(
    uuids.map(async uuid => {
      const detail = await fetchStudioDetail(uuid, env);
      return [uuid, detail] as const;
    }),
  );
  return new Map(entries);
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
