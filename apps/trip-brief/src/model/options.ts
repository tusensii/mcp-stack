/**
 * Options-card model (#106).
 *
 * The group's criteria — dry, minimal thunder risk, self-issued or
 * unpermitted, inside the drive budget — stop living in chat and become a
 * config block that every candidate is scored against identically.
 *
 * A candidate that fails is never dropped. It renders as disqualified with
 * the criterion that killed it named, so a trail someone proposed by
 * screenshot stays visible as considered-and-rejected rather than
 * disappearing between messages.
 */

import type { Candidate, Criteria, OptionsConfig } from "../config/schema.ts";
import type { CandidatePull, OptionsPull } from "../mcp/pull.ts";
import type { LinkVerdict } from "../provenance/links.ts";
import { linkDisposition } from "../provenance/links.ts";
import { SourceLedger } from "../provenance/tiers.ts";
import * as T from "../prose/templates.ts";
import type { CitationEntry, RenderedLink } from "./trip.ts";
import { rollupDaily } from "./trip.ts";
import {
  enumerateDates,
  formatDateRange,
  formatShortWeekday,
  formatTimestamp,
  formatWeekday,
} from "../util/datetime.ts";

export type CriterionKey =
  | "precip"
  | "thunder"
  | "permit"
  | "drive"
  | "style"
  | "data";

export interface CriterionFailure {
  criterion: CriterionKey;
  /** One line naming the criterion and the value that missed it. */
  detail: string;
}

export interface CandidateDay {
  iso: string;
  weekday: string;
  short_weekday: string;
  precip_pct: number | null;
  high_f: number | null;
  low_f: number | null;
  thunder: boolean;
}

export interface CandidateCard {
  id: string;
  name: string;
  region: string;
  style: Candidate["style"];
  permit_mechanism: Candidate["permit_mechanism"];
  drive_hours: number;
  drive_label: string;
  proposed_by: string | null;
  note: string | null;
  days: CandidateDay[];
  /** Worst daily precipitation probability across the window. */
  max_precip_pct: number | null;
  thunder_days: string[];
  thunder_label: string;
  summary: string[];
  links: RenderedLink[];
  qualified: boolean;
  failures: CriterionFailure[];
}

export interface OptionsModel {
  slug: string;
  title: string;
  subtitle: string | null;
  date_range: string;
  timezone: string;
  criteria_lines: string[];
  /** Drawn as the threshold line on every candidate's precipitation chart. */
  precip_limit_pct: number;
  qualified: CandidateCard[];
  disqualified: CandidateCard[];
  excluded_regions: Array<{ name: string; reason: string }>;
  citations: CitationEntry[];
  warnings: string[];
  refresh_line: string;
  generated_at: Date;
}

const MECHANISM_LABEL: Record<Candidate["permit_mechanism"], string> = {
  none: "no permit",
  "self-issue": "self-issue at the trailhead",
  "walk-up": "walk-up permit",
  reservation: "advance reservation",
  lottery: "lottery",
};

export function criteriaLines(criteria: Criteria): string[] {
  return [
    `Precipitation probability at or below ${criteria.max_precip_pct}% on every trip day.`,
    criteria.thunder === "none"
      ? "No thunderstorms mentioned in the forecast."
      : criteria.thunder === "low"
        ? "No active thunderstorm watch or warning; a mention in the narrative is tolerated."
        : "Thunderstorm risk is not a disqualifier.",
    `Permit mechanism is one of: ${T.joinList(
      criteria.permit_mechanisms.map((m) => MECHANISM_LABEL[m]),
    )}.`,
    `Drive is at or under ${T.hours(criteria.max_drive_hours)}.`,
    `Trip style is ${T.joinList(criteria.styles.map((s) => (s === "backpack" ? "backpacking" : "car camping")))}.`,
  ];
}

/**
 * Score one candidate. Every criterion is evaluated even after the first
 * failure, so the card can say "too wet *and* outside the drive budget"
 * rather than making the group re-ask.
 */
