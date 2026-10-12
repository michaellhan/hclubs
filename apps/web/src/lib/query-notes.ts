import { RECRUITING_SEASON_LABEL, type RecruitingSeason } from "@hci/core/browser";
import { constraintPatch, type ClubFilters, type ConstraintFilter, type QueryConstraint } from "@hci/db/local";
import { JOINING_FILTERS } from "./joining";

/** The filter's plain-language name, shared with the filter chips and the filter panel. */
export const constraintLabel = (c: ConstraintFilter, value?: number, season?: RecruitingSeason): string => {
  if (c === "maxHours") return value === undefined ? "hours a week" : `up to ${value} hours a week`;
  if (c === "recruitingSeason")
    return season ? `Usually recruits in ${RECRUITING_SEASON_LABEL[season].toLowerCase()}` : "Usually recruits in";
  return JOINING_FILTERS[c].label;
};

/**
 * "Read “no comp” as the No comp filter." (one sentence per phrase). An hours limit says what
 * it leaves out: clubs that don't state their hours (`hoursUnknown` of them) aren't included.
 * A phrase read as another filter says why ("recruiting" when no round is open anywhere).
 */
export function constraintSentences(constraints: readonly QueryConstraint[], hoursUnknown?: number | null): string[] {
  return constraints.map((c) => {
    if (c.instead === "recruitingNow")
      return `No club has a round open right now, so “${c.phrase}” shows the ${constraintLabel(c.filter)} filter instead.`;
    if (c.filter !== "maxHours")
      return `Read “${c.phrase}” as the ${constraintLabel(c.filter, undefined, c.season)} filter.`;
    const dontSay = hoursUnknown != null ? ` (${hoursUnknown.toLocaleString("en-US")} don't say)` : "";
    return `Read “${c.phrase}” as ${constraintLabel(c.filter, c.value)}. Clubs that don't say their hours aren't included${dontSay}.`;
  });
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
  return { q: searchedText.trim() || null, filters: { ...filters, ...constraintPatch(constraints) } };
}

/**
 * "not recruiting" can't be searched (the filters only say yes): say so instead of silently
 * returning clubs that are. Null when nothing was negated.
 */
export function negatedSentence(negated: readonly string[]): string | null {
  if (!negated.length) return null;
  const things = negated.map((n) => `“${n}”`).join(", ");
  return `We can't search for clubs that aren't something (${things}); showing everything matching the rest.`;
}

/** One quiet sentence for soft words ("beginner", "low commitment"), or null. */
export function softSentence(soft: readonly string[], alone = false): string | null {
  if (!soft.length) return null;
  const words = soft.map((s) => `“${s}”`).join(", ");
  // Alone, soft words select the clubs that answer them (nothing else to rank), so say that.
  return alone
    ? `Showing clubs that say they fit ${words}. Few clubs state their hours or level, so many others may fit too.`
    : `Few clubs state their hours or level, so ${words} only moves clubs that say it to the top; it doesn't leave the others out.`;
}

/**
 * Process words ("comp", "deadline") were read as "clubs with that process first", never as
 * required text: say so, so a student knows why "comp" didn't match "computer". PURE.
 */
export function processSentence(process: readonly string[], alone: boolean): string | null {
  if (!process.length) return null;
  const words = process.map((p) => `“${p}”`).join(", ");
  return alone
    ? `Showing clubs whose joining process or round matches ${words}.`
    : `Clubs whose joining process or round matches ${words} come first; the word itself isn't required.`;
}
