/**
 * Browser-safe entry point (`@hci/db/local`): types and pure functions only — no
 * database driver. Used by the static site's client components.
 */
export * from "./local/filters";
export * from "./local/cycles";
export * from "./local/search";
export * from "./local/constraints";
export * from "./local/suggest";
export * from "./local/board";
export * from "./local/links";
export * from "./local/concepts";
export * from "./local/intents";
export * from "./local/similar";
export * from "./local/words";
export * from "./local/variants";
export * from "./local/facets";
export type * from "./local/types";
export type * from "./queries/types";
export type { CategoryWithCount } from "./queries/clubs";
export type { RecruitingBoard, RecruitingEntry } from "./queries/recruiting";
export type { StoredField } from "./resolve/project";
export * from "./local/press";
export * from "./local/resume";
export { clubAudiences, clubIdentities, queryAudiences, IDENTITY_CONCEPTS } from "./local/audience";
