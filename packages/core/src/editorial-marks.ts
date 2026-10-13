/**
 * Wikipedia's maintenance and footnote marks ("[citation needed]", "[clarification needed]",
 * "[when?]", "[1]", "[a]") are notes to the encyclopedia's editors, not part of what a club is
 * (resolver-v20). A mark is never followed by a letter, so "[s]he" in a club's own text stays. PURE.
 */
const EDITORIAL_MARK =
  /\s*\[(?:citation needed|clarification needed|verification needed|failed verification|better source needed|full citation needed|page needed|update needed|needs update|dubious(?:\s*[–—-]\s*discuss)?|disputed(?:\s*[–—-]\s*discuss)?|vague|non sequitur|original research\??|according to whom\?|by whom\?|when\?|where\?|who\?|whom\?|which\?|why\?|how\?|year needed|date missing|clarify|cn|note \w{1,3}|\d{1,3}|[a-z])\](?![a-z])/gi;

/** The text without editorial marks; its own line breaks and spacing otherwise kept. */
export function withoutEditorialMarks(text: string): string {
  return text.replace(EDITORIAL_MARK, "");
}

/** The text without editorial marks, on one line (whitespace collapsed). */
export function flatWithoutEditorialMarks(text: string): string {
  return withoutEditorialMarks(text).replace(/\s+/g, " ").trim();
}

/**
 * The text starts mid-sentence: a lowercase word ("which performs in the Memorial Church",
 * "founded in the 1960s.", "a non-audition group…") or a bracket. A name written in mixed
 * case ("iGEM", "hackHarvard") is a start, not a fragment. PURE.
 */
export function startsMidSentence(text: string): boolean {
  const t = text.trimStart();
  if (t.startsWith("[")) return true;
  if (!/^[a-z]/.test(t)) return false;
  return !/^[a-z][a-zA-Z]*[A-Z0-9]/.test(t);
}
