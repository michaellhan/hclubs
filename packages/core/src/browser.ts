/**
 * The part of @hci/core the browser needs, with no Zod (launch audit: Zod was about 90 KB
 * gzipped on every page). Client components and @hci/db/local import from
 * "@hci/core/browser"; a test keeps Zod out of this module graph.
 */
export * from "./enum-values";
export * from "./term-utils";
export * from "./fields/value-utils";
export * from "./recruiting";
export * from "./selectivity";
export * from "./normalize/names";
export * from "./eligibility";
export * from "./joining";
export type {
  DateValue,
  DuesValue,
  HoursPerWeek,
  LinkValue,
  MembershipEstimate,
  PressMentionValue,
  StageValue,
} from "./fields/values";
