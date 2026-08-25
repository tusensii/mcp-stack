/**
 * Sunrise / sunset / civil dusk at build time (#108).
 *
 * Implements the standard low-precision sunrise equation (NOAA / Meeus
 * abridged), good to roughly a minute at temperate latitudes — well inside
 * the precision anyone plans a Friday climb to. Kept dependency-free: the
 * whole thing is thirty lines of trigonometry and adding an ephemeris library
 * to a report generator is not a trade worth making.
 */

const RAD = Math.PI / 180;
const J2000 = 2451545.0;
const EARTH_OBLIQUITY = 23.4397;

/** Standard refraction-corrected solar altitude for sunrise/sunset. */
const ALTITUDE_HORIZON = -0.833;
/** Civil twilight: enough light to walk without a headlamp. */
const ALTITUDE_CIVIL = -6;

export interface SunTimes {
  /** ISO date the times were computed for, in the requested zone. */
  date: string;
  sunrise: Date | null;
  solar_noon: Date;
  sunset: Date | null;
  /** End of civil twilight — practical "dark". */
  civil_dusk: Date | null;
  /** Null when the sun neither rises nor sets on this date. */
  daylight_minutes: number | null;
}

function julianDayAtUtcMidnight(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000 + 2440587.5;
}

function julianToDate(julian: number): Date {
  return new Date((julian - 2440587.5) * 86_400_000);
}

interface SolarDay {
  transit: number;
  declinationRad: number;
}

function solarDay(isoDate: string, lon: number): SolarDay {
  // West-positive longitude, matching the standard formulation. Solar transit
  // runs *later* than UTC noon as you go west, hence the addition: at 123°W
  // local noon lands around 20:12 UTC.
  const westLon = -lon;
  const n = Math.ceil(julianDayAtUtcMidnight(isoDate) - J2000 + 0.0008);
  const meanSolarTime = n + westLon / 360;

  const meanAnomaly = (357.5291 + 0.98560028 * meanSolarTime) % 360;
  const center =
    1.9148 * Math.sin(meanAnomaly * RAD) +
    0.02 * Math.sin(2 * meanAnomaly * RAD) +
    0.0003 * Math.sin(3 * meanAnomaly * RAD);
  const eclipticLon = (meanAnomaly + center + 180 + 102.9372) % 360;

  const transit =
    J2000 +
    meanSolarTime +
    0.0053 * Math.sin(meanAnomaly * RAD) -
    0.0069 * Math.sin(2 * eclipticLon * RAD);

  const declinationRad = Math.asin(
    Math.sin(eclipticLon * RAD) * Math.sin(EARTH_OBLIQUITY * RAD),
  );
  return { transit, declinationRad };
}

/** Hour angle in degrees for a target solar altitude, or null if never reached. */
function hourAngle(altitudeDeg: number, latDeg: number, declinationRad: number): number | null {
  const latRad = latDeg * RAD;
  const cosOmega =
    (Math.sin(altitudeDeg * RAD) - Math.sin(latRad) * Math.sin(declinationRad)) /
    (Math.cos(latRad) * Math.cos(declinationRad));
  if (cosOmega > 1 || cosOmega < -1) return null;
  return Math.acos(cosOmega) / RAD;
}

/**
 * Sun times for one calendar date at a point.
 *
 * `isoDate` is interpreted as the local date at that longitude, which is what
 * a trip itinerary means by "Friday".
 */
export function sunTimes(isoDate: string, lat: number, lon: number): SunTimes {
  const { transit, declinationRad } = solarDay(isoDate, lon);
  const solarNoon = julianToDate(transit);

  const omegaHorizon = hourAngle(ALTITUDE_HORIZON, lat, declinationRad);
  const omegaCivil = hourAngle(ALTITUDE_CIVIL, lat, declinationRad);

  const sunrise = omegaHorizon === null ? null : julianToDate(transit - omegaHorizon / 360);
  const sunset = omegaHorizon === null ? null : julianToDate(transit + omegaHorizon / 360);
  const civilDusk = omegaCivil === null ? null : julianToDate(transit + omegaCivil / 360);

  return {
    date: isoDate,
    sunrise,
    solar_noon: solarNoon,
    sunset,
    civil_dusk: civilDusk,
    daylight_minutes:
      omegaHorizon === null ? null : Math.round((omegaHorizon / 180) * 24 * 60),
  };
}

/**
 * The moment direct sun leaves camp, given how many minutes early the
 * surrounding terrain cuts it off. Basin walls routinely take an hour off the
 * usable evening and that is the number people pack to, not true sunset.
 */
export function terrainSunset(sunset: Date | null, shadeMinutes: number | undefined): Date | null {
  if (!sunset || !shadeMinutes) return null;
  return new Date(sunset.getTime() - shadeMinutes * 60_000);
}
