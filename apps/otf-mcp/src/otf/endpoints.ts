import { API_CO, API_IO, otfGet, otfPost, otfDelete } from "./client.js";
import type { AuthEnv } from "./auth.js";
import type {
  RawClass,
  RawBookingV2,
  RawStudioDetail,
  RawMemberDetail,
  RawMembership,
} from "./types.js";

// Validate that an ID is safe to interpolate into a URL path segment.
// OTF IDs are UUIDs or short alphanumeric strings — reject anything that could
// alter URL structure (path traversal, query injection, etc.).
function assertSafeId(id: string, name: string): void {
  if (!/^[a-zA-Z0-9_\-]{1,128}$/.test(id)) {
    throw new Error(`Invalid ${name}: contains unexpected characters`);
  }
}

// ─── Classes ─────────────────────────────────────────────────────────────────

export async function fetchClasses(
  studioUuids: string[],
  env: AuthEnv,
): Promise<RawClass[]> {
  // /v1/classes returns ALL upcoming classes — no server-side date filter.
  // Client-side filtering happens in the tool handler.
  // studio_ids is passed as repeated query params: studio_ids[]=a&studio_ids[]=b
  const resp = await otfGet<{ items: RawClass[] }>(
    API_IO,
    "/v1/classes",
    env,
    { "studio_ids": studioUuids },
  );
  return resp.items;
}

// ─── Bookings ────────────────────────────────────────────────────────────────

export async function fetchBookings(
  startsAfter: string,  // ISO UTC
  endsBefore: string,   // ISO UTC
  includeCanceled: boolean,
  env: AuthEnv,
): Promise<RawBookingV2[]> {
  const resp = await otfGet<{ items: RawBookingV2[] }>(
    API_IO,
    "/v1/bookings/me",
    env,
    {
      starts_after: startsAfter,
      ends_before: endsBefore,
      include_canceled: String(includeCanceled),
    },
  );
  return resp.items;
}

export async function postBooking(
  classId: string,
  waitlist: boolean,
  env: AuthEnv,
): Promise<RawBookingV2> {
  assertSafeId(classId, "class_id");
  // confirmed: false — UI-acknowledgment flag; server processes booking regardless.
  // Confirmed in otf_api/api/bookings/booking_api.py:467
  return otfPost<RawBookingV2>(API_IO, "/v1/bookings/me", env, {
    class_id: classId,
    confirmed: false,
    waitlist,
  });
}

export async function deleteBooking(bookingId: string, env: AuthEnv): Promise<void> {
  assertSafeId(bookingId, "booking_id");
  // New cancel endpoint — no "confirmed" query param needed (that's the old API only)
  await otfDelete(API_IO, `/v1/bookings/me/${bookingId}`, env);
}

// ─── Studios ─────────────────────────────────────────────────────────────────

export async function fetchStudioDetail(
  studioUuid: string,
  env: AuthEnv,
): Promise<RawStudioDetail> {
  assertSafeId(studioUuid, "studio_uuid");
  const resp = await otfGet<{ data: Record<string, unknown> }>(
    API_CO,
    `/mobile/v1/studios/${studioUuid}`,
    env,
  );
  const raw = resp.data;
  // The studio location object from this endpoint
  const loc = (raw["studioLocation"] ?? {}) as Record<string, unknown>;

  // Normalize address fields — the API uses "physical*" prefix on this endpoint.
  // Mirrors the Python lib's AliasChoices in AddressMixin.
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = loc[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };

  return {
    studioUUId: raw["studioUUId"] as string,
    studioName: (raw["studioName"] ?? null) as string | null,
    timeZone: (raw["timeZone"] ?? null) as string | null,
    studioStatus: (raw["studioStatus"] ?? null) as string | null,
    distance: (raw["distance"] ?? null) as number | null,
    studioLocation: {
      address1: pick("physicalAddress", "address1", "address", "line1"),
      address2: pick("physicalAddress2", "address2", "line2"),
      city: pick("physicalCity", "city", "suburb"),
      state: pick("physicalState", "state", "territory"),
      postalCode: pick("physicalPostalCode", "postalCode", "postal_code"),
      country: pick("physicalCountry", "country"),
      phoneNumber: pick("phoneNumber", "phone"),
      latitude: typeof loc["latitude"] === "number" ? loc["latitude"] : null,
      longitude: typeof loc["longitude"] === "number" ? loc["longitude"] : null,
    },
  };
}

export async function searchStudiosByGeo(
  latitude: number,
  longitude: number,
  distanceMiles: number,
  env: AuthEnv,
): Promise<RawStudioDetail[]> {
  // Paginate — but for personal use (distance ≤ 50mi) one page of 100 is always enough.
  // Workers subrequest limit is 50 on free tier; one page call is safe.
  const resp = await otfGet<{
    data: { studios: RawStudioDetail[]; pagination: { totalCount: number } };
  }>(API_CO, "/mobile/v1/studios", env, {
    latitude,
    longitude,
    distance: distanceMiles,
    pageIndex: 1,
    pageSize: 100,
  });
  return resp.data.studios ?? [];
}

// ─── Member ───────────────────────────────────────────────────────────────────

export async function fetchMemberDetail(
  memberUuid: string,
  env: AuthEnv,
): Promise<RawMemberDetail> {
  assertSafeId(memberUuid, "member_uuid");
  const resp = await otfGet<{ data: RawMemberDetail }>(
    API_CO,
    `/member/members/${memberUuid}`,
    env,
    { include: "memberAddresses,memberClassSummary" },
  );
  return resp.data;
}

export async function fetchMemberships(
  memberUuid: string,
  env: AuthEnv,
): Promise<RawMembership[]> {
  assertSafeId(memberUuid, "member_uuid");
  const resp = await otfGet<{ data: RawMembership[] }>(
    API_CO,
    `/member/members/${memberUuid}/memberships`,
    env,
  );
  return Array.isArray(resp.data) ? resp.data : [];
}
