/**
 * Sessions Health auth + endpoint discovery.
 *
 * Cookie/CSRF/login mechanics live in @mcp-stack/auth-rails. This module
 * keeps the Sessions-Health-specific bits: discovering the practitioner's
 * availability_id and service_code_id from /clients/me and
 * /clients/{id}/appointments, and caching the resulting Session at module
 * scope so login + discovery only run once per Worker isolate.
 */

import {
  createRailsAuthClient,
  type RailsAuthClient,
} from "@mcp-stack/auth-rails";
import type {
  Session,
  ClientsMe,
  AppointmentsResponse,
} from "./types.js";

export const BASE_URL =
  "https://YOUR_PRACTICE.sessionshealth.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

export interface AuthEnv {
  STC_EMAIL: string;
  STC_PASSWORD: string;
}

// Module-scope caches: stable across requests within a Worker isolate, so
// login (3 round-trips) + endpoint discovery only happens once.
let cachedAuth: RailsAuthClient | null = null;
let cachedSession: Session | null = null;

function buildAuth(env: AuthEnv): RailsAuthClient {
  return createRailsAuthClient({
    baseUrl: BASE_URL,
    email: env.STC_EMAIL,
    password: env.STC_PASSWORD,
    loginPath: "/clients/sign_in",
    postLoginPath: "/appointments",
    resource: "client", // form fields: client[email], client[password]
    sendReferer: true,
    userAgent: UA,
    defaultHeaders: {
      Accept: "application/json, text/javascript",
    },
  });
}

export function getAuth(env: AuthEnv): RailsAuthClient {
  if (cachedAuth) return cachedAuth;
  cachedAuth = buildAuth(env);
  return cachedAuth;
}

export async function getSession(env: AuthEnv): Promise<Session> {
  if (cachedSession) return cachedSession;
  const auth = getAuth(env);
  cachedSession = await loginAndDiscover(auth);
  return cachedSession;
}

export function invalidateSession(): void {
  cachedSession = null;
  if (cachedAuth) cachedAuth.invalidateSession();
}

/**
 * Run the Sessions-Health-specific discovery flow, assuming auth-rails has
 * (or will lazily) handle login. Fetches /clients/me to learn the client +
 * organization + default_location_id + cancellation_window_in_hours, then
 * /clients/{id}/appointments to discover the practitioner's
 * availability_id and the bookable service_code_id (preferring CPT 90834,
 * Individual Therapy).
 */
async function loginAndDiscover(auth: RailsAuthClient): Promise<Session> {
  // Step 1: GET /clients/me — also triggers the auth-rails lazy login.
  const me = await auth.json<ClientsMe>("/clients/me", {
    headers: {
      Accept: "application/json, text/javascript",
      Referer: `${BASE_URL}/appointments`,
    },
  });

  const clientId = me.client.id;
  const orgId = me.organization.id;
  const defaultLocationId = me.client.default_location_id;
  const cancellationWindowHours =
    me.portal_configuration.cancellation_window_in_hours;

  // Step 2: discover availability_id + service_code_id
  const { availabilityId, serviceCodeId } = await discoverBookingIds(
    auth,
    clientId,
  );

  return {
    clientId,
    orgId,
    availabilityId,
    serviceCodeId,
    defaultLocationId,
    cancellationWindowHours,
    expiresAt: null,
  };
}

async function discoverBookingIds(
  auth: RailsAuthClient,
  clientId: number,
): Promise<{ availabilityId: number; serviceCodeId: number }> {
  const data = await auth.json<AppointmentsResponse>(
    `/clients/${clientId}/appointments`,
    {
      headers: {
        Accept: "application/json, text/javascript",
        Referer: `${BASE_URL}/appointments`,
      },
    },
  );

  // Find the OnlineBookingAvailability for this practitioner
  const availability = data.availabilities.find(
    (a) => a.type === "OnlineBookingAvailability",
  );
  if (!availability) {
    throw new Error(
      "Could not discover practitioner availability or service code. " +
        "Re-run the DevTools HAR capture and update the spec with the missing endpoints.",
    );
  }

  // Find Individual Therapy service code (CPT 90834) from the availability's services
  // service_code_id values in availability.services are strings in the API response
  const individualTherapyCode = data.service_codes.find(
    (sc) => sc.code === "90834",
  );

  // Prefer CPT 90834 (Individual Therapy) if it's in the availability's service list.
  // If the practitioner changed service codes, fall back to the first available one.
  let serviceCodeId: number | undefined;

  if (individualTherapyCode) {
    const inAvailability = availability.services.some(
      (s) => s.service_code_id === String(individualTherapyCode.id),
    );
    if (inAvailability) {
      serviceCodeId = individualTherapyCode.id;
    }
  }

  if (serviceCodeId === undefined) {
    // 90834 not in this availability — use whatever service code is listed
    const firstServiceId = availability.services[0]?.service_code_id;
    if (!firstServiceId) {
      throw new Error(
        "Could not discover any bookable service code for this practitioner. " +
          "Re-run the DevTools HAR capture and update the spec with the missing endpoints.",
      );
    }
    serviceCodeId = parseInt(firstServiceId, 10);
  }

  return { availabilityId: availability.id, serviceCodeId };
}
