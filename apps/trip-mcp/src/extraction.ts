/**
 * Heuristic condition extraction from trip-report text (issue #81,
 * design option 1: keyword/regex in the Worker — cheap, deterministic,
 * decent recall on WTA's formulaic reports; labeled low confidence).
 *
 * Contract: NEVER fabricate specifics. A field absent from the text is
 * {mentioned: false, detail: null} — nothing is inferred. The interface
 * is shaped so an LLM extractor could swap in later (same output type,
 * different `method` label).
 */

export interface ConditionMention {
  mentioned: boolean;
  /** Short verbatim-ish snippet around the match; null when unmentioned. */
  detail: string | null;
}

export interface SnowMention extends ConditionMention {
  snow_line_ft: number | null;
}

export interface BugMention extends ConditionMention {
  severity: "low" | "moderate" | "high" | null;
}

export interface ExtractedConditions {
  snow: SnowMention;
  blowdowns: ConditionMention;
  road_status: ConditionMention;
  bugs: BugMention;
  water: ConditionMention;
  crowding: ConditionMention;
}

/** Grab a readable snippet around a regex match. */
function snippet(text: string, index: number, matchLen: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + matchLen + 80);
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) s = `…${s}`;
  if (end < text.length) s = `${s}…`;
  return s.slice(0, 200);
}

function findMention(text: string, re: RegExp): ConditionMention {
  const m = re.exec(text);
  if (!m || m.index === undefined) return { mentioned: false, detail: null };
  return { mentioned: true, detail: snippet(text, m.index, m[0].length) };
}

const SNOW_RE = /\bsnow(?:y|field|fields|pack|line)?\b/i;
const SNOW_LINE_RE =
  /snow[^.]{0,40}?(?:at|above|around|near|starting|from|by)\s*~?\s*(\d{1,2}[,]?\d{3})\s*(?:ft|feet|')/i;
const BLOWDOWN_RE = /blow[- ]?downs?|downed trees?|trees? (?:down|across)|deadfall|windfall/i;
const ROAD_RE =
  /road (?:is )?(?:closed|washed|rough|gated|open|fine)|washout|wash-out|high[- ]clearance|pot[- ]?holes?|\bFR[- ]?\d+|forest road/i;
const BUG_RE = /mosquito(?:e?s)?|\bbugs?\b|black ?fl(?:y|ies)|biting insects/i;
const BUG_HIGH_RE = /swarm|relentless|brutal|awful|terrible|thick|vicious|miserable|ate (?:me|us) alive/i;
const BUG_LOW_RE = /no (?:bugs|mosquito)|bug[- ]free|few (?:bugs|mosquito)|not (?:too )?bad|minimal/i;
const WATER_RE =
  /water (?:sources?|available|running|flowing|is dry)|(?:streams?|creeks?|springs?|tarns?) (?:are |were |is |was )?(?:dry|flowing|running|full|low)|filtered water|no water/i;
const CROWD_RE =
  /crowd(?:ed|s)?|busy|packed|full parking|parking (?:lot|was) (?:full|overflowing)|overflowing|solitude|(?:trail|lake) to (?:my|our)sel(?:f|ves)|hardly (?:anyone|a soul)|quiet/i;

export function extractConditions(text: string): ExtractedConditions {
  const t = text ?? "";

  const snowBase = findMention(t, SNOW_RE);
  const lineM = SNOW_LINE_RE.exec(t);
  const snow: SnowMention = {
    ...snowBase,
    snow_line_ft: lineM?.[1] ? Number.parseInt(lineM[1].replace(",", ""), 10) : null,
  };
  if (lineM && lineM.index !== undefined) {
    snow.detail = snippet(t, lineM.index, lineM[0].length);
  }

  const bugBase = findMention(t, BUG_RE);
  let severity: BugMention["severity"] = null;
  if (bugBase.mentioned && bugBase.detail) {
    if (BUG_LOW_RE.test(bugBase.detail)) severity = "low";
    else if (BUG_HIGH_RE.test(bugBase.detail)) severity = "high";
    else severity = "moderate";
  }

  return {
    snow,
    blowdowns: findMention(t, BLOWDOWN_RE),
    road_status: findMention(t, ROAD_RE),
    bugs: { ...bugBase, severity },
    water: findMention(t, WATER_RE),
    crowding: findMention(t, CROWD_RE),
  };
}

export interface ReportExtraction {
  url: string;
  title: string | null;
  date_hiked: string | null;
  conditions: ExtractedConditions;
}

export interface CategoryRollup {
  mention_count: number;
  total_reports: number;
  /** URLs of the reports behind each claim — rollups always cite. */
  report_urls: string[];
}

export interface ConditionsRollup {
  snow: CategoryRollup & { snow_lines_ft: number[] };
  blowdowns: CategoryRollup;
  road_status: CategoryRollup;
  bugs: CategoryRollup & { severities: Array<"low" | "moderate" | "high"> };
  water: CategoryRollup;
  crowding: CategoryRollup;
  summary: string[];
}

export function rollupConditions(extractions: ReportExtraction[]): ConditionsRollup {
  const total = extractions.length;
  const cat = (pick: (e: ReportExtraction) => ConditionMention): CategoryRollup => {
    const hits = extractions.filter((e) => pick(e).mentioned);
    return {
      mention_count: hits.length,
      total_reports: total,
      report_urls: hits.map((h) => h.url),
    };
  };

  const snow = {
    ...cat((e) => e.conditions.snow),
    snow_lines_ft: extractions
      .map((e) => e.conditions.snow.snow_line_ft)
      .filter((v): v is number => v !== null),
  };
  const bugs = {
    ...cat((e) => e.conditions.bugs),
    severities: extractions
      .map((e) => e.conditions.bugs.severity)
      .filter((v): v is "low" | "moderate" | "high" => v !== null),
  };
  const blowdowns = cat((e) => e.conditions.blowdowns);
  const road_status = cat((e) => e.conditions.road_status);
  const water = cat((e) => e.conditions.water);
  const crowding = cat((e) => e.conditions.crowding);

  const summary: string[] = [];
  const say = (label: string, c: CategoryRollup, extra = "") => {
    if (c.mention_count > 0) {
      summary.push(`${c.mention_count} of ${total} recent reports mention ${label}${extra}.`);
    }
  };
  say(
    "snow",
    snow,
    snow.snow_lines_ft.length > 0 ? ` (snow lines: ${snow.snow_lines_ft.join(", ")} ft)` : "",
  );
  say("blowdowns/downed trees", blowdowns);
  say("road conditions", road_status);
  say("bugs", bugs, bugs.severities.length > 0 ? ` (severity: ${bugs.severities.join(", ")})` : "");
  say("water availability", water);
  say("crowding", crowding);

  return { snow, blowdowns, road_status, bugs, water, crowding, summary };
}
