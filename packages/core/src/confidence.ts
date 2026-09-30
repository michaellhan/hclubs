import type { AssertionKind, ExtractionMethod, SourceType } from "./enums";
import { SOURCE_TYPE_TIER } from "./enums";

/**
 * Confidence rubric (0–1). CLAUDE.md §7.2. Computed, never hand-assigned per claim.
 * Changing these numbers changes displayed confidence everywhere: bump the version.
 */
export const CONFIDENCE_VERSION = "confidence-v1";

const BASE_BY_TIER: Record<number, number> = {
  0: 0.99,
  1: 0.95,
  2: 0.9,
  3: 0.85,
  4: 0.85,
  5: 0.8,
  6: 0.75,
  7: 0.65,
  8: 0.5,
  9: 0.35,
};

const METHOD_FACTOR: Record<ExtractionMethod, number> = {
  structured_data: 1,
  html_parse: 0.95,
  manual: 0.95,
  llm: 0.85, // only valid with a verified verbatim quote (CLAUDE.md §11.3)
  user_submission: 1, // tier already reflects this
  fixture: 1,
};

export function computeConfidence(input: {
  sourceType: SourceType;
  trustTier?: number;
  extractionMethod: ExtractionMethod;
  isDirect: boolean;
}): number {
  const tier = input.trustTier ?? SOURCE_TYPE_TIER[input.sourceType];
  const base = BASE_BY_TIER[tier] ?? 0.5;
  const directness = input.isDirect ? 1 : 0.5;
  const c = base * METHOD_FACTOR[input.extractionMethod] * directness;
  return Math.round(Math.min(0.99, Math.max(0, c)) * 1000) / 1000;
}

/** Combine independent confirmations: 1 - Π(1 - cᵢ), capped. */
export function combineConfidence(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const miss = values.reduce((acc, c) => acc * (1 - Math.min(0.99, Math.max(0, c))), 1);
  return Math.round(Math.min(0.99, 1 - miss) * 1000) / 1000;
}

export function assertionIsFactual(kind: AssertionKind): boolean {
  return kind === "stated" || kind === "editorial" || kind === "user_reported";
}
