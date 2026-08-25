/**
 * Trip-brief configuration schema.
 *
 * One config file drives a whole build. Everything the report says that
 * isn't pulled live from trip-mcp comes from here — so anything the Aug 2026
 * Royal Basin cycle got wrong by assumption (camp zone, permit number, who
 * carries the bear can) is a required or explicitly-absent field rather than
 * something the generator invents.
 *
 * Two document kinds share the file format:
 *   - `trip`    — the pre-trip brief for a committed trip (#102, #104, #107, #108)
 *   - `options` — the candidate comparison card for an undecided trip (#106)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");

export const CoordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  label: z.string().min(1),
  elevation_ft: z.number().min(-500).max(15000).optional(),
});
export type Coordinate = z.infer<typeof CoordinateSchema>;

/**
 * A URL that will appear in rendered output. Every one of these goes through
 * the build-time verifier (#105) — none of them are trusted from memory.
 */
export const LinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
  /** Set when the link is only meaningful with signal (maps, live status). */
  requires_network: z.boolean().default(true),
});
export type Link = z.infer<typeof LinkSchema>;

export const PhoneSchema = z.object({
  label: z.string().min(1),
  /** Plain digits/format as printed. The offline variant never wraps this in tel:. */
  number: z.string().min(7),
  hours: z.string().optional(),
});
export type Phone = z.infer<typeof PhoneSchema>;

// ---------------------------------------------------------------------------
// #105 — provenance policy
// ---------------------------------------------------------------------------

export const ProvenanceTierSchema = z.enum([
  /** Instrument readings and issued forecasts: NWS, USGS gauges, NWAC, Open-Meteo. */
  "live-instrument",
  /** Published static facts from the managing agency: regulations, quotas, phones. */
  "official-static",
  /** Trip reports, forum posts — real observation, unverified provenance. */
  "community",
  /** Catalog metadata and inference. Never a specific claim without an override. */
  "lookup-inference",
]);
export type ProvenanceTier = z.infer<typeof ProvenanceTierSchema>;

export const ProvenancePolicySchema = z
  .object({
    /**
     * Permit lookup-tier facts to render as specific claims (IDs, numbers).
     * Off by default: this is exactly the guard that would have caught the
     * rec.gov permit-system ID being printed as the trip's permit number.
     */
    allow_lookup_facts: z.boolean().default(false),
    /**
     * What to do with a URL that fails build-time verification.
     *   fail — abort the build (default)
     *   warn — render as plain text and record a warning
     *   skip — do not verify at all (offline builds, air-gapped CI)
     */
    link_check: z.enum(["fail", "warn", "skip"]).default("fail"),
    /** Treat trip-mcp `confidence: "low"` payloads as hedged rather than dropped. */
    low_confidence: z.enum(["hedge", "exclude"]).default("hedge"),
  })
  .default({});
export type ProvenancePolicy = z.infer<typeof ProvenancePolicySchema>;

// ---------------------------------------------------------------------------
// #104 — reservation intake
// ---------------------------------------------------------------------------

export const ReservationSchema = z.object({
  /** The reference printed on the user's confirmation. Never a rec.gov catalog id. */
  confirmation_reference: z.string().min(1),
  /**
   * Where the party is actually permitted to camp, as named on the
   * confirmation — not where parties usually camp in this drainage.
   */
  assigned_camp_area: z.string().min(1),
  camp_elevation_ft: z.number().min(-500).max(15000).optional(),
  /** Drives the storm-exposure and sanitation language in the hazards block. */
  above_treeline: z.boolean().default(false),
  /** Drives the sanitation line: false means pack-out / cathole rules apply. */
  toilet_available: z.boolean().default(false),
  nights: z.array(isoDate).min(1),
  party_size: z.number().int().min(1),
  permit_holder: z.string().optional(),
  /** How the facts above got here. Recorded so the report can say so. */
  intake: z.enum(["confirmation-text", "screenshot", "manual-entry"]),
  notes: z.array(z.string()).default([]),
});
export type Reservation = z.infer<typeof ReservationSchema>;

