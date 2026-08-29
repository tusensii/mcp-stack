import type { OuraClient } from "./client.js";
import type {
  PersonalInfo,
  DailySleep,
  SleepPeriod,
  SleepTime,
  DailyReadiness,
  DailyActivity,
  HeartrateSample,
  DailyStress,
  DailyResilience,
  DailySpo2,
  DailyCardiovascularAge,
  Workout,
  Session,
  EnhancedTag,
  Vo2Max,
  RestModePeriod,
  RingConfiguration,
  OuraListResponse,
} from "./types.js";

export interface DateParams extends Record<string, string> {
  start_date: string;
  end_date: string;
}

export interface DatetimeParams extends Record<string, string> {
  start_datetime: string;
  end_datetime: string;
}

export async function getPersonalInfo(client: OuraClient): Promise<PersonalInfo> {
  return client.get<PersonalInfo>("/personal_info");
}

export async function getDailySleep(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<DailySleep[]> {
  return client.paginate<DailySleep>("/daily_sleep", params, maxPages);
}

export async function getSleepPeriods(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<SleepPeriod[]> {
  return client.paginate<SleepPeriod>("/sleep", params, maxPages);
}

/**
 * Sleep periods whose `day` falls in [start_date, end_date] inclusive.
 *
 * Oura's `/sleep` endpoint filters by bedtime, not by the `day` field the
 * tools key on, so a period with `day = end_date` whose bedtime_start was
 * the previous evening is dropped by a tight query (#33, #113). We widen
 * the upstream window by one day on each side and post-filter by `day`
 * so callers see exactly the days they asked for, including the latest
 * synced night. Use this instead of `getSleepPeriods` whenever the result
 * is keyed by `day`.
 */
export async function getSleepPeriodsByDay(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<SleepPeriod[]> {
  const padded: DateParams = {
    ...params,
    start_date: shiftYmd(params.start_date, -1),
    end_date: shiftYmd(params.end_date, 1),
  };
  const periods = await getSleepPeriods(client, padded, maxPages);
  return periods.filter((p) => p.day >= params.start_date && p.day <= params.end_date);
}

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getSleepTime(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<SleepTime[]> {
  return client.paginate<SleepTime>("/sleep_time", params, maxPages);
}

export async function getDailyReadiness(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<DailyReadiness[]> {
  return client.paginate<DailyReadiness>("/daily_readiness", params, maxPages);
}

export async function getDailyActivity(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<DailyActivity[]> {
  return client.paginate<DailyActivity>("/daily_activity", params, maxPages);
}

export async function getDailySpo2(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<DailySpo2[]> {
  return client.paginate<DailySpo2>("/daily_spo2", params, maxPages);
}

export async function getDailyStress(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<DailyStress[]> {
  return client.paginate<DailyStress>("/daily_stress", params, maxPages);
}

export async function getDailyResilience(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<DailyResilience[]> {
  return client.paginate<DailyResilience>("/daily_resilience", params, maxPages);
}

export async function getDailyCardiovascularAge(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<DailyCardiovascularAge[]> {
  return client.paginate<DailyCardiovascularAge>("/daily_cardiovascular_age", params, maxPages);
}

export async function getHeartrate(
  client: OuraClient,
  params: DatetimeParams,
  maxPages?: number,
): Promise<HeartrateSample[]> {
  return client.paginate<HeartrateSample>("/heartrate", params, maxPages);
}

export async function getWorkouts(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<Workout[]> {
  return client.paginate<Workout>("/workout", params, maxPages);
}

export async function getSessions(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<Session[]> {
  return client.paginate<Session>("/session", params, maxPages);
}

export async function getEnhancedTags(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<EnhancedTag[]> {
  return client.paginate<EnhancedTag>("/enhanced_tag", params, maxPages);
}

export async function getVo2Max(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<Vo2Max[]> {
  return client.paginate<Vo2Max>("/vO2_max", params, maxPages);
}

export async function getRestModePeriods(
  client: OuraClient,
  params: DateParams,
  maxPages?: number,
): Promise<RestModePeriod[]> {
  return client.paginate<RestModePeriod>("/rest_mode_period", params, maxPages);
}

export async function getRingConfiguration(
  client: OuraClient,
): Promise<OuraListResponse<RingConfiguration>> {
  return client.get<OuraListResponse<RingConfiguration>>("/ring_configuration");
}
