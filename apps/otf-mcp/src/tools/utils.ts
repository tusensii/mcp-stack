import type { ClassOutput, BookingOutput, RawClass, RawBookingV2, RawStudioDetail } from "../otf/types.js";
import { LATE_CANCEL_WINDOW_HOURS } from "../otf/auth.js";

// ─── MCP content helpers ─────────────────────────────────────────────────────

export { textContent, errorContent } from "@mcp-stack/mcp-core";

// ─── Timezone helpers ─────────────────────────────────────────────────────────

/**
 * Convert a UTC ISO string to a local ISO string with TZ offset.
 * e.g. "2026-04-22T12:30:00Z" + "America/Los_Angeles" → "2026-04-22T05:30:00-07:00"
 *
 * Uses Intl.DateTimeFormat (available in Workers) — no external deps.
 */
export function toLocalIso(utcIso: string, ianaTimezone: string): string {
  const date = new Date(utcIso);

  // Compute offset by comparing localised timestamp vs UTC timestamp.
  const localMs = new Date(date.toLocaleString("en-US", { timeZone: ianaTimezone })).getTime();
  const utcMs = new Date(date.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const offsetMin = Math.round((localMs - utcMs) / 60_000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const offsetStr = `${sign}${String(Math.floor(absMin / 60)).padStart(2, "0")}:${String(absMin % 60).padStart(2, "0")}`;

  // Format the local date parts
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  // en-CA + hour12:false avoids the "24:00" midnight edge case (uses 00:00 instead)
  const hour = parts["hour"] === "24" ? "00" : (parts["hour"] ?? "00");

  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${hour}:${parts["minute"]}:${parts["second"]}${offsetStr}`;
}

/** Format a UTC ISO string as UTC ISO (no-op normalisation — ensures Z suffix). */
export function toUtcIso(utcIso: string): string {
  const d = new Date(utcIso);
  return d.toISOString();
}

/** Add hours to a UTC ISO string, return UTC ISO. */
export function addHoursUtc(utcIso: string, hours: number): string {
  const d = new Date(utcIso);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d.toISOString();
}

// ─── Class duration lookup ────────────────────────────────────────────────────

// Duration by ClassType enum value — sourced from otf_api/models/bookings/bookings_v2.py get_end_time
const CLASS_DURATIONS: Record<string, number> = {
  ORANGE_60: 60,
  ORANGE_90: 90,
  STRENGTH_50: 50,
  TREAD_50: 50,
  OTHER: 60,
};

export function getClassDurationMinutes(classType: string): number {
  return CLASS_DURATIONS[classType] ?? 60;
}

// ─── Format helpers ────────────────────────────────────────────────────────────

function formatAddress(
  loc: { address1?: string | null; city?: string | null; state?: string | null; postalCode?: string | null } | null,
): string {
  if (!loc) return "";
  return [loc.address1, loc.city, loc.state, loc.postalCode].filter((v): v is string => Boolean(v)).join(", ");
}

/**
 * Build a ClassOutput from a raw class + enriched studio detail.
 * studioDetail must come from /mobile/v1/studios/{uuid} to get IANA timezone.
 */
export function buildClassOutput(
  raw: RawClass,
  studioDetail: RawStudioDetail,
): ClassOutput {
  const tz = studioDetail.timeZone ?? "UTC";
  const startUtc = toUtcIso(raw.starts_at);
  const endUtc = toUtcIso(raw.ends_at);

  const durationMinutes = getClassDurationMinutes(raw.type);

  return {
    class_id: raw.id,
    studio_uuid: raw.studio.id,
    studio_name: studioDetail.studioName ?? raw.studio.name ?? "",
    studio_address: formatAddress(studioDetail.studioLocation),
    studio_timezone: tz,
    coach_name: raw.coach?.first_name ?? "",
    class_type: raw.type,
    class_name: raw.name,
    duration_minutes: durationMinutes,
    start_time_local: toLocalIso(startUtc, tz),
    start_time_utc: startUtc,
    end_time_local: toLocalIso(endUtc, tz),
    end_time_utc: endUtc,
    capacity: raw.max_capacity,
    booked_count: null,           // OTF API does not expose current booking count
    available_spots: null,        // cannot derive without booked_count
    waitlist_size: raw.waitlist_size ?? null,
    is_waitlist_available: raw.waitlist_available ?? false,
    is_bookable: !(raw.full ?? false) || (raw.waitlist_available ?? false),
  };
}

/** Derive booking status from BookingV2 fields. */
export function deriveBookingStatus(raw: RawBookingV2): BookingOutput["status"] {
  if (raw.late_canceled) return "late_cancelled";
  if (raw.canceled) return "cancelled";
  if (raw.checked_in) return "attended";
  return "booked";
}

/**
 * Build a BookingOutput from a raw BookingV2.
 * The class end time is computed from class type (ends_at_local is not in booking response).
 */
export function buildBookingOutput(raw: RawBookingV2, studioDetail?: RawStudioDetail | null): BookingOutput {
  const cls = raw.class;
  const tz = cls.studio.time_zone ?? "UTC";
  const startUtc = toUtcIso(cls.starts_at);
  const durationMinutes = getClassDurationMinutes(cls.type);
  const endUtc = addHoursUtc(startUtc, durationMinutes / 60);

  const deadlineUtc = addHoursUtc(startUtc, -LATE_CANCEL_WINDOW_HOURS);

  const addr = cls.studio.address;
  const studioAddress = studioDetail
    ? formatAddress(studioDetail.studioLocation)
    : addr
      ? [addr.address1, addr.city, addr.state, addr.postalCode].filter((v): v is string => Boolean(v)).join(", ")
      : "";

  const classOutput: ClassOutput = {
    class_id: cls.id,
    studio_uuid: cls.studio.id,
    studio_name: cls.studio.name ?? "",
    studio_address: studioAddress,
    studio_timezone: tz,
    coach_name: cls.coach?.first_name ?? "",
    class_type: cls.type,
    class_name: cls.name,
    duration_minutes: durationMinutes,
    start_time_local: toLocalIso(startUtc, tz),
    start_time_utc: startUtc,
    end_time_local: toLocalIso(endUtc, tz),
    end_time_utc: endUtc,
    capacity: null,
    booked_count: null,
    available_spots: null,
    waitlist_size: null,
    is_waitlist_available: false,
    is_bookable: false,
  };

  return {
    booking_id: raw.id,
    status: deriveBookingStatus(raw),
    class: classOutput,
    cancellation_deadline_local: toLocalIso(deadlineUtc, tz),
    cancellation_deadline_utc: deadlineUtc,
    cancellation_policy_note: `${LATE_CANCEL_WINDOW_HOURS}-hour cancellation window per OTF published policy. Late cancellations may incur a fee.`,
  };
}
