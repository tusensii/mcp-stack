// Oura Ring v2 API response types.
// Verified against live API responses where available.
// Endpoints with no live data use types from Oura v2 API documentation.

// ---------------------------------------------------------------------------
// Shared structures
// ---------------------------------------------------------------------------

/** Paginated list response wrapper used by most collection endpoints */
export interface OuraListResponse<T> {
  data: T[];
  next_token: string | null;
}

/** Time-series samples object shared by sleep, activity, and session endpoints */
export interface TimeSeriesSamples {
  interval: number;
  items: (number | null)[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// /personal_info — single object response (not paginated)
// ---------------------------------------------------------------------------

export interface PersonalInfo {
  id: string;
  age: number | null;
  weight: number | null; // kg
  height: number | null; // meters
  biological_sex: "male" | "female" | "not_specified" | null;
  email: string | null;
}

// ---------------------------------------------------------------------------
// /daily_sleep
// ---------------------------------------------------------------------------

export interface DailySleepContributors {
  deep_sleep: number | null;
  efficiency: number | null;
  latency: number | null;
  rem_sleep: number | null;
  restfulness: number | null;
  timing: number | null;
  total_sleep: number | null;
}

export interface DailySleep {
  id: string;
  contributors: DailySleepContributors;
  day: string;
  score: number | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// /sleep (detailed sleep periods)
// ---------------------------------------------------------------------------

export interface SleepReadinessContributors {
  activity_balance: number | null;
  body_temperature: number | null;
  hrv_balance: number | null;
  previous_day_activity: number | null;
  previous_night: number | null;
  recovery_index: number | null;
  resting_heart_rate: number | null;
  sleep_balance: number | null;
}

export interface SleepReadiness {
  contributors: SleepReadinessContributors;
  score: number | null;
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
}

export interface SleepPeriod {
  id: string;
  average_breath: number | null;
  average_heart_rate: number | null; // bpm
  average_hrv: number | null; // ms RMSSD
  awake_time: number | null; // seconds
  bedtime_end: string;
  bedtime_start: string;
  day: string;
  deep_sleep_duration: number | null; // seconds
  efficiency: number | null; // 0-100
  heart_rate: TimeSeriesSamples | null;
  hrv: TimeSeriesSamples | null;
  latency: number | null; // seconds
  light_sleep_duration: number | null; // seconds
  low_battery_alert: boolean;
  lowest_heart_rate: number | null; // bpm
  movement_30_sec: string | null;
  period: number;
  readiness: SleepReadiness | null;
  readiness_score_delta: number | null;
  rem_sleep_duration: number | null; // seconds
  restless_periods: number | null;
  sleep_algorithm_version: string | null;
  sleep_analysis_reason: string | null;
  sleep_phase_30_sec: string | null;
  sleep_phase_5_min: string | null;
  sleep_score_delta: number | null;
  time_in_bed: number | null; // seconds
  total_sleep_duration: number | null; // seconds
  type: "deleted" | "sleep" | "long_sleep" | "late_nap" | "rest";
  ring_id: string | null;
  app_sleep_phase_5_min: string | null;
}

// ---------------------------------------------------------------------------
// /sleep_time
// ---------------------------------------------------------------------------

/** Present when sleep_time status is not "not_enough_nights"; null otherwise */
export interface OptimalBedtime {
  day_tz: number;
  end_offset: number;
  start_offset: number;
}

export interface SleepTime {
  id: string;
  day: string;
  optimal_bedtime: OptimalBedtime | null;
  recommendation: "improve_efficiency" | "earlier_bedtime" | "later_bedtime" | "maintain_schedule" | "not_enough_nights" | "not_enough_recent_nights" | "bad_sleep_quality" | "only_recommended_found" | null;
  status: "not_enough_data" | "same_bedtime" | "earlier_bedtime" | "later_bedtime" | null;
}

// ---------------------------------------------------------------------------
// /daily_readiness
// ---------------------------------------------------------------------------

export interface ReadinessContributors {
  activity_balance: number | null;
  body_temperature: number | null;
  hrv_balance: number | null;
  previous_day_activity: number | null;
  previous_night: number | null;
  recovery_index: number | null;
  resting_heart_rate: number | null;
  sleep_balance: number | null;
  sleep_regularity: number | null;
}

export interface DailyReadiness {
  id: string;
  contributors: ReadinessContributors;
  day: string;
  score: number | null;
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// /daily_activity
// ---------------------------------------------------------------------------

export interface ActivityContributors {
  meet_daily_targets: number | null;
  move_every_hour: number | null;
  recovery_time: number | null;
  stay_active: number | null;
  training_frequency: number | null;
  training_volume: number | null;
}

export interface DailyActivity {
  id: string;
  active_calories: number;
  average_met_minutes: number;
  class_5_min: string | null;
  contributors: ActivityContributors;
  day: string;
  equivalent_walking_distance: number; // meters
  high_activity_met_minutes: number;
  high_activity_time: number; // seconds
  inactivity_alerts: number;
  low_activity_met_minutes: number;
  low_activity_time: number; // seconds
  medium_activity_met_minutes: number;
  medium_activity_time: number; // seconds
  met: TimeSeriesSamples | null;
  meters_to_target: number | null; // meters
  non_wear_time: number; // seconds
  resting_time: number; // seconds
  score: number | null;
  sedentary_met_minutes: number;
  sedentary_time: number; // seconds
  steps: number;
  target_calories: number | null;
  target_meters: number | null; // meters
  timestamp: string;
  total_calories: number;
}

// ---------------------------------------------------------------------------
// /heartrate
// ---------------------------------------------------------------------------

export interface HeartrateSample {
  timestamp: string;
  bpm: number; // bpm
  producer_timestamp: number;
  source: "awake" | "rest" | "sleep" | "session" | "live" | "workout";
}

// ---------------------------------------------------------------------------
// /daily_stress
// ---------------------------------------------------------------------------

export interface DailyStress {
  id: string;
  day: string;
  day_summary: "restored" | "normal" | "stressful" | "unknown" | null;
  recovery_high: number | null; // seconds
  stress_high: number | null; // seconds
}

// ---------------------------------------------------------------------------
// /daily_resilience
// ---------------------------------------------------------------------------

export interface ResilienceContributors {
  sleep_recovery: number | null;
  daytime_recovery: number | null;
  stress: number | null;
}

export interface DailyResilience {
  id: string;
  day: string;
  contributors: ResilienceContributors;
  level: "exceptional" | "strong" | "adequate" | "limited" | "poor" | null;
}

// ---------------------------------------------------------------------------
// /daily_spo2
// ---------------------------------------------------------------------------

export interface Spo2Percentage {
  average: number;
}

export interface DailySpo2 {
  id: string;
  breathing_disturbance_index: number | null;
  day: string;
  spo2_percentage: Spo2Percentage | null;
}

// ---------------------------------------------------------------------------
// /daily_cardiovascular_age
// ---------------------------------------------------------------------------

export interface DailyCardiovascularAge {
  id: string;
  day: string;
  pulse_wave_velocity: number | null;
  vascular_age: number | null;
}

// ---------------------------------------------------------------------------
// /workout
// ---------------------------------------------------------------------------

export interface Workout {
  id: string;
  activity: string;
  calories: number | null;
  day: string;
  distance: number | null; // meters
  end_datetime: string;
  intensity: "easy" | "moderate" | "hard" | null;
  label: string | null;
  source: "manual" | "confirmed" | "workout_heart_rate" | "detected";
  start_datetime: string;
  steps: number | null;
}

// ---------------------------------------------------------------------------
// /session
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  day: string;
  end_datetime: string;
  heart_rate: TimeSeriesSamples | null;
  heart_rate_variability: TimeSeriesSamples | null;
  mood: "bad" | "worse" | "same" | "good" | "great" | null;
  motion_count: TimeSeriesSamples | null;
  start_datetime: string;
  type: "breathing" | "meditation" | "nap" | "relaxation" | "rest" | "body_status";
}

// ---------------------------------------------------------------------------
// /enhanced_tag
// ---------------------------------------------------------------------------

/**
 * NOTE: The live API returns this shape (with start_time/end_time/start_day/end_day/comment/custom_name),
 * which differs from the older documented shape. Tool descriptions must use `comment` (not `text`)
 * and `start_day` (not `day`) when referencing tag fields.
 */
export interface EnhancedTag {
  id: string;
  tag_type_code: string;
  start_time: string;
  end_time: string | null;
  start_day: string;
  end_day: string | null;
  comment: string | null;
  custom_name: string | null;
}

// ---------------------------------------------------------------------------
// /vO2_max — No sample data available (empty array returned); types from docs
// ---------------------------------------------------------------------------

export interface Vo2Max {
  id: string;
  day: string;
  timestamp: string;
  vo2_max: number | null;
}

// ---------------------------------------------------------------------------
// /rest_mode_period
// ---------------------------------------------------------------------------

export interface RestModeEpisode {
  tags: string[];
  timestamp: string;
}

export interface RestModePeriod {
  id: string;
  end_day: string | null;
  end_time: string | null;
  episodes: RestModeEpisode[];
  start_day: string;
  start_time: string;
}

// ---------------------------------------------------------------------------
// /ring_configuration
// ---------------------------------------------------------------------------

export interface RingConfiguration {
  id: string;
  color: string | null;
  design: string | null;
  firmware_version: string | null;
  hardware_type: string | null;
  set_up_at: string | null;
  size: number | null;
}

// ---------------------------------------------------------------------------
// Derived types for tool output
// ---------------------------------------------------------------------------

/** Derived type for oura_hrv_trend tool output */
export interface HrvTrendEntry {
  date: string;
  average_hrv: number | null;
  lowest_hrv: number | null;
  average_heart_rate: number | null;
  lowest_heart_rate: number | null;
}
