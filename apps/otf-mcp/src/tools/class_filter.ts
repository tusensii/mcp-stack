import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthEnv } from "../otf/auth.js";
import { fetchClasses, fetchStudioDetail, fetchBookings } from "../otf/endpoints.js";
import type { ClassOutput, RawClass, RawStudioDetail } from "../otf/types.js";
import { textContent, errorContent, buildClassOutput } from "./utils.js";
import { getHomeStudioUuid } from "./member_info.js";
import { OtfApiError } from "../otf/client.js";

// Class types accepted by the filter. The OTF API exposes more variants than
// CLASS_DURATIONS knows about (2G/3G/45 are studio-specific labels); accept them
// here and let the type-equality filter pass them through unchanged.
const CLASS_TYPE_VALUES = [
  "ORANGE_60",
  "ORANGE_2G",
  "ORANGE_3G",
  "ORANGE_45",
  "ORANGE_90",
  "STRENGTH_50",
  "TREAD_50",
] as const;

const TIME_BUCKETS = [
  "early_morning",
  "morning",
  "midday",
  "afternoon",
  "evening",
] as const;
type TimeBucket = (typeof TIME_BUCKETS)[number];

const DAYS_OF_WEEK = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

// Time-of-day classification using LOCAL hour in studio TZ.
// Boundaries are exclusive-at-top:
//   early_morning: hour < 7
//   morning:       7  <= hour < 10
//   midday:        10 <= hour < 14
//   afternoon:     14 <= hour < 17
//   evening:       hour >= 17
function bucketForHour(hour: number): TimeBucket {
  if (hour < 7) return "early_morning";
  if (hour < 10) return "morning";
  if (hour < 14) return "midday";
  if (hour < 17) return "afternoon";
  return "evening";
}

function localHour(utcIso: string, tz: string): number {
  const d = new Date(utcIso);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  });
  // Some locales render midnight as "24"; en-US + hour12:false generally yields "00".
  const raw = fmt.format(d);
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  return n === 24 ? 0 : n;
}

function localDayOfWeek(utcIso: string, tz: string): DayOfWeek {
  const d = new Date(utcIso);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
  });
  const name = fmt.format(d).toLowerCase();
  // Defensive: ensure it's one of the known values
  if ((DAYS_OF_WEEK as readonly string[]).includes(name)) return name as DayOfWeek;
  return "monday";
}

function offsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchStudioDetails(
  uuids: string[],
  env: AuthEnv,
): Promise<Map<string, RawStudioDetail>> {
  const entries = await Promise.all(
    uuids.map(async (uuid) => {
      const detail = await fetchStudioDetail(uuid, env);
      return [uuid, detail] as const;
    }),
  );
  return new Map(entries);
}

