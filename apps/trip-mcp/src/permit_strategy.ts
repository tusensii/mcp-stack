/**
 * Curated permit-acquisition strategy per registry area (issue #83) —
 * the layer get_permits' metadata doesn't carry: realistic paths in,
 * walk-up beta, cancellation patterns. Odds are historical/approximate
 * (year noted where known) and shift yearly; recreation.gov + the
 * ranger station stay authoritative. Data-only schema.
 */

export interface PermitPath {
  method: string;
  window: string;
  odds_context: string;
  effort: "low" | "moderate" | "high";
  notes?: string;
}

export interface PermitStrategy {
  paths: PermitPath[];
  /** Where/when cancellations rebook — low confidence, curated. */
  cancellation_beta?: string;
  /** For areas with real walk-up quotas: who issues, when lines form. */
  walk_up_beta?: string;
  /** Per-zone difficulty differences where relevant. */
  zone_notes?: string;
}

const SELF_ISSUED: PermitStrategy = {
  paths: [
    {
      method: "self-issued permit at the trailhead kiosk",
      window: "any time",
      odds_context: "unlimited — no quota",
      effort: "low",
      notes: "No strategy needed. Northwest Forest Pass (or interagency pass) for trailhead parking where posted.",
    },
  ],
};

export const PERMIT_STRATEGIES: Record<string, PermitStrategy> = {
  enchantments: {
    paths: [
      {
        method: "main overnight lottery (recreation.gov)",
        window: "applications Feb 15–Mar 1; results ~Mar 15",
        odds_context: "historical (2024–25): Core Zone <5%, Snow Zone ~15%, Colchuck/Stuart/Eightmile somewhat higher",
        effort: "low",
        notes: "Flexible dates and the smaller zones meaningfully improve odds; Core weekends are the worst case.",
      },
      {
        method: "unclaimed/cancelled date release + rolling cancellations",
        window: "unclaimed lottery dates release ~Apr 1; cancellations rebook all season",
        odds_context: "genuine but grabby — dates appear and vanish in minutes",
        effort: "moderate",
        notes: "Weekday shoulder-season dates reappear most often.",
      },
      {
        method: "daily continuation lottery (geofenced mobile app)",
        window: "day-before drawing during the permit season",
        odds_context: "long odds for Core, workable for Colchuck/Stuart midweek",
        effort: "moderate",
        notes: "Must be physically in-region to enter; plan a backup night.",
      },
      {
        method: "day-use (no permit) thru-hike",
        window: "any day in season",
        odds_context: "unlimited — day use needs no permit",
        effort: "high",
        notes: "The ~19 mi Snow Lakes↔Stuart TH traverse over Aasgard in a day is legal and popular but a serious physical undertaking.",
      },
      {
        method: "off-season overnight (no permit required)",
        window: "Nov 1–May 31",
        odds_context: "unlimited",
        effort: "high",
        notes: "Honest caveat: that window is winter conditions — snow travel, avalanche exposure, short days.",
      },
    ],
    cancellation_beta:
      "Cancellations repost at unpredictable times; evening refreshes near the 1–2 week cancellation-fee cutoffs are anecdotally most productive. Low confidence.",
    zone_notes:
      "Core Zone is the prize and the bottleneck; Snow/Colchuck/Stuart/Eightmile zones grant legal access to day-trip the Core from camp.",
  },
  mt_rainier: {
    paths: [
      {
        method: "early-access lottery (recreation.gov)",
        window: "Feb 10–Mar 3 (2026); awarded slots book first",
        odds_context: "lottery only orders booking access — itinerary success depends on flexibility",
        effort: "low",
      },
      {
        method: "general on-sale",
        window: "opens Apr 25 (2026) for the season through Oct 12",
        odds_context: "non-Wonderland itineraries remain reasonably gettable; full Wonderland circuits go instantly",
        effort: "moderate",
      },
      {
        method: "walk-up (1/3 of permits held back)",
        window: "day-before or day-of at Wilderness Information Centers",
        odds_context: "genuinely workable midweek; segment-by-segment Wonderland linking beats asking for a full circuit",
        effort: "high",
      },
    ],
    walk_up_beta:
      "Longmire and White River WICs issue from opening (~7:30–8am in summer); lines form 30–60 min earlier on weekends. Flexible start trailheads are the lever. Low-to-medium confidence.",
    cancellation_beta: "Summer cancellations repost steadily; morning checks catch the overnight batch. Low confidence.",
    zone_notes: "Wonderland camps are the constraint — cross-country zones and lesser camps hold availability much longer.",
  },
  north_cascades: {
    paths: [
      {
        method: "early-access lottery (recreation.gov)",
        window: "Mar 2–13 (2026); general on-sale Apr 29",
        odds_context: "60% of capacity is reservable; marquee camps (Sahale Glacier) vanish at on-sale",
        effort: "low",
      },
      {
        method: "walk-up (40% of capacity held back)",
        window: "day-before + day-of at the Marblemount Wilderness Information Center",
        odds_context: "the best walk-up ratio of the big parks — midweek success is common outside the marquee camps",
        effort: "moderate",
      },
    ],
    walk_up_beta:
      "Marblemount WIC issues from opening (7am peak season); arrive early for Sahale/Cascade Pass camps, relax for everything else. Medium confidence.",
    zone_notes: "Boston Basin and Sahale are permit unicorns; Stehekin-side and east-bank camps are routinely available.",
  },
  olympic: {
    paths: [
      {
        method: "general on-sale (recreation.gov, no lottery)",
        window: "Apr 15 7:00 AM PT release for the May 15–Oct 15 season",
        odds_context: "quota areas (Seven Lakes Basin, Royal Basin, Grand Valley…) sell out within minutes-to-hours for weekends",
        effort: "moderate",
        notes: "Set a calendar alarm — this is a fastest-fingers release, not a lottery.",
      },
      {
        method: "rolling cancellations",
        window: "all season",
        odds_context: "steady churn; midweek quota nights reappear regularly",
        effort: "moderate",
      },
      {
        method: "non-quota zones",
        window: "any time",
        odds_context: "most of the park's wilderness is non-quota and bookable same-day online",
        effort: "low",
        notes: "Coast strips and valley routes often have space when the alpine quota areas are full.",
      },
    ],
    cancellation_beta: "No formal walk-up hold-back — cancellation watching is the fallback for quota zones. Low confidence.",
  },
  glacier_peak: SELF_ISSUED,
  pasayten: SELF_ISSUED,
  alpine_lakes: {
    ...SELF_ISSUED,
    zone_notes:
      "Self-issued everywhere EXCEPT the Enchantment Permit Area — use the enchantments area entry for that zone's lottery reality.",
  },
  henry_jackson: SELF_ISSUED,
  goat_rocks: SELF_ISSUED,
  mt_st_helens: {
    paths: [
      {
        method: "climbing permit on-sale (recreation.gov)",
        window: "season quota (Apr–Oct) releases in early-year batches; ~$15",
        odds_context: "summer weekends sell out almost immediately; weekdays linger longer",
        effort: "moderate",
      },
      {
        method: "cancellation watching",
        window: "all season",
        odds_context: "nightly churn is real — persistent checking lands weekday slots",
        effort: "moderate",
      },
      {
        method: "winter self-issued (free)",
        window: "Dec 1–Mar 31",
        odds_context: "unlimited",
        effort: "high",
        notes: "Winter/spring snow climb — many prefer it to the summer scree slog, with commensurate skills required.",
      },
    ],
    zone_notes: "Mount Margaret Backcountry camps run a separate small quota — book like a quota area, not like the climb.",
  },
  mt_adams: {
    paths: [
      {
        method: "Cascades Volcano Pass (above 7,000 ft)",
        window: "in season (~Jun–Sep), purchased via recreation.gov or Trout Lake RD",
        odds_context: "no quota — a fee pass, not a competition (~$15 weekday / $30 weekend historical)",
        effort: "low",
      },
      {
        method: "below 7,000 ft: self-issued",
        window: "any time",
        odds_context: "unlimited",
        effort: "low",
      },
    ],
  },
  mt_baker: SELF_ISSUED,
};
