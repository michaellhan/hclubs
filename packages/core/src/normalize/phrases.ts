/**
 * Collapse near-duplicate short phrases (e.g. activity bullets extracted from several pages
 * of one club site): "Parody of the Harvard Crimson" / "Parodies of the Harvard Crimson",
 * or "Publishes five issues annually" inside "Publishes five issues of a humor magazine
 * annually". Display-only: the underlying claims are untouched. PURE.
 */

const STOP = new Set("a an and the of for to in on at by with its their our as from".split(" "));

/** Crude English stem, enough to equate "parody/parodies", "issue/issues", "publishes/publishing". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  // "publishing" = "publishes" (both "publish"); not short words like "spring" or "string".
  if (word.length > 6 && word.endsWith("ing")) return word.slice(0, -3);
  return word;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !STOP.has(w))
      .map(stem),
  );
}

const subset = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t));

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/**
 * The same longer phrase in other words ("consulting on market entry, product development…"
 * / "consulting on entering new markets, developing new products…"): five or more distinct
 * words each, and three quarters of the shorter one's words in the longer.
 */
function reworded(a: Set<string>, b: Set<string>): boolean {
  if (a.size < 5 || b.size < 5) return false;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size) >= 0.75;
}

/**
 * Keep one phrase per group of near-duplicates, choosing the most specific (most distinct
 * words, then the longer text), in order of first appearance.
 */
export function collapseSimilarPhrases(phrases: readonly string[]): string[] {
  const kept: { text: string; toks: Set<string> }[] = [];
  for (const raw of phrases) {
    const text = raw.trim();
    if (!text) continue;
    const toks = tokens(text);
    const dup = kept.findIndex(
      (k) => subset(toks, k.toks) || subset(k.toks, toks) || jaccard(toks, k.toks) >= 0.75 || reworded(toks, k.toks),
    );
    if (dup === -1) {
      kept.push({ text, toks });
      continue;
    }
    const prev = kept[dup];
    if (prev && (toks.size > prev.toks.size || (toks.size === prev.toks.size && text.length > prev.text.length)))
      kept[dup] = { text, toks };
  }
  return kept.map((k) => k.text);
}

/** Wikipedia's inline markers: "[1]", "[citation needed]", "[clarification needed]", … */
const WIKI_MARKERS =
  /\s*\[(?:\d{1,3}|[a-z]|citation needed|clarification needed|when\?|who\?|which\?|according to whom\?|dubious[^\]]{0,40}|better source needed|failed verification|not in citation given)\]/gi;

/**
 * Display form of description text taken from a source (ADR 0033): Wikipedia's inline
 * markers removed and a fragment's first letter capitalized ("performs Bharatanatyam." →
 * "Performs Bharatanatyam."). The stored claim keeps the text exactly as quoted. PURE.
 */
export function cleanDescriptionText(text: string | null): string | null {
  if (!text) return text;
  const t = text
    .replace(WIKI_MARKERS, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}