export function registerClassFilterTool(server: McpServer, env: AuthEnv): void {
  server.tool(
    "otf_class_filter",
    "Find OTF classes with rich server-side filters: coach name (partial), " +
    "time-of-day buckets, day-of-week, class types, available-only, and " +
    "exclude-already-booked. Drop-in compatible response with otf_list_classes.",
    {
      start_date: z
        .string()
        .optional()
        .describe("YYYY-MM-DD. Default today."),
      end_date: z
        .string()
        .optional()
        .describe("YYYY-MM-DD. Default 7 days from start."),
      studio_uuids: z
        .array(z.string())
        .optional()
        .describe("Default: home studio (member_info.home_studio.studio_uuid)."),
      class_types: z
        .array(z.enum(CLASS_TYPE_VALUES))
        .optional()
        .describe("Filter by one or more class types."),
      coach_names: z
        .array(z.string())
        .optional()
        .describe("Partial match, case-insensitive ('emily' matches 'Emily S')."),
      time_of_day: z
        .array(z.enum(TIME_BUCKETS))
        .optional()
        .describe(
          "early_morning <7am, morning 7-10, midday 10-14, afternoon 14-17, evening 17+ (in studio TZ).",
        ),
      days_of_week: z
        .array(z.enum(DAYS_OF_WEEK))
        .optional()
        .describe("Days of week to include (in studio TZ)."),
      available_only: z
        .boolean()
        .optional()
        .describe("Default true. Excludes full classes (without waitlist)."),
      exclude_already_booked: z
        .boolean()
        .optional()
        .describe("Default true. Excludes member's existing active bookings."),
    },
    async ({
      start_date,
      end_date,
      studio_uuids,
      class_types,
      coach_names,
      time_of_day,
      days_of_week,
      available_only,
      exclude_already_booked,
    }) => {
      try {
        const availableOnly = available_only ?? true;
        const excludeBooked = exclude_already_booked ?? true;

        // Resolve studio UUIDs
        const uuids =
          studio_uuids && studio_uuids.length > 0
            ? studio_uuids
            : [await getHomeStudioUuid(env)];

        // Resolve date window
        const today = new Date().toISOString().slice(0, 10);
        const startStr = start_date ?? today;
        const endStr = end_date ?? offsetDate(startStr, 7);

        // Pre-build cheap lookups
        const coachNeedles = coach_names?.map((c) => c.toLowerCase()) ?? null;
        const classTypeSet = class_types ? new Set<string>(class_types) : null;
        const timeBucketSet = time_of_day ? new Set<TimeBucket>(time_of_day) : null;
        const daysSet = days_of_week ? new Set<DayOfWeek>(days_of_week) : null;
        const studioUuidSet = new Set(uuids);

        // Parallel fetches: classes, studio details, and (optionally) bookings
        const bookingsPromise: Promise<Set<string> | null> = excludeBooked
          ? (async () => {
              // Pull bookings covering the same window. Use UTC ISO bounds.
              const startsAfter = new Date(startStr + "T00:00:00Z").toISOString();
              const endsBefore = new Date(endStr + "T23:59:59Z").toISOString();
              const raws = await fetchBookings(startsAfter, endsBefore, false, env);
              // Only ACTIVE bookings count as "already booked" — a previously
              // cancelled class should remain visible in filter results.
              const ids = new Set<string>();
              for (const b of raws) {
                if (b.canceled || b.late_canceled) continue;
                ids.add(b.class.id);
              }
              return ids;
            })()
          : Promise.resolve(null);

        const [rawClasses, studioMap, bookedIds] = await Promise.all([
          fetchClasses(uuids, env),
          fetchStudioDetails(uuids, env),
          bookingsPromise,
        ]);

        const results: ClassOutput[] = [];
        for (const cls of rawClasses) {
          // Always exclude studio-cancelled
          if (cls.canceled) continue;

          // Date range (UTC date of class start, mirrors otf_list_classes)
          const clsDate = cls.starts_at.slice(0, 10);
          if (clsDate < startStr || clsDate > endStr) continue;

          // Studio filter
          if (!studioUuidSet.has(cls.studio.id)) continue;

          // Class type filter
          if (classTypeSet && !classTypeSet.has(cls.type)) continue;

          // Coach filter (partial, case-insensitive against first_name)
          if (coachNeedles) {
            const coachLower = (cls.coach?.first_name ?? "").toLowerCase();
            if (!coachLower) continue;
            const matched = coachNeedles.some((needle) => coachLower.includes(needle));
            if (!matched) continue;
          }

          const studioDetail = studioMap.get(cls.studio.id);
          if (!studioDetail) continue;
          const tz = studioDetail.timeZone ?? cls.studio.time_zone ?? "UTC";

          // Time-of-day filter (local hour in studio TZ)
          if (timeBucketSet) {
            const hour = localHour(cls.starts_at, tz);
            if (!timeBucketSet.has(bucketForHour(hour))) continue;
          }

          // Day-of-week filter (in studio TZ)
          if (daysSet) {
            const dow = localDayOfWeek(cls.starts_at, tz);
            if (!daysSet.has(dow)) continue;
          }

          // Availability: exclude full classes that have no waitlist
          if (availableOnly) {
            const full = cls.full ?? false;
            const waitlist = cls.waitlist_available ?? false;
            if (full && !waitlist) continue;
          }

          // Exclude already-booked
          if (bookedIds && bookedIds.has(cls.id)) continue;

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
