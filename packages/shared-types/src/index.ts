/**
 * Cross-MCP types. Only types that two or more apps reference belong here.
 * App-specific shapes (e.g. Oura sleep payloads) stay in the app.
 */

/** ISO 8601 datetime string in UTC, e.g. "2026-04-27T13:00:00Z". */
export type IsoDateTime = string;

/** Calendar date in YYYY-MM-DD format, no timezone. */
export type IsoDate = string;

/**
 * A time window. `start` and `end` are ISO 8601 strings — UTC unless the
 * caller explicitly authored them in another zone. `timezone` is the IANA
 * zone the window was authored in (display only); arithmetic uses
 * `start`/`end` directly.
 */
export interface TimeWindow {
  start: IsoDateTime;
  end: IsoDateTime;
  timezone?: string;
}

/**
 * Physical address. Fields are nullable because upstream APIs return
 * inconsistent subsets. Consumers should treat absent fields as unknown,
 * not empty.
 */
export interface Location {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  /** State / province / territory. */
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Booking lifecycle. `pending` covers states like Sessions Health's
 * appointment-request stage; `confirmed` is fully booked; `cancelled` is
 * any terminal cancellation; `completed` is post-session.
 */
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";