export function scoreCandidate(
  pull: CandidatePull,
  cfg: OptionsConfig,
  linkVerdicts: Map<string, LinkVerdict>,
): CandidateCard {
  const { candidate } = pull;
  const tz = cfg.timezone;
  const criteria = cfg.criteria;
  const failures: CriterionFailure[] = [];

  const weather = pull.weather.payload.data;
  const daily = rollupDaily(weather?.daily ?? []);
  const dates = enumerateDates(cfg.dates.start, cfg.dates.end);

  const days: CandidateDay[] = dates.map((iso) => {
    const row = daily.get(iso);
    return {
      iso,
      weekday: formatWeekday(iso, tz),
      short_weekday: formatShortWeekday(iso, tz),
      precip_pct: row?.precip_pct ?? null,
      high_f: row?.high_f ?? null,
      low_f: row?.low_f ?? null,
      thunder: row?.thunder ?? false,
    };
  });

  const precipValues = days
    .map((d) => d.precip_pct)
    .filter((v): v is number => v != null);
  const maxPrecip = precipValues.length ? Math.max(...precipValues) : null;

  // A candidate whose forecast never arrived is disqualified on data, not
  // quietly passed for having no numbers to fail against.
  if (!precipValues.length) {
    failures.push({
      criterion: "data",
      detail: pull.weather.error
        ? `No forecast: ${pull.weather.error}`
        : "No forecast covered the trip window.",
    });
  } else if (maxPrecip != null && maxPrecip > criteria.max_precip_pct) {
    failures.push({
      criterion: "precip",
      detail: `Precipitation peaks at ${T.pct(maxPrecip)}, over the ${criteria.max_precip_pct}% limit.`,
    });
  }

  const thunderDays = days.filter((d) => d.thunder).map((d) => d.weekday);
  const alerts = weather?.alerts ?? [];
  const thunderAlert = alerts.some((a) =>
    /thunder|severe/i.test(`${a.event ?? ""} ${a.headline ?? ""}`),
  );
  if (criteria.thunder === "none" && thunderDays.length) {
    failures.push({
      criterion: "thunder",
      detail: `Thunderstorms in the forecast for ${T.joinList(thunderDays)}.`,
    });
  } else if (criteria.thunder === "low" && thunderAlert) {
    failures.push({
      criterion: "thunder",
      detail: "An active thunderstorm watch or warning covers the point.",
    });
  }

  if (!criteria.permit_mechanisms.includes(candidate.permit_mechanism)) {
    failures.push({
      criterion: "permit",
      detail: `Requires ${MECHANISM_LABEL[candidate.permit_mechanism]}, which is outside the allowed mechanisms.`,
    });
  }

  if (candidate.drive_hours > criteria.max_drive_hours) {
    failures.push({
      criterion: "drive",
      detail: `Drive is ${T.hours(candidate.drive_hours)}, over the ${T.hours(criteria.max_drive_hours)} budget.`,
    });
  }

  if (!criteria.styles.includes(candidate.style)) {
    failures.push({
      criterion: "style",
      detail: `Is ${candidate.style === "backpack" ? "a backpacking trip" : "car camping"}, which the group ruled out for this weekend.`,
    });
  }

  const summary = days
    .filter((d) => d.precip_pct != null || d.high_f != null)
    .map((d) =>
      T.dayForecastSentence({
        weekday: d.weekday,
        precip_pct: d.precip_pct,
        high_f: d.high_f,
        low_f: d.low_f,
      }),
    );
  summary.push(thunderDays.length ? T.thunderSentence(thunderDays)! : T.noThunderSentence());

  const links: RenderedLink[] = candidate.links.map((l) => {
    const { render, verdict } = linkDisposition(l.url, linkVerdicts);
    return {
      label: l.label,
      url: verdict.final_url ?? l.url,
      render,
      requires_network: l.requires_network,
      ...(verdict.reason ? { note: verdict.reason } : {}),
    };
  });

  return {
    id: candidate.id,
    name: candidate.name,
    region: candidate.region,
    style: candidate.style,
    permit_mechanism: candidate.permit_mechanism,
    drive_hours: candidate.drive_hours,
    drive_label: T.hours(candidate.drive_hours) ?? "—",
    proposed_by: candidate.proposed_by ?? null,
    note: candidate.note ?? null,
    days,
    max_precip_pct: maxPrecip,
    thunder_days: thunderDays,
    thunder_label: thunderDays.length ? T.joinList(thunderDays) : "none",
    summary,
    links,
    qualified: failures.length === 0,
    failures,
  };
}

export interface BuildOptionsInput {
  config: OptionsConfig;
  pull: OptionsPull;
  linkVerdicts: Map<string, LinkVerdict>;
  generated_at?: Date;
}

export function buildOptionsModel(input: BuildOptionsInput): OptionsModel {
  const { config: cfg, pull, linkVerdicts } = input;
  const generated_at = input.generated_at ?? pull.pulled_at;
  const ledger = new SourceLedger();
  const warnings: string[] = [];

  const cards = pull.candidates.map((c) => {
    ledger.addPayload(c.weather.payload, c.weather.tier);
    ledger.addPayload(c.conditions.payload, c.conditions.tier);
    if (c.weather.error) {
      warnings.push(`${c.candidate.name}: forecast unavailable (${c.weather.error}).`);
    }
    return scoreCandidate(c, cfg, linkVerdicts);
  });

  for (const card of cards) {
    for (const l of card.links) {
      if (l.render === "text") {
        warnings.push(`Link not verified, rendered as plain text: ${l.url}`);
      }
    }
  }

  // Qualified candidates lead with the driest; disqualified keep config order
  // so the group can find the one they proposed.
  const qualified = cards
    .filter((c) => c.qualified)
    .sort((a, b) => {
      const precip = (a.max_precip_pct ?? 101) - (b.max_precip_pct ?? 101);
      if (precip !== 0) return precip;
      const drive = a.drive_hours - b.drive_hours;
      if (drive !== 0) return drive;
      return a.name.localeCompare(b.name);
    });
  const disqualified = cards.filter((c) => !c.qualified);

  const citations: CitationEntry[] = ledger.entries().map(({ source, tier }) => {
    const { render } = linkDisposition(source.url, linkVerdicts);
    return {
      name: source.name,
      url: source.url,
      tier,
      tier_label: tier === "live-instrument"
        ? "Live instrument / issued forecast"
        : tier === "official-static"
          ? "Official published"
          : tier === "community"
            ? "Community report"
            : "Catalog lookup / inference",
      render,
    };
  });

  return {
    slug: cfg.slug,
    title: cfg.title,
    subtitle: cfg.subtitle ?? null,
    date_range: formatDateRange(cfg.dates.start, cfg.dates.end, cfg.timezone),
    timezone: cfg.timezone,
    criteria_lines: criteriaLines(cfg.criteria),
    precip_limit_pct: cfg.criteria.max_precip_pct,
    qualified,
    disqualified,
    excluded_regions: cfg.excluded_regions,
    citations,
    warnings,
    refresh_line: `Data refreshed ${formatTimestamp(generated_at, cfg.timezone)}.`,
    generated_at,
  };
}

/** Every URL an options build will render, for the verification pass. */
export function optionsUrls(cfg: OptionsConfig): string[] {
  return cfg.candidates.flatMap((c) => c.links.map((l) => l.url));
}
