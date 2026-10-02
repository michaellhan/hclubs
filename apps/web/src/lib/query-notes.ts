import type { ClubFilters, ConstraintFilter, QueryConstraint } from "@hci/db/local";
import { JOINING_FILTERS } from "./joining";

/** The filter's plain-language name, shared with the filter chips. */
export const constraintLabel = (c: ConstraintFilter): string => JOINING_FILTERS[c].label;

/** "Read “no comp” as the No comp filter." (one sentence per phrase). */
export function constraintSentences(constraints: readonly QueryConstraint[]): string[] {
  return constraints.map((c) => `Read “${c.phrase}” as the ${constraintLabel(c.filter)} filter.`);
}

/**
 * The URL state that turns the phrases a search read as filters into real filters: the
 * words come out of `q` (what's left is `searchedText`) and each filter goes on. PURE.
 */
export function constraintsToFilters(
  constraints: readonly QueryConstraint[],
  searchedText: string,
  filters: ClubFilters,
): { q: string | null; filters: ClubFilters } {
  const patch: Partial<ClubFilters> = {};
  for (const c of constraints) patch[c.filter] = true;
  return { q: searchedText.trim() || null, filters: { ...filters, ...patch } };
}

/** One quiet sentence for soft words ("beginner", "low commitment"), or null. */
export function softSentence(soft: readonly string[]): string | null {
  if (!soft.length) return null;
  const words = soft.map((s) => `“${s}”`).join(", ");
  return `Few clubs state their hours or level, so ${words} only moves clubs that say it to the top; it doesn't leave the others out.`;
}