export const PermitSchema = z.object({
  required: z.boolean(),
  /** Human name of the system, e.g. "Olympic wilderness quota". */
  system: z.string().optional(),
  mechanism: z
    .enum(["none", "self-issue", "walk-up", "reservation", "lottery"])
    .default("none"),
  /** Additional checklist lines to print alongside the derived ones. */
  checklist: z.array(z.string()).default([]),
});
export type Permit = z.infer<typeof PermitSchema>;

// ---------------------------------------------------------------------------
// #108 — ranger call, group roles
// ---------------------------------------------------------------------------

export const RangerCallSchema = z.object({
  station: z.string().min(1),
  phone: z.string().optional(),
  /** When the call actually happened — the fact's age matters more than most. */
  called_at: z.string().min(1),
  notes: z.array(z.string().min(1)).min(1),
  /** Plan if the first-come campground is full on arrival. */
  campground_fallback: z.string().optional(),
});
export type RangerCall = z.infer<typeof RangerCallSchema>;

export const GroupRoleSchema = z.object({
  role: z.string().min(1),
  who: z.string().min(1),
  note: z.string().optional(),
});
export type GroupRole = z.infer<typeof GroupRoleSchema>;

// ---------------------------------------------------------------------------
// #107 — drive directions, both ways
// ---------------------------------------------------------------------------

export const DriveSchema = z.object({
  origin: z.string().min(1),
  hours: z.number().min(0).optional(),
  /** Home → trailhead, one step per line. */
  outbound: z.array(z.string().min(1)).default([]),
  /**
   * Trailhead → home. Optional: when omitted the offline variant derives a
   * reversed list from `outbound` and labels it as derived.
   */
  return: z.array(z.string().min(1)).default([]),
});
export type Drive = z.infer<typeof DriveSchema>;

// ---------------------------------------------------------------------------
// Route / pull targets
// ---------------------------------------------------------------------------

export const ClimbWindowSchema = z.object({
  date: isoDate,
  start_hour: z.number().int().min(0).max(23).default(8),
  end_hour: z.number().int().min(1).max(24).default(18),
  pace_mph: z.number().min(0.5).max(5).default(1.5),
});

export const RouteSchema = z.object({
  trail_name: z.string().optional(),
  osm_id: z.string().optional(),
  points: z.array(z.tuple([z.number(), z.number()])).optional(),
  distance_mi: z.number().min(0).optional(),
  /** The day and hours the party is actually walking uphill (#108 precip source). */
  climb_window: ClimbWindowSchema.optional(),
});
export type Route = z.infer<typeof RouteSchema>;

