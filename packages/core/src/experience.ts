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
    String.raw`\b(?:all|any)\s+levels?\s+of\s+(?:experience|knowledge|skill|ability|exposure)\b`,
    String.raw`\blevels\s+of\s+experience\s+(?:are\s+)?welcome\b`,
    String.raw`\ball\s+levels\s+(?:are\s+)?(?:welcome|encouraged)`,
    // "we'll teach you everything"
    String.raw`\bwe['’]?(?:ll|\s+will)\s+teach\s+you\b`,
    // "Most members join with little or no formal PM background." (joining-v3: "staff writers comped
    // with no previous comedy writing experience", "most people come into HUCG with no clue")
    String.raw`\b(?:join(?:ed)?|comp(?:ed)?|c[oa]me\s+in(?:to(?:\s+[\w-]+){1,2})?)\s+with\s+(?:little\s+or\s+)?no\s+(?:(?:prior|previous|formal)\s+)?(?:[\w-]+\s+){0,2}(?:${EXP}|clue)\b`,
    // joining-v3 (round 3): plain answers and welcomes the patterns above missed.
    // "Do I need teaching experience? Not at all!", "Q: Do I need to have a cappella experience …? A: Not at all!"
    String.raw`\bdo\s+i\s+need\s+(?:to\s+have\s+)?(?:any\s+)?(?:[\w-]+\s+){0,3}${EXP}\b[^?]{0,80}\?\s*(?:A:\s*)?(?:not\s+at\s+all|no\b|nope|not\s+a\s+problem)`,
    // "Singers of all musical backgrounds and experiences are invited", "all backgrounds and skill levels"
    String.raw`\ball\s+(?:[\w-]+\s+)?backgrounds\s+and\s+(?:experiences|(?:skill|experience|ability)\s+levels|levels\s+of\s+(?:experience|exposure|knowledge|skill))\b`,
    // "players and students of all strengths"
    String.raw`\b(?:players|students|members|dancers|singers|musicians|athletes)\b[^.;!?]{0,30}\bof\s+all\s+(?:strengths|abilities)\b`,
    // "Whether you’re new to AI or …", "whether you’re just getting started in computer science"
    String.raw`\bwhether\s+you['’]?re\s+(?:just\s+getting\s+started|(?:completely\s+|totally\s+)?new\s+to|a\s+(?:complete\s+)?beginner)\b`,
    String.raw`\bif\s+you['’]?re\s+(?:just\s+)?starting\s+out\b`,
    String.raw`\bwhether\s+(?:or\s+not\s+you\s+consider\s+yourself|you\s+consider\s+yourself\s+an?\s+[\w-]+\s+or\s+not)\b`,
    // "from first-timers to competitive fencers"
    String.raw`\bfrom\s+(?:complete\s+|absolute\s+|total\s+)?(?:first-?timers|novices)\s+to\b`,
    // "you don’t need to play an instrument to become a Bandie"
    String.raw`\b(?:do(?:es)?\s+not|don['’]t)\s+need\s+to\s+(?:play|know\s+how\s+to|have\s+(?:played|danced|sung))\b[^.;!?]{0,40}\bto\s+(?:join|become|be\s+(?:a|part))\b`,
    // "both amateur and professional pianists"
    String.raw`\bamateurs?\s+and\s+professionals?\b`,
    // "encouraged to comp the Review regardless of background"
    String.raw`\b(?:comp|join|apply|audition|try\s*out)\w*\b[^.;!?]{0,40}\bregardless\s+of\s+(?:your\s+)?(?:prior\s+)?background\b`,
    // "regardless of year or musical background"
    String.raw`\b(?:regardless\s+of|no\s+matter)\s+(?:your\s+)?(?:[\w-]+\s+){0,2}(?:musical|technical|dance|debate|coding|programming|finance|financial|business|singing|acting|athletic|artistic)\s+background\b`,
    // "Experience with building bicycles is also a plus, but by no means required."
    String.raw`\b${EXP}\b[^.;!?]{0,50}\b(?:a\s+plus|helpful|welcome|great)\b[^.;!?]{0,25}\b(?:not|by\s+no\s+means)\s+(?:required|necessary|needed)\b`,
    // "Absolutely no requirements for comping except a willingness to …"
    String.raw`\bno\s+requirements?\s+(?:for|to)\s+(?:comp(?:ing)?|join(?:ing)?|apply(?:ing)?)\b`,
  ].join("|"),
  "i",
);

/**
 * The same heading run into the next sentence by a page's markup (case-sensitive on purpose):
 * "No experience neededMost Crimson editors had never worked for a newspaper" (joining-v3).
 */
const RUN_ON_NO_EXPERIENCE =
  /\b[Nn]o\s+(?:(?:prior|previous)\s+)?(?:[\w-]+\s+){0,2}experience\s+(?:necessary|needed|required)(?=[A-Z])/;

/** The statement is about one role, event or program, not joining the club. */
const SCOPED_QUOTE =
  // joining-v3: a board only as leadership ("e-board", "board positions"); at The Crimson a
  // board is the membership ("Many have joined the board before even finishing CS50!").
  /\b(?:hackathons?|biohackathon|events?|workshops?|conferences?|arranging|conduct(?:ing|ors?)|script-writing|lighting design|e-?board|executive\s+board|board\s+(?:positions?|roles?|seats?|members?)|(?:run|running)\s+for\s+(?:the\s+)?board|ambassadors?|fellowships?)\b/i;
/** The extractor's paraphrase narrows the statement: "No laboratory experience necessary (for the BioHackathon)". */
const SCOPED_VALUE =
  /\((?:for|in|only)\b[^)]*\)|\bfor\s+(?:the\s+)?[\w-]*\s*(?:hackathon|event|workshop|conference|fellowship)s?\b/i;

/** Whether this verbatim quote states that no prior experience is needed. PURE. */
export function statesNoExperience(quote: string | null | undefined): boolean {
  if (!quote) return false;
  const q = quote.replace(/\s+/g, " ");
  return (NO_EXPERIENCE.test(q) || RUN_ON_NO_EXPERIENCE.test(q)) && !SCOPED_QUOTE.test(q);
}

/** Whether the claim's own value narrows it to one role or event. PURE. */
export function experienceValueScoped(value: unknown): boolean {
  return typeof value === "string" && SCOPED_VALUE.test(value);
}
