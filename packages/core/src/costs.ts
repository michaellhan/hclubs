/**
 * Costs beyond dues (joining-v6, student testing round 7). PURE.
 *
 * Most "No dues" values come from the College directory's flag, which says nothing about
 * what else members pay for. When a club's own words say members pay for something
 * ("If you would like to purchase a uniform (Gi) that will be at your own cost.", "Retreat
 * costs are subsidized"), a student reading "No dues" as "free" is misled. This reads the
 * VERBATIM quote behind a value and says whether one of its sentences states such a cost.
 *
 * Deliberately narrow:
 *  - "self-funded" is not a member cost: the Krokodiloes' "self-funded world tour" is funded by
 *    the group, and the same site says it tours "at no cost to their members";
 *  - a sentence that says the thing costs nothing ("at no cost", "fully subsidized", "you will
 *    not need to pay out of pocket", "free") states no cost;
 *  - fees charged to outsiders (conference registration, camp tuition) are not costs of
 *    membership: only trips, tours, travel, retreats, costumes, uniforms, equipment, lessons and
 *    competitions, or members/you paying, count.
 */

const ITEM = String.raw`(?:trips?|tours?|travel|retreats?|costumes?|uniforms?|equipment|gear|lessons?|competitions?|tournaments?)`;

const EXTRA_COST = new RegExp(
  [
    // "that will be at your own cost", "at their own expense"
    String.raw`\bat\s+(?:your|their|one['’]?s|the\s+member['’]?s|members['’]?)?\s*own\s+(?:cost|expense)\b`,
    String.raw`\bout[- ]of[- ]pocket\b`,
    // "members are responsible for paying", "you will need to purchase"
    String.raw`\b(?:members|you|students|participants|dancers|riders|players|rowers|athletes)\s+(?:will\s+)?(?:need\s+to|must|have\s+to|are\s+expected\s+to|are\s+responsible\s+for)\s+(?:pay(?:ing)?|purchas(?:e|ing)|buy(?:ing)?|cover(?:ing)?)\b`,
    // "Retreat costs are subsidized", "trip fees"
    String.raw`\b${ITEM}\s+(?:fees?|costs?)\b`,
    // "a fee for the trip", "the cost of lessons"
    String.raw`\b(?:fees?|costs?)\s+(?:for|of)\s+(?:the\s+|a\s+|an\s+|our\s+|each\s+)?(?:[\w-]+\s+)?${ITEM}\b`,
  ].join("|"),
  "i",
);

/** The sentence says it costs nothing. */
export const NO_COST =
  /\b(?:at|for)\s+no\s+(?:extra\s+|additional\s+)?(?:cost|charge)\b|\bfree\b|\bfully\s+(?:subsidi[sz]ed|funded|covered|paid)\b|\b(?:not|never|no\s+need\s+to|don['’]t|do\s+not)\s+(?:\w+\s+){0,3}(?:pay|cost|charge)\b|\bno\s+(?:extra\s+|additional\s+)?(?:cost|costs|fees?|charge)\b|\bcovers?\s+(?:all|every|the\s+full)\b/i;

/** The sentences of a quote (no abbreviation handling needed: cost sentences are short). */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The first sentence of `quote` that states a cost members pay beyond dues, or null. PURE. */
export function statedExtraCost(quote: string | null | undefined): string | null {
  if (!quote) return null;
  for (const s of sentences(quote)) if (EXTRA_COST.test(s) && !NO_COST.test(s)) return s;
  return null;
}

/**
 * The part of a value's own text (an activity, a dues note; text already shown on the profile)
 * that names the cost: "uniform at own cost" from "Classes are free with a valid MAC membership;
 * uniform at own cost". Null when no clause of it speaks of a cost without saying it's free. PURE.
 */
export function costClause(text: string): string | null {
  for (const raw of text.split(/\s*[;,]\s*|\s+[-–—]\s+/)) {
    const c = raw.trim();
    if (c.length < 4 || NO_COST.test(c)) continue;
    if (EXTRA_COST.test(c) || /\b(?:costs?|fees?|expense|purchase|pay)\b/i.test(c)) return c;
  }
  return null;
}
