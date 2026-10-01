import { z } from "zod";
import { CLASS_YEARS, RECRUITING_SEASONS } from "./value-utils";
import { HARVARD_SCHOOLS, LIFECYCLE_EVENTS } from "../enum-values";
import { JoinMode, LinkKind, StageKind } from "../enums";

/** Plain helpers and constants (no Zod) live in value-utils.ts for the browser bundle. */
export * from "./value-utils";

/**
 * Zod value shapes used by claims. CLAUDE.md §5.3.
 * These are the only shapes a claim's `value` may take for a given field.
 */

export const TextValue = z.string().trim().min(1).max(20_000);
export const ShortTextValue = z.string().trim().min(1).max(500);
export const BooleanValue = z.boolean();
export const CountValue = z.number().int().nonnegative();

export const MembershipEstimate = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("exact"), count: CountValue }),
    z.object({ kind: z.literal("range"), min: CountValue.nullable(), max: CountValue.nullable() }),
  ])
  .refine((v) => v.kind === "exact" || v.min !== null || v.max !== null, "range needs a bound")
  .refine((v) => v.kind === "exact" || v.min === null || v.max === null || v.min <= v.max, "min > max");
export type MembershipEstimate = z.infer<typeof MembershipEstimate>;

export const HoursPerWeek = z
  .object({
    min: z.number().nonnegative().max(80).nullable(),
    max: z.number().nonnegative().max(80).nullable(),
    qualifier: z.enum(["comp_period", "member"]).optional(),
  })
  .refine((v) => v.min !== null || v.max !== null, "needs a bound")
  .refine((v) => v.min === null || v.max === null || v.min <= v.max, "min > max");
export type HoursPerWeek = z.infer<typeof HoursPerWeek>;

/**
 * A date or date-time. Date-only values stay date-only (precision "date"): we never
 * invent a time of day. `at` is "YYYY-MM-DD" for dates or an ISO string with offset.
 */
export const DateValue = z
  .object({
    at: z.string(),
    precision: z.enum(["date", "datetime"]),
    label: z.string().max(200).optional(),
    /** Verbatim text the date was parsed from, and how sure the parser was. */
    sourceText: z.string().max(300).optional(),
    parseConfidence: z.enum(["high", "medium", "low"]).optional(),
  })
  .refine((v) => (v.precision === "date" ? /^\d{4}-\d{2}-\d{2}$/.test(v.at) : !Number.isNaN(Date.parse(v.at))), {
    message: "invalid date for precision",
  });
export type DateValue = z.infer<typeof DateValue>;

export const StageValue = z.object({
  order: z.number().int().nonnegative(),
  kind: StageKind,
  label: z.string().max(200).optional(),
  startsAt: DateValue.optional(),
  endsAt: DateValue.optional(),
});
export const StagesValue = z.array(StageValue).max(20);
export type StageValue = z.infer<typeof StageValue>;

export const LinkValue = z.object({
  kind: LinkKind,
  url: z.string().url(),
  handle: z.string().nullable().optional(),
  label: z.string().max(200).optional(),
});
export type LinkValue = z.infer<typeof LinkValue>;

export const AliasValue = z.object({
  name: ShortTextValue,
  kind: z.enum(["alternate", "former", "abbreviation", "acronym"]),
});
export type AliasValue = z.infer<typeof AliasValue>;

export const CategoryValue = z.string().regex(/^[a-z0-9-]+$/, "category slug");
export const TagValue = z.string().trim().toLowerCase().min(1).max(60);

export const DuesValue = z.object({
  hasDues: z.boolean().nullable(),
  amountUsd: z.number().nonnegative().nullable().optional(),
  note: z.string().max(500).optional(),
});
export type DuesValue = z.infer<typeof DuesValue>;

export const CycleStatedStatus = z.enum(["open", "closed"]);
export const JoinModeValue = JoinMode;
export const UrlValue = z.string().url();

/** Class years a club or cycle is open to. */
export const ClassYear = z.enum(CLASS_YEARS);
export type ClassYear = z.infer<typeof ClassYear>;
export const ClassYearsValue = z.array(ClassYear).min(1).max(5);

/** A percentage as stated by a source (0–100), e.g. "10% acceptance rate". */
export const PercentValue = z.number().min(0).max(100);

/** Terms a club usually recruits in (a pattern, distinct from specific cycles). CLAUDE.md §8. */
export const RecruitingSeason = z.enum(RECRUITING_SEASONS);
export type RecruitingSeason = z.infer<typeof RecruitingSeason>;
export const RecruitingSeasonsValue = z.array(RecruitingSeason).min(1).max(5);

/** A news article about the club (link, headline and date only; never the article text). §21 */
export const PressMentionValue = z.object({
  url: z.string().url(),
  title: z.string().trim().min(3).max(300),
  publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  publisher: z.string().trim().min(2).max(80),
});
export type PressMentionValue = z.infer<typeof PressMentionValue>;

/** A Harvard school the organization belongs to (ADR 0038). */
export const SchoolValue = z.enum(HARVARD_SCHOOLS);

/**
 * How an organization ended, as a source states it (ADR 0038): dissolved, or replaced by
 * another organization (a successor is a different club, never a merge). `successorClubId`
 * points at the indexed successor when there is one.
 */
export const LifecycleValue = z.object({
  event: z.enum(LIFECYCLE_EVENTS),
  year: z.number().int().min(1636).max(2100).nullable(),
  successorClubId: z.string().uuid().nullable(),
  successorName: z.string().trim().min(2).max(200).nullable(),
});
export type LifecycleValue = z.infer<typeof LifecycleValue>;
