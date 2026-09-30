import { z } from "zod";
import { newYorkWallTimeToUtc } from "../terms";
import { JoinMode, LinkKind, StageKind } from "../enums";

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
  })
  .refine((v) => (v.precision === "date" ? /^\d{4}-\d{2}-\d{2}$/.test(v.at) : !Number.isNaN(Date.parse(v.at))), {
    message: "invalid date for precision",
  });
export type DateValue = z.infer<typeof DateValue>;

/** Instant at which a DateValue ends (date-only values end at 23:59:59 campus time). */
export function dateValueEnd(v: DateValue): Date {
  if (v.precision === "datetime") return new Date(v.at);
  const [y, m, d] = v.at.split("-").map(Number) as [number, number, number];
  return newYorkWallTimeToUtc(y, m, d, 23, 59, 59);
}

/** Instant at which a DateValue starts (date-only values start at 00:00 campus time). */
export function dateValueStart(v: DateValue): Date {
  if (v.precision === "datetime") return new Date(v.at);
  const [y, m, d] = v.at.split("-").map(Number) as [number, number, number];
  return newYorkWallTimeToUtc(y, m, d, 0, 0, 0);
}

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
