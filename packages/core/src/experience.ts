/**
 * "No experience needed" statements (ADR 0042). PURE.
 *
 * Reads the VERBATIM quote behind a `club.experience_required` claim (never the extractor's
 * paraphrase) and says whether it plainly states that joining needs no prior experience:
 * "No experience necessary!", "You do not need any previous experience to join",
 * "regardless of prior experience", "from complete beginners to seasoned competitors".
 *
 * Deliberately one-sided: a quote that doesn't match is unknown, never "experience
 * required". Requirement statements on club pages are mostly about one role or one
 * audition piece ("prepare two contrasting selections"), so "no" isn't derived.
 *
 * Inferences are not statements: "many of our racers began as complete novices" or
 * "athletes at all levels, including varsity" don't count. Nor does a statement about one
 * role, event or staff seat ("Arranging or student conducting (no experience required)",
 * "No laboratory experience necessary" for a hackathon).
 */

const EXP = String.raw`(?:experience|expereince|background|training|knowledge|skills?|expertise|familiarity)`;

const NO_EXPERIENCE = new RegExp(
  [
    // "No (prior) (debate) experience (is) necessary / needed / required / expected"
    String.raw`\bno\s+(?:(?:prior|previous|former|formal|specific)\s+)?(?:[\w-]+\s+){0,2}${EXP}\b[^.;!?]{0,70}?\b(?:is\s+|are\s+)?(?:necessary|needed|required|expected|assumed)\b`,
    // "We hold no auditions and require no prior experience."
    String.raw`\brequires?\s+no\s+(?:prior\s+|previous\s+)?${EXP}\b`,
    // "You do not need any previous experience", "We don't require any previous experience"
    String.raw`\b(?:do(?:es)?\s+not|don['’]t)\s+(?:need|require|have\s+to\s+have)\s+(?:to\s+have\s+)?(?:any\s+)?(?:prior\s+|previous\s+)?(?:[\w-]+\s+){0,2}${EXP}\b`,
    // "regardless of (your degree of) prior experience", "no matter your background or prior experience"
    String.raw`\b(?:regardless\s+of|no\s+matter)\s+[^.;!?]{0,60}?\b(?:experience|ability|skill\s+level)\b`,
    // "without prior business experience under your belt", "accessible to students with no prior finance experience"
    String.raw`\b(?:with|without)\s+(?:little\s+or\s+)?(?:no\s+)?(?:prior|previous)?\s*(?:[\w-]+\s+){0,2}${EXP}\b[^.;!?]{0,30}?\b(?:welcome|accessible|join|encouraged|apply|under\s+your\s+belt)`,
    String.raw`\b(?:students|people|everyone|those)\b[^.;!?]{0,30}\bwith\s+no\s+(?:prior\s+)?(?:[\w-]+\s+){0,2}${EXP}\b`,
    // "Beginners ... are welcome", "from complete beginners to seasoned competitors"
    String.raw`\bbeginners?\b[^.;!?]{0,40}\b(?:welcome|encouraged|invited)\b`,
    String.raw`\bfrom\s+(?:complete\s+|absolute\s+|total\s+)?beginners\s+to\b`,
    // "all skill levels", "any level of knowledge", "levels of experience are welcome"
    String.raw`\ball\s+(?:skill|experience|ability|playing)\s+levels\b`,
    String.raw`\b(?:all|any)\s+levels?\s+of\s+(?:experience|knowledge|skill|ability)\b`,
    String.raw`\blevels\s+of\s+experience\s+(?:are\s+)?welcome\b`,
    String.raw`\ball\s+levels\s+(?:are\s+)?(?:welcome|encouraged)`,
    // "we'll teach you everything"
    String.raw`\bwe['’]?(?:ll|\s+will)\s+teach\s+you\b`,
    // "Most members join with little or no formal PM background."
    String.raw`\bjoin\s+with\s+(?:little\s+or\s+)?no\s+(?:[\w-]+\s+){0,2}${EXP}\b`,
  ].join("|"),
  "i",
);

/** The statement is about one role, event or program, not joining the club. */
const SCOPED_QUOTE =
  /\b(?:hackathons?|biohackathon|events?|workshops?|conferences?|arranging|conduct(?:ing|ors?)|script-writing|lighting design|(?:e-?|executive\s+)?board|ambassadors?|fellowships?)\b/i;
/** The extractor's paraphrase narrows the statement: "No laboratory experience necessary (for the BioHackathon)". */
const SCOPED_VALUE =
  /\((?:for|in|only)\b[^)]*\)|\bfor\s+(?:the\s+)?[\w-]*\s*(?:hackathon|event|workshop|conference|fellowship)s?\b/i;

/** Whether this verbatim quote states that no prior experience is needed. PURE. */
export function statesNoExperience(quote: string | null | undefined): boolean {
  if (!quote) return false;
  const q = quote.replace(/\s+/g, " ");
  return NO_EXPERIENCE.test(q) && !SCOPED_QUOTE.test(q);
}

/** Whether the claim's own value narrows it to one role or event. PURE. */
export function experienceValueScoped(value: unknown): boolean {
  return typeof value === "string" && SCOPED_VALUE.test(value);
}
