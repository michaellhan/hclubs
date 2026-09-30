import { z } from "zod";
import { ActivityStatus, AffiliationScope, OrgType, RecognitionStatus } from "../enums";
import { normalizeName } from "../normalize/names";
import { normalizeUrl } from "../normalize/urls";
import {
  AliasValue,
  BooleanValue,
  CategoryValue,
  ClassYearsValue,
  CountValue,
  CycleStatedStatus,
  DateValue,
  DuesValue,
  HoursPerWeek,
  JoinModeValue,
  LinkValue,
  MembershipEstimate,
  PercentValue,
  PressMentionValue,
  RecruitingSeasonsValue,
  ShortTextValue,
  StagesValue,
  TagValue,
  TextValue,
  UrlValue,
} from "./values";

/**
 * Field registry — the single source of truth for every claimable field. CLAUDE.md §6.
 * Add an entry here BEFORE any code writes claims for a new field.
 */

export type SubjectType = "club" | "recruiting_cycle";
export type Cardinality = "single" | "multi";
export type Temporality = "stable" | "time_varying" | "cycle_scoped";
export type Volatility = "static" | "semester" | "volatile";
export type ResolutionStrategy = "priority_then_recency" | "recency_then_priority" | "union";

export interface FieldDefinition<S extends z.ZodType = z.ZodType> {
  key: string;
  subjectType: SubjectType;
  label: string;
  schema: S;
  cardinality: Cardinality;
  temporality: Temporality;
  volatility: Volatility;
  resolution: ResolutionStrategy;
  /** May an `inferred` claim ever be displayed? Default false for numbers, dates, money, eligibility. */
  allowInferred: boolean;
  /** Canonical form used for value hashing / dedup. Must be pure and deterministic. */
  normalize: (value: z.infer<S>) => unknown;
  /**
   * Whether differing values count as a factual conflict. False for free text (names,
   * descriptions), where sources phrase the same thing differently: alternatives are
   * still kept and shown, but not flagged as a disagreement.
   */
  flagsConflicts: boolean;
}

/** Days after which a verified value is shown as stale ("Reported"). CLAUDE.md §17. */
export const STALE_AFTER_DAYS: Record<Volatility, number> = {
  static: 730,
  semester: 180,
  volatile: 30,
};

const identity = <T>(v: T): T => v;
/** Dates hash by instant/precision only, so the same date phrased differently is one claim. */
const normalizeDate = (v: { at: string; precision: string }) => ({ at: v.at, precision: v.precision });
const normalizeText = (v: string) => v.replace(/\s+/g, " ").trim();
const sortedSet = (v: readonly string[]) => [...new Set(v)].sort();

const FREE_TEXT = new Set([
  // Differing logo URLs (sizes, CDNs) aren't a factual disagreement.
  "club.logo",
  "club.summary",
  "club.name",
  "club.short_description",
  "club.long_description",
  "club.mission",
  "club.eligibility_note",
  "club.experience_required",
  "club.meeting_frequency",
  "club.self_described_selectivity",
  "cycle.self_described_selectivity",
]);

function define<S extends z.ZodType>(
  def: Omit<FieldDefinition<S>, "normalize" | "allowInferred" | "flagsConflicts"> & {
    normalize?: (value: z.infer<S>) => unknown;
    allowInferred?: boolean;
  },
): FieldDefinition<S> {
  return { allowInferred: false, normalize: identity, flagsConflicts: !FREE_TEXT.has(def.key), ...def };
}