export const CampgroundSchema = z.object({
  name: z.string().min(1),
  first_come: z.boolean().default(false),
  sites: z.number().int().min(1).optional(),
  note: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Trip config (#102)
// ---------------------------------------------------------------------------

export const TripConfigSchema = z
  .object({
    kind: z.literal("trip"),
    /** Output filename stem. */
    slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase kebab-case"),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    /** trip-mcp area id; resolves safety brief, permits, rivers, conditions. */
    area_id: z.string().optional(),
    destination: CoordinateSchema,
    trailhead: CoordinateSchema.optional(),
    dates: z.object({ start: isoDate, end: isoDate }),
    /** IANA zone used for sunrise/sunset rendering and day labels (#108). */
    timezone: z.string().default("America/Los_Angeles"),
    /**
     * Minutes before true sunset that terrain cuts direct sun at camp.
     * Rendered as the valley-shade note; omit when it doesn't apply.
     */
    terrain_shade_minutes: z.number().int().min(0).max(240).optional(),
    route: RouteSchema.optional(),
    campground: CampgroundSchema.optional(),
    permit: PermitSchema.default({ required: false, mechanism: "none", checklist: [] }),
    reservation: ReservationSchema.optional(),
    ranger_call: RangerCallSchema.optional(),
    group_roles: z.array(GroupRoleSchema).default([]),
    drive: DriveSchema.optional(),
    phones: z.array(PhoneSchema).default([]),
    links: z.array(LinkSchema).default([]),
    provenance: ProvenancePolicySchema,
    outputs: z
      .object({
        jsx: z.boolean().default(true),
        pdf: z.boolean().default(true),
        /** #107 — emit the offline companion alongside the standard brief. */
        offline: z.boolean().default(false),
      })
      .default({}),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.dates.end < cfg.dates.start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dates", "end"],
        message: "dates.end must not precede dates.start",
      });
    }
    // #104: a permitted trip without its confirmation is exactly the failure
    // this schema exists to prevent. Refuse the build rather than guess.
    if (cfg.permit.required && !cfg.reservation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reservation"],
        message:
          "permit.required is true, so `reservation` is required: the confirmation " +
          "is the source of truth for camp area, dates and party size. Enter it from " +
          "the confirmation text, a screenshot, or by hand — do not omit it.",
      });
    }
    if (cfg.reservation) {
      const outside = cfg.reservation.nights.filter(
        (n) => n < cfg.dates.start || n > cfg.dates.end,
      );
      for (const night of outside) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reservation", "nights"],
          message: `Reserved night ${night} falls outside the trip dates ${cfg.dates.start}..${cfg.dates.end}`,
        });
      }
    }
  });
export type TripConfig = z.infer<typeof TripConfigSchema>;

// ---------------------------------------------------------------------------
// Options-card config (#106)
// ---------------------------------------------------------------------------

export const CriteriaSchema = z.object({
  /** Highest daily precipitation probability tolerated across the trip window. */
  max_precip_pct: z.number().min(0).max(100).default(30),
  /** none = any thunder mention disqualifies; low = only active watches do. */
  thunder: z.enum(["none", "low", "any"]).default("low"),
  permit_mechanisms: z
    .array(z.enum(["none", "self-issue", "walk-up", "reservation", "lottery"]))
    .min(1)
    .default(["none", "self-issue"]),
  max_drive_hours: z.number().min(0).default(5),
  styles: z.array(z.enum(["backpack", "car-camp"])).min(1).default(["backpack"]),
});
export type Criteria = z.infer<typeof CriteriaSchema>;

export const CandidateSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  region: z.string().min(1),
  area_id: z.string().optional(),
  point: CoordinateSchema,
  style: z.enum(["backpack", "car-camp"]),
  permit_mechanism: z.enum(["none", "self-issue", "walk-up", "reservation", "lottery"]),
  drive_hours: z.number().min(0),
  links: z.array(LinkSchema).default([]),
  note: z.string().optional(),
  /** Set when someone proposed it mid-discussion; rendered as such. */
  proposed_by: z.string().optional(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const OptionsConfigSchema = z.object({
  kind: z.literal("options"),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  dates: z.object({ start: isoDate, end: isoDate }),
  timezone: z.string().default("America/Los_Angeles"),
  criteria: CriteriaSchema,
  candidates: z.array(CandidateSchema).min(1),
  /**
   * Regions ruled out before any pull, kept visible so the group can see the
   * option was considered rather than forgotten.
   */
  excluded_regions: z
    .array(z.object({ name: z.string().min(1), reason: z.string().min(1) }))
    .default([]),
  provenance: ProvenancePolicySchema,
  outputs: z
    .object({ jsx: z.boolean().default(true), pdf: z.boolean().default(true) })
    .default({}),
});
export type OptionsConfig = z.infer<typeof OptionsConfigSchema>;

export const BriefConfigSchema = z.discriminatedUnion("kind", [
  // `TripConfigSchema` is a ZodEffects (superRefine) so it can't join a
  // discriminated union directly; dispatch on `kind` by hand instead.
  z.object({ kind: z.literal("trip") }).passthrough(),
  z.object({ kind: z.literal("options") }).passthrough(),
]);

export type BriefConfig = TripConfig | OptionsConfig;
