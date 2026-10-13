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

/** Soft words that ask about auditions or tryouts ("no tryouts", "unauditioned"). */
const NO_PROCESS = /audition|try ?outs?\b/;

/** Class-year words ("first years", "sophomores", "transfers"): who a club takes. */
const CLASS_WORDS =
  /fresh|frosh|first ?years?|sophomore|junior|senior|upperclass|second year|third year|fourth year|transfer/;
/** Time words ("low commitment", "flexible", "no weekly meetings"): how much time a club takes. */
const TIME_WORDS =
  /commitment|time|hours?|flexible|schedule|pace|weekly|week|monthly|month|meetings?|one day|one time|one off|occasional/;

/**
 * What few clubs say, in plain words for the soft words typed (Round 14: "hours or level" was
 * jargon to a first-year): who they take, how much time they take, or whether you need experience.
 */
function fewSay(soft: readonly string[]): string {
  if (soft.every((s) => CLASS_WORDS.test(s))) return "Few clubs say which years they take";
  if (soft.every((s) => TIME_WORDS.test(s))) return "Few clubs say how much time they take";
  if (soft.some((s) => CLASS_WORDS.test(s) || TIME_WORDS.test(s)))
    return "Few clubs say who they take or how much time they take";
  return "Few clubs say whether you need experience";
}

/** One quiet sentence for soft words ("beginner", "low commitment"), or null. */
export function softSentence(soft: readonly string[], alone = false): string | null {
  if (!soft.length) return null;
  const words = soft.map((s) => `“${s}”`).join(", ");
  // "no tryouts" is about how clubs pick members, not hours or level (Round 11).
  if (soft.every((s) => NO_PROCESS.test(s)))
    return alone
      ? `Showing clubs that say they are open to everyone, need no experience or don't audition. Clubs that hold auditions or tryouts aren't included.`
      : `Clubs that hold auditions or tryouts go last for ${words}; clubs that don't say aren't left out.`;
  // Alone, soft words select the clubs that answer them (nothing else to rank), so say that.
  return alone
    ? `Showing clubs that say they fit ${words}. ${fewSay(soft)}, so many others may fit too.`
    : `${fewSay(soft)}, so ${words} only moves clubs that say it to the top; it doesn't leave the others out.`;
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
