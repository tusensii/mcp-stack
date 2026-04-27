// Derived from HAR recon — field names are exact matches to API responses

export interface ClientsMe {
  client: Client;
  organization: Organization;
  portal_configuration: PortalConfiguration;
  locations: LocationBasic[];
}

export interface Client {
  id: number;
  name: string;
  email: string;
  organization_id: number;
  default_user_id: number;
  default_location_id: number;
  time_zone: string;
  portal_features: PortalFeatures;
}

export interface Organization {
  id: number;
  name: string;
  time_zone: string;
}

export interface PortalConfiguration {
  cancellation_window_in_hours: number;
  cancel_appointments: boolean;
  online_booking: boolean;
  secure_messaging: boolean;
}

export interface PortalFeatures {
  online_booking: boolean;
  secure_messaging: boolean;
  cancel_appointments?: boolean;
  demographics?: boolean;
  client_upload?: boolean;
  manage_billing?: boolean;
}

// LocationBasic appears in /clients/me (no phone/address)
export interface LocationBasic {
  id: number;
  name: string;
  service_code_id: number;
  time_zone: string;
}

// LocationFull appears in /organizations/current and /clients/{id}/appointments
export interface LocationFull {
  id: number;
  organization_id: number;
  name: string;
  phone_number: string;
  street_address: string;
  street_address_2?: string;
  city: string;
  region: string;
  postal_code: string;
  postal_code_extension?: string;
  country: string;
  service_code_id: number;
  time_zone: string;
  show_address: boolean;
}

export interface OrganizationsCurrent {
  organization: OrganizationDetail;
  portal_configuration: PortalConfigurationFull;
  locations: LocationFull[];
}

export interface OrganizationDetail {
  id: number;
  name: string;
  phone_number: string;
  time_zone: string;
}

export interface PortalConfigurationFull {
  cancellation_window_in_hours: number;
  cancel_appointments: boolean;
  online_booking: boolean;
  secure_messaging: boolean;
  bill_pay: boolean;
  client_upload: boolean;
  welcome_message: string | null;
}

// Response from GET /clients/{id}/appointments
export interface AppointmentsResponse {
  events: AppointmentEvent[];
  locations: LocationFull[];
  availabilities: OnlineBookingAvailability[];
  service_codes: ServiceCode[];
  users: PractitionerUser[];
  // Pending requests not yet accepted by the practitioner
  appointment_requests?: AppointmentRequest[];
}

export interface AppointmentEvent {
  id: string;                          // composite format e.g. "22420788-260414"
  type: string;
  starts_at: string;                   // ISO with offset, e.g. "2026-04-14T17:00:00.000-07:00"
  ends_at: string;
  location_id: number;
  user_id: number;
  client_id: number;
  organization_id: number;
  // appointment_request_id is null for older events, populated for API-booked ones
  appointment_request_id?: number | null;
}

export interface OnlineBookingAvailability {
  id: number;
  type: string;         // "OnlineBookingAvailability"
  name: string;
  organization_membership_id: number;
  time_zone: string;
  services: AvailabilityService[];
}

export interface AvailabilityService {
  service_code_id: string; // String in HAR (e.g. "54563")
}

export interface ServiceCode {
  id: number;
  code: string;    // CPT code e.g. "90834"
  name: string;    // e.g. "Individual Therapy"
}

export interface PractitionerUser {
  id: number;
  name: string;
}

// Response from GET /availabilities/{id}/range
export type AvailabilityRangeResponse = AvailabilityDay[];

export interface AvailabilityDay {
  date: string;
  status: "available" | "unavailable";
  time_intervals: TimeInterval[];
}

export interface TimeInterval {
  status: "available" | "unavailable";
  starts_at: string; // ISO with offset e.g. "2026-04-21T18:00:00.000-07:00"
}

// Response from POST /appointment_requests
export interface AppointmentRequestResponse {
  appointment_request: AppointmentRequest;
  availability: OnlineBookingAvailability;
  users: PractitionerUser[];
  service_codes: ServiceCode[];
  clients: unknown[];
}

export interface AppointmentRequest {
  id: number;
  client_id: number;
  availability_id: number;
  location_id: number;
  user_id: number;
  starts_at: string;
  ends_at: string;
  service_code_id: string;
  status: "pending" | "accepted" | "cancelled";
}

// Session cache shape (internal to auth.ts).
// auth-rails owns cookies and csrf — they're no longer part of this shape.
export interface Session {
  clientId: number;
  orgId: number;
  availabilityId: number;
  serviceCodeId: number;
  defaultLocationId: number;
  cancellationWindowHours: number;
  expiresAt: number | null;
}
