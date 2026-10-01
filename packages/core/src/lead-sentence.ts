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
  /\b(is|are)\s+(a|an|the|dedicated|committed|concerned|devoted|focused)\b|\b(seeks?|aims?|strives?|works?|exists?|provides?|promotes?|fosters?|brings?|offers?|develops?|supports?|serves?|connects?)\b|\bmission\b|\bdedicated to\b/i;
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
