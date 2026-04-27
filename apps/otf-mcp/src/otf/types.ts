// Raw OTF API response types — field names sourced from NodeJSmith/otf-api Pydantic models

// ─── Raw: /v1/classes (api.orangetheory.io) ──────────────────────────────────

export interface RawClassStudio {
  id: string;           // studio UUID
  name: string | null;
  time_zone: string | null;  // IANA, may be null — enriched via studio detail
  address: {
    address1: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
  } | null;
  phone: string | null;
}

export interface RawClass {
  id: string;                    // class_id — use for booking (new API)
  ot_base_class_uuid: string;    // class_uuid — legacy, not used by new booking endpoint
  name: string;
  type: string;                  // ClassType: ORANGE_60, ORANGE_90, STRENGTH_50, TREAD_50, OTHER
  starts_at_local: string;       // "2026-04-22T05:30:00" — no TZ info, studio local time
  ends_at_local: string;
  starts_at: string;             // UTC ISO: "2026-04-22T12:30:00Z"
  ends_at: string;
  coach: { first_name: string } | null;
  studio: RawClassStudio;
  booking_capacity: number | null;
  full: boolean | null;
  max_capacity: number | null;
  waitlist_available: boolean | null;
  waitlist_size: number | null;
  canceled: boolean | null;      // studio-cancelled, not member-cancelled
}

// ─── Raw: /v1/bookings/me (api.orangetheory.io) ──────────────────────────────

export interface RawBookingV2Class {
  id: string;             // class_id
  name: string;
  type: string;           // ClassType enum value
  starts_at_local: string;
  starts_at: string;      // UTC ISO
  // NOTE: ends_at_local is NOT in the booking class response.
  // Compute end time from class type using CLASS_DURATIONS constant.
  coach: { first_name: string } | null;
  studio: {
    id: string;           // studio UUID
    name: string | null;
    time_zone: string | null;
    address: {
      address1: string | null;
      city: string | null;
      state: string | null;
      postalCode: string | null;
      country: string | null;
    } | null;
  };
}

export interface RawBookingV2 {
  id: string;             // booking_id — use for cancellation
  member_id: string;
  checked_in: boolean;
  canceled: boolean;
  late_canceled: boolean | null;
  canceled_at: string | null;
  ratable: boolean;
  class: RawBookingV2Class;
}

// ─── Raw: /mobile/v1/studios/{uuid} (api.orangetheory.co) ───────────────────

export interface RawStudioLocation {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  phoneNumber: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface RawStudioDetail {
  studioUUId: string;
  studioName: string | null;
  timeZone: string | null;       // IANA timezone
  studioLocation: RawStudioLocation;
  studioStatus: string | null;
  distance: number | null;       // populated by geo-search, null for direct-by-uuid
}

// ─── Raw: /member/members/{uuid} (api.orangetheory.co) ──────────────────────

export interface RawHomeStudio {
  studioUUId: string;
  studioName: string | null;
  timeZone: string | null;
}

export interface RawMemberDetail {
  memberUUId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  homeStudio: RawHomeStudio;
}

// ─── Raw: /member/members/{uuid}/memberships (api.orangetheory.co) ──────────

export interface RawMembership {
  name: string | null;       // membership type name e.g. "Elite"
  remaining: number | null;  // classes remaining this period
  count: number | null;      // total classes in period
  current: boolean | null;
  expiration_date: string | null;
}

// ─── Tool output shapes ───────────────────────────────────────────────────────

export interface ClassOutput {
  class_id: string;
  studio_uuid: string;
  studio_name: string;
  studio_address: string;
  studio_timezone: string;
  coach_name: string;
  class_type: string;
  class_name: string;
  duration_minutes: number;
  start_time_local: string;   // ISO with TZ offset, e.g. "2026-04-22T05:30:00-07:00"
  start_time_utc: string;     // ISO Z
  end_time_local: string;
  end_time_utc: string;
  capacity: number | null;
  booked_count: number | null;
  available_spots: number | null;
  waitlist_size: number | null;
  is_waitlist_available: boolean;
  is_bookable: boolean;
}

export interface BookingOutput {
  booking_id: string;
  status: "booked" | "waitlisted" | "attended" | "cancelled" | "late_cancelled" | "no_show";
  class: ClassOutput;
  cancellation_deadline_local: string;
  cancellation_deadline_utc: string;
  cancellation_policy_note: string;
}

export interface StudioOutput {
  studio_uuid: string;
  studio_name: string;
  address: {
    street: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
  };
  timezone: string;
  phone: string;
  distance_miles: number | null;
}

export interface MemberOutput {
  member_uuid: string;
  email: string;
  first_name: string;
  last_name: string;
  home_studio: {
    studio_uuid: string;
    studio_name: string;
    timezone: string;
  };
  membership_type: string | null;
  remaining_classes_this_period: number | null;
  period_resets_on: string | null;
}
