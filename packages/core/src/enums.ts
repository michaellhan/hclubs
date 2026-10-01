import { z } from "zod";
import {
  ACTIVITY_STATUSES,
  AFFILIATION_SCOPES,
  ASSERTION_KINDS,
  EXTRACTION_METHODS,
  JOIN_MODES,
  LINK_KINDS,
  LINK_STATUSES,
  ORG_TYPES,
  RECOGNITION_STATUSES,
  SOURCE_TYPES,
  STAGE_KINDS,
} from "./enum-values";

/** Zod schemas for the enumerations in enum-values.ts (server-side validation). */
export * from "./enum-values";

export const SourceType = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof SourceType>;
export const LinkKind = z.enum(LINK_KINDS);
export type LinkKind = z.infer<typeof LinkKind>;
export const LinkStatus = z.enum(LINK_STATUSES);
export type LinkStatus = z.infer<typeof LinkStatus>;
export const OrgType = z.enum(ORG_TYPES);
export type OrgType = z.infer<typeof OrgType>;
export const RecognitionStatus = z.enum(RECOGNITION_STATUSES);
export type RecognitionStatus = z.infer<typeof RecognitionStatus>;
export const ActivityStatus = z.enum(ACTIVITY_STATUSES);
export type ActivityStatus = z.infer<typeof ActivityStatus>;
export const AffiliationScope = z.enum(AFFILIATION_SCOPES);
export type AffiliationScope = z.infer<typeof AffiliationScope>;
export const JoinMode = z.enum(JOIN_MODES);
export type JoinMode = z.infer<typeof JoinMode>;
export const StageKind = z.enum(STAGE_KINDS);
export type StageKind = z.infer<typeof StageKind>;
export const AssertionKind = z.enum(ASSERTION_KINDS);
export type AssertionKind = z.infer<typeof AssertionKind>;
export const ExtractionMethod = z.enum(EXTRACTION_METHODS);
export type ExtractionMethod = z.infer<typeof ExtractionMethod>;