export const FIELDS = {
  // --- Identity ---------------------------------------------------------------------------
  "club.name": define({
    key: "club.name",
    subjectType: "club",
    label: "Name",
    schema: ShortTextValue,
    cardinality: "single",
    temporality: "stable",
    volatility: "static",
    resolution: "priority_then_recency",
    normalize: (v) => normalizeName(v),
  }),
  "club.acronym": define({
    key: "club.acronym",
    subjectType: "club",
    label: "Acronym",
    schema: z.string().trim().min(1).max(20),
    cardinality: "single",
    temporality: "stable",
    volatility: "static",
    resolution: "priority_then_recency",
    normalize: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ""),
  }),
  "club.alias": define({
    key: "club.alias",
    subjectType: "club",
    label: "Also known as",
    schema: AliasValue,
    cardinality: "multi",
    temporality: "stable",
    volatility: "static",
    resolution: "union",
    normalize: (v) => ({ name: normalizeName(v.name), kind: v.kind }),
  }),

  // --- Description ------------------------------------------------------------------------
  "club.short_description": define({
    key: "club.short_description",
    subjectType: "club",
    label: "Summary",
    schema: z.string().trim().min(1).max(400),
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
    normalize: (v) => v.replace(/\s+/g, " ").trim(),
  }),
  "club.summary": define({
    key: "club.summary",
    subjectType: "club",
    label: "Summary",
    schema: z.string().trim().min(10).max(200),
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "recency_then_priority",
    // Our own one-line summary of the club's text (CLAUDE.md §4), written by a model and
    // anchored to a verbatim sentence; stored as inferred.
    allowInferred: true,
    normalize: (v) => v.replace(/\s+/g, " ").trim(),
  }),
  "club.long_description": define({
    key: "club.long_description",
    subjectType: "club",
    label: "Description",
    schema: TextValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
    normalize: (v) => v.replace(/\s+/g, " ").trim(),
  }),
  "club.category": define({
    key: "club.category",
    subjectType: "club",
    label: "Category",
    schema: CategoryValue,
    cardinality: "multi",
    temporality: "stable",
    volatility: "static",
    resolution: "union",
    // Category assignment from source tags is an interpretation; allowed but labeled.
    allowInferred: true,
  }),
  "club.tag": define({
    key: "club.tag",
    subjectType: "club",
    label: "Tag",
    schema: TagValue,
    cardinality: "multi",
    temporality: "stable",
    volatility: "semester",
    resolution: "union",
  }),

  // --- Status -----------------------------------------------------------------------------
  "club.org_type": define({
    key: "club.org_type",
    subjectType: "club",
    label: "Organization type",
    schema: OrgType,
    cardinality: "single",
    temporality: "stable",
    volatility: "static",
    resolution: "priority_then_recency",
    allowInferred: true,
  }),
  "club.recognition_status": define({
    key: "club.recognition_status",
    subjectType: "club",
    label: "Recognition",
    schema: RecognitionStatus,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
  }),
  "club.activity_status": define({
    key: "club.activity_status",
    subjectType: "club",
    label: "Activity",
    schema: ActivityStatus,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "recency_then_priority",
  }),
  "club.affiliation_scope": define({
    key: "club.affiliation_scope",
    subjectType: "club",
    label: "Affiliation",
    schema: AffiliationScope,
    cardinality: "single",
    temporality: "stable",
    volatility: "static",
    resolution: "priority_then_recency",
    // "Graduate school" can be read off a name like "Harvard GSAS …"; shown as an estimate.
    allowInferred: true,
  }),

  // --- Links ------------------------------------------------------------------------------
  "club.link": define({
    key: "club.link",
    subjectType: "club",
    label: "Link",
    schema: LinkValue,
    cardinality: "multi",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "union",
    normalize: (v) => ({ kind: v.kind, url: normalizeUrl(v.url) ?? v.url }),
  }),

  // --- Membership & joining ---------------------------------------------------------------
  "club.join_mode": define({
    key: "club.join_mode",
    subjectType: "club",
    label: "How to join",
    schema: JoinModeValue,
    cardinality: "multi",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "union",
  }),
  "club.member_count": define({
    key: "club.member_count",
    subjectType: "club",
    label: "Members",
    schema: MembershipEstimate,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "recency_then_priority",
  }),
  "club.freshmen_eligible": define({
    key: "club.freshmen_eligible",
    subjectType: "club",
    label: "Open to first-years",
    schema: BooleanValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
  }),
  "club.eligibility_note": define({
    key: "club.eligibility_note",
    subjectType: "club",
    label: "Eligibility",
    schema: ShortTextValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
  }),
  "club.hours_per_week": define({
    key: "club.hours_per_week",
    subjectType: "club",
    label: "Time commitment",
    schema: HoursPerWeek,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
  }),
  "club.meeting_frequency": define({
    key: "club.meeting_frequency",
    subjectType: "club",
    label: "Meets",
    schema: ShortTextValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
  }),
  "club.dues": define({
    key: "club.dues",
    subjectType: "club",
    label: "Dues",
    schema: DuesValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
  }),
  "club.experience_required": define({
    key: "club.experience_required",
    subjectType: "club",
    label: "Prior experience",
    schema: ShortTextValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
  }),

  "club.mission": define({
    key: "club.mission",
    subjectType: "club",
    label: "Mission",
    schema: TextValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
    normalize: normalizeText,
  }),
  "club.activity": define({
    key: "club.activity",
    subjectType: "club",
    label: "Activities",
    schema: ShortTextValue,
    cardinality: "multi",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "union",
    normalize: (v) => normalizeText(v).toLowerCase(),
  }),
  "club.sponsor": define({
    key: "club.sponsor",
    subjectType: "club",
    label: "Sponsors & partners",
    schema: ShortTextValue,
    cardinality: "multi",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "union",
    normalize: (v) => normalizeText(v).toLowerCase(),
  }),
  "club.eligible_classes": define({
    key: "club.eligible_classes",
    subjectType: "club",
    label: "Open to",
    schema: ClassYearsValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
    normalize: sortedSet,
  }),
  "club.recruiting_seasons": define({
    key: "club.recruiting_seasons",
    subjectType: "club",
    label: "Usually recruits",
    schema: RecruitingSeasonsValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
    normalize: sortedSet,
  }),
  "club.logo": define({
    key: "club.logo",
    subjectType: "club",
    label: "Logo",
    schema: UrlValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "priority_then_recency",
    normalize: (v) => normalizeUrl(v) ?? v,
  }),
  "club.press_mention": define({
    key: "club.press_mention",
    subjectType: "club",
    label: "In the news",
    schema: PressMentionValue,
    cardinality: "multi",
    temporality: "stable",
    volatility: "static",
    resolution: "union",
    normalize: (v) => ({ url: v.url }),
  }),
  "club.self_described_selectivity": define({
    key: "club.self_described_selectivity",
    subjectType: "club",
    label: "Club's description of its selectivity",
    schema: ShortTextValue,
    cardinality: "single",
    temporality: "time_varying",
    volatility: "semester",
    resolution: "recency_then_priority",
    normalize: normalizeText,
  }),

  // --- Recruiting cycle (subject = recruiting_cycle) ---------------------------------------
  "cycle.opens_at": define({
    key: "cycle.opens_at",
    subjectType: "recruiting_cycle",
    label: "Applications open",
    schema: DateValue,
    normalize: normalizeDate,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "recency_then_priority",
  }),
  "cycle.deadline": define({
    key: "cycle.deadline",
    subjectType: "recruiting_cycle",
    label: "Deadline",
    schema: DateValue,
    normalize: normalizeDate,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "recency_then_priority",
  }),
  "cycle.process_type": define({
    key: "cycle.process_type",
    subjectType: "recruiting_cycle",
    label: "Process",
    schema: JoinModeValue,
    cardinality: "multi",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "union",
  }),
  "cycle.stages": define({
    key: "cycle.stages",
    subjectType: "recruiting_cycle",
    label: "Stages",
    schema: StagesValue,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "recency_then_priority",
  }),
  "cycle.stated_status": define({
    key: "cycle.stated_status",
    subjectType: "recruiting_cycle",
    label: "Stated status",
    schema: CycleStatedStatus,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "recency_then_priority",
  }),
  "cycle.application_url": define({
    key: "cycle.application_url",
    subjectType: "recruiting_cycle",
    label: "Apply",
    schema: UrlValue,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "recency_then_priority",
    normalize: (v) => normalizeUrl(v) ?? v,
  }),
  "cycle.applicants": define({
    key: "cycle.applicants",
    subjectType: "recruiting_cycle",
    label: "Applicants",
    schema: CountValue,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "priority_then_recency",
  }),
  "cycle.admits": define({
    key: "cycle.admits",
    subjectType: "recruiting_cycle",
    label: "Admitted",
    schema: CountValue,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "priority_then_recency",
  }),
  "cycle.eligible_classes": define({
    key: "cycle.eligible_classes",
    subjectType: "recruiting_cycle",
    label: "Eligible classes",
    schema: ClassYearsValue,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "recency_then_priority",
    normalize: sortedSet,
  }),
  "cycle.interviewees": define({
    key: "cycle.interviewees",
    subjectType: "recruiting_cycle",
    label: "Interviewed",
    schema: CountValue,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "priority_then_recency",
  }),
  "cycle.offers": define({
    key: "cycle.offers",
    subjectType: "recruiting_cycle",
    label: "Offers",
    schema: CountValue,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "priority_then_recency",
  }),
  "cycle.stated_acceptance_rate": define({
    key: "cycle.stated_acceptance_rate",
    subjectType: "recruiting_cycle",
    label: "Stated acceptance rate (%)",
    schema: PercentValue,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "priority_then_recency",
  }),
  "cycle.self_described_selectivity": define({
    key: "cycle.self_described_selectivity",
    subjectType: "recruiting_cycle",
    label: "Club's description of its process",
    schema: ShortTextValue,
    cardinality: "single",
    temporality: "cycle_scoped",
    volatility: "volatile",
    resolution: "recency_then_priority",
  }),
} as const satisfies Record<string, FieldDefinition>;

export type FieldKey = keyof typeof FIELDS;
export type FieldValue<K extends FieldKey> = z.infer<(typeof FIELDS)[K]["schema"]>;

export const FIELD_KEYS = Object.keys(FIELDS) as FieldKey[];

export function isFieldKey(key: string): key is FieldKey {
  return Object.hasOwn(FIELDS, key);
}

export function getField(key: string): FieldDefinition {
  if (!isFieldKey(key)) throw new Error(`Unknown field key: ${key}`);
  return FIELDS[key] as unknown as FieldDefinition;
}

/** Validate a raw value against its field schema and compute the normalized form. */
export function parseFieldValue(
  key: string,
  value: unknown,
): { ok: true; value: unknown; normalized: unknown } | { ok: false; error: string } {
  if (!isFieldKey(key)) return { ok: false, error: `Unknown field key: ${key}` };
  const field = getField(key);
  const parsed = field.schema.safeParse(value);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  return { ok: true, value: parsed.data, normalized: field.normalize(parsed.data) };
}
