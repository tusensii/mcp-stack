import { shGet, shPost, shPatch } from "./client.js";
import { getSession } from "./auth.js";
import type { AuthEnv } from "./auth.js";
import type {
  ClientsMe,
  OrganizationsCurrent,
  AppointmentsResponse,
  AvailabilityRangeResponse,
  AppointmentRequestResponse,
} from "./types.js";

export async function fetchClientsMe(env: AuthEnv): Promise<ClientsMe> {
  return shGet<ClientsMe>("/clients/me", env);
}

export async function fetchOrganizationsCurrent(
  env: AuthEnv
): Promise<OrganizationsCurrent> {
  return shGet<OrganizationsCurrent>("/organizations/current", env);
}

export async function fetchAppointments(
  env: AuthEnv
): Promise<AppointmentsResponse> {
  const session = await getSession(env);
  return shGet<AppointmentsResponse>(
    `/clients/${session.clientId}/appointments`,
    env
  );
}

export async function fetchAvailabilityRange(
  env: AuthEnv,
  startsAt: string,
  endsAt: string
): Promise<AvailabilityRangeResponse> {
  const session = await getSession(env);
  return shGet<AvailabilityRangeResponse>(
    `/availabilities/${session.availabilityId}/range`,
    env,
    {
      service_code_id: String(session.serviceCodeId),
      starts_at: startsAt,
      ends_at: endsAt,
    }
  );
}

export async function createAppointmentRequest(
  env: AuthEnv,
  startsAtUtc: string,
  locationId?: number
): Promise<AppointmentRequestResponse> {
  const session = await getSession(env);
  const body = {
    appointment_request: {
      birth_date: null,
      email: null,
      first_name: null,
      last_name: null,
      message: null,
      phone_number: null,
      starts_at: startsAtUtc,
      // API requires string values for these IDs
      availability_id: String(session.availabilityId),
      client_id: String(session.clientId),
      location_id: String(locationId ?? session.defaultLocationId),
      service_code_id: String(session.serviceCodeId),
    },
  };
  return shPost<AppointmentRequestResponse>("/appointment_requests", env, body);
}

export async function cancelAppointmentRequest(
  env: AuthEnv,
  appointmentRequestId: number
): Promise<void> {
  await shPatch(`/appointment_requests/${appointmentRequestId}/cancel`, env);
}
