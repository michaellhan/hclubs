/**
 * The first sentence of a club's own description, when it can stand alone as the one-line
 * description (ADR 0038). Verbatim: nothing is paraphrased or invented, so a club whose
 * About text describes it is no longer hidden as "sparse" just because no source had a
 * separate one-liner. PURE.
 *
 * Accepted only when the sentence is a plain description: 40–220 characters, ends like a
 * sentence, says what the group is or does ("X is …", "… seeks to …", "Our mission …"),
 * and carries no application talk, links, addresses or dates to act on.
 */
const DESCRIBES =
  /\b(is|are)\s+(a|an|the|dedicated|committed|concerned|devoted|focused)\b|\b(seeks?|aims?|strives?|works?|exists?|provides?|promotes?|fosters?|brings?|offers?|develops?|supports?|serves?|connects?)\b|\b(combines?|celebrates?|performs?|showcases?|shares?)\b|\bfounded\b[^.]{0,60}\bto\s+\w+|\bmission\b|\bdedicated to\b/i;
const NOT_A_DESCRIPTION =
  /\b(apply|applications?|deadline|interview|register|sign[- ]up|click|subscribe|follow us|email us|contact us)\b|https?:\/\/|www\.|@\w|\b(this|next) (week|semester|fall|spring)\b/i;

export function leadSentence(text: string | null | undefined): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  // A sentence ends at . ! ? followed by a space and a capital (not "U.S. citizens", "Dr. Smith").
  const m = /^(.+?[.!?])(?=\s+[A-Z"“(]|$)/.exec(flat);
  const sentence = m?.[1]?.trim();
  if (!sentence) return null;
  if (sentence.length < 40 || sentence.length > 220) return null;
  if (/\b(U\.S|Dr|Mr|Ms|Mrs|St|Inc|No|vs)\.$/.test(sentence)) return null;
  if (!DESCRIBES.test(sentence) || NOT_A_DESCRIPTION.test(sentence)) return null;
  return sentence;
}

/**
 * Signs a source's "short" description is a page excerpt, not a one-liner: cut off with "[…]",
 * "…" or "..." (resolver-v14: "welcomes a wide variety of dance..."), or an event pitch.
 */
const EXCERPT = /\[(?:…|\.\.\.)\]\s*$|…\s*$|\.\.\.\s*$|^\s*join us\b/i;
const SHOUT = /^[^a-z]*[A-Z]{3,}[^a-z]*[.!?]\s/;
/**
 * A page's section heading that a site's automatic excerpt glues to its first sentence
 * ("About Us Founded in 2016, TAPAS is …", resolver-v15). Only headings that never start a
 * club's own sentence, and only before a capitalized word (case-sensitive on purpose:
 * "About Face Theater" or "Mission Hill …" are names, so bare "About"/"Mission" stay).
 */
const EXCERPT_HEADING =
  /^(?:About [Uu]s|ABOUT US|Who [Ww]e [Aa]re|WHO WE ARE|Our [Mm]ission|OUR MISSION|Our [Ss]tory|OUR STORY)\s+(?=[A-Z"“])/;

/**
 * A source's short description as the club's one line (resolver-v11). Used as it is when it
 * reads like one; when it is a long or cut-off page excerpt ("GET OUTSIDE WITH HOC! The
 * Harvard Outing Club is … is our […]") or an event pitch ("Join us for the 10th iteration…"),
 * its first sentence that describes the club, verbatim. Kept as it is when no sentence does,
 * so a club never loses its only description. PURE.
 */
export function oneLineDescription(text: string | null | undefined): string | null {
  if (!text) return null;
  return oneLineOrNull(text) ?? text.replace(/\s+/g, " ").trim();
}

/** The text as a one-liner, or its first describing sentence; null when neither works. PURE. */
function oneLineOrNull(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= 200 && !EXCERPT.test(flat) && !SHOUT.test(flat)) return flat;
  const sentences = flat.split(/(?<=[.!?])\s+(?=[A-Z"“(])/);
  for (const s of sentences) {
    const lead = leadSentence(s.replace(EXCERPT_HEADING, ""));
    if (lead && !EXCERPT.test(lead) && !SHOUT.test(`${lead} `)) return lead;
  }
  return null;
}

/**
 * The club's one line from its resolved short description (resolver-v14). When the shown
 * value is an over-long excerpt with no sentence that describes the club, a competing short
 * description from a source of the same or a better tier that does read as one is used
 * instead, verbatim (the Computing Contest Club's 300-character CS-advising paragraph gives
 * way to SEAS's one sentence). Otherwise as `oneLineDescription`. PURE.
 */
export function oneLineFromResolved(
  current: { value: unknown; bestTier: number } | null | undefined,
  alternatives: readonly { value: unknown; bestTier: number }[],
): string | null {
  if (!current || typeof current.value !== "string") return null;
  const own = oneLineOrNull(current.value);
  if (own) return own;
  for (const alt of alternatives) {
    if (typeof alt.value !== "string" || alt.bestTier > current.bestTier) continue;
    const line = oneLineOrNull(alt.value);
    if (line) return line;
  }
  return oneLineDescription(current.value);
}
