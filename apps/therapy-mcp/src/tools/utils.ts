export { textContent, errorContent } from "@mcp-stack/mcp-core";

/**
 * Given an ISO timestamp string that already contains a UTC offset
 * (e.g. "2026-04-21T18:00:00.000-07:00"), return both forms:
 * - local: the string as-is (already has offset)
 * - utc: the same instant in UTC ISO format
 */
export function toUtc(isoWithOffset: string): string {
  return new Date(isoWithOffset).toISOString();
}

/**
 * Convert any ISO timestamp (any offset or Z) to a local ISO string with the
 * correct offset for the given IANA timezone.
 * e.g. "2026-04-21T20:00:00.000-05:00" (CDT) → "2026-04-21T18:00:00-07:00" (PDT)
 */
export function toLocalIso(utcOrOffsetStr: string, timezone = "America/Los_Angeles"): string {
  const d = new Date(utcOrOffsetStr);
  const utcMs = d.getTime();

  // sv-SE locale gives "YYYY-MM-DD HH:MM:SS" in the target timezone
  const localStr = d.toLocaleString("sv-SE", { timeZone: timezone });

  // Compute offset: treat local string as UTC to get offset ms
  const localMs = new Date(localStr.replace(" ", "T") + "Z").getTime();
  const offsetMs = localMs - utcMs;
  const sign = offsetMs >= 0 ? "+" : "-";
  const absMin = Math.abs(Math.round(offsetMs / 60000));
  const h = String(Math.floor(absMin / 60)).padStart(2, "0");
  const m = String(absMin % 60).padStart(2, "0");

  return `${localStr.replace(" ", "T")}${sign}${h}:${m}`;
}

/**
 * Add minutes to an ISO timestamp that already contains an offset.
 * Preserves the original offset in the output string.
 * Used to compute ends_at from starts_at + duration_minutes.
 */
export function addMinutesToIso(isoWithOffset: string, minutes: number): string {
  const d = new Date(isoWithOffset);
  const newMs = d.getTime() + minutes * 60_000;
  const newD = new Date(newMs);

  const offsetMatch = isoWithOffset.match(/([+-]\d{2}:\d{2})$/);
  if (!offsetMatch) return newD.toISOString();

  const offset = offsetMatch[1];
  const sign = offset[0] === "+" ? 1 : -1;
  const [oh, om] = offset.slice(1).split(":").map(Number);
  const offsetMs = sign * (oh * 60 + om) * 60_000;

  const localD = new Date(newD.getTime() + offsetMs);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    `${localD.getUTCFullYear()}-${pad(localD.getUTCMonth() + 1)}-${pad(localD.getUTCDate())}` +
    `T${pad(localD.getUTCHours())}:${pad(localD.getUTCMinutes())}:${pad(localD.getUTCSeconds())}` +
    offset
  );
}

/**
 * Format a full location object for tool output.
 */
export function formatLocation(loc: {
  id: number;
  name: string;
  phone_number: string;
  street_address?: string;
  street_address_2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  show_address?: boolean;
}): { id: number; name: string; address?: string; phone: string } {
  let address: string | undefined;
  if (
    loc.show_address !== false &&
    loc.street_address &&
    loc.city
  ) {
    address = [
      loc.street_address,
      loc.street_address_2,
      `${loc.city}, ${loc.region} ${loc.postal_code}`,
    ]
      .filter(Boolean)
      .join(", ");
  }
  return { id: loc.id, name: loc.name, address, phone: loc.phone_number };
}
