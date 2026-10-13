/**
 * Near-duplicate detection for short list values such as activities ("Spring vacation
 * tour in Bermuda" / "Spring break tour in Bermuda", "Performing more than 200 concerts
 * annually" / "Recording albums and performing 200+ concerts annually"). PURE.
 *
 * Words are lowercased, lightly stemmed, stripped of filler and mapped through a tiny
 * synonym table; one value is a near-duplicate of another when its content words are all
 * in the other (the longer, more informative one is kept). A value with fewer than two
 * content words only matches an identical one, so "Tour" never swallows anything.
 */

const FILLER = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "at",
  "to",
  "for",
  "on",
  "with",
  "by",
  "from",
  "across",
  "more",
  "than",
  "over",
  "each",
  "every",
  "per",
  "our",
  "its",
  "their",
  "as",
  "is",
  "are",
]);
const SYNONYMS: Record<string, string> = {
  vacation: "break",
  annually: "annual",
  yearly: "annual",
  year: "annual",
  concerts: "concert",
  performances: "performance",
};

function stem(w: string): string {
  const s = SYNONYMS[w] ?? w;
  if (/^\d+$/.test(s)) return s;
  let t = s;
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return SYNONYMS[t] ?? t;
}

/** The content words of a value, as a set. PURE. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text
    .toLowerCase()
    .replace(/(\d)\+/g, "$1 ")
    .split(/[^a-z0-9]+/)) {
    if (!raw || FILLER.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** Whether every content word of `small` appears in `big`. PURE. */
function covered(small: Set<string>, big: Set<string>): boolean {
  if (small.size === 0) return false;
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

/**
 * Whether `value` only restates `other`, so retiring it loses nothing: all its content
 * words are in `other` (what `dedupeNearDuplicates` already folds), or the two share most
 * of their words (Jaccard ≥ 0.4, both at least two words) and `value` is not the fuller
 * wording (it lacks some of `other`'s words). A fuller wording that contains `other` never
 * restates it ("Black Legacy Ball, a February celebration…" vs "Black Legacy Ball"). Used to
 * retire LLM paraphrases a newer extractor version didn't repeat (2026-10-12). PURE.
 */
export function restates(value: string, other: string): boolean {
  const mine = contentWords(value);
  const theirs = contentWords(other);
  if (mine.size === 0) return false;
  if (covered(mine, theirs)) return mine.size >= 2 || mine.size === theirs.size;
  if (mine.size < 2 || theirs.size < 2 || covered(theirs, mine)) return false;
  let shared = 0;
  for (const w of mine) if (theirs.has(w)) shared++;
  return shared / (mine.size + theirs.size - shared) >= 0.4;
}

/**
 * Of values given in priority order, the ones to show: a value covered by an earlier
 * kept one is dropped; a value that covers earlier kept ones replaces the first of them
 * (taking its place) and removes the rest. Returns indexes into `values`. PURE.
 */
export function dedupeNearDuplicates(values: readonly string[]): number[] {
  const words = values.map(contentWords);
  const kept: number[] = [];
  values.forEach((_, i) => {
    const mine = words[i] as Set<string>;
    const comparable = (j: number) => {
      const other = words[j] as Set<string>;
      const small = Math.min(mine.size, other.size);
      return small >= 2 || (mine.size === other.size && covered(mine, other));
    };
    if (kept.some((j) => comparable(j) && covered(mine, words[j] as Set<string>))) return;
    const swallowed = kept.filter((j) => comparable(j) && covered(words[j] as Set<string>, mine));
    if (swallowed.length) {
      const first = swallowed[0] as number;
      kept[kept.indexOf(first)] = i;
      for (const j of swallowed.slice(1)) kept.splice(kept.indexOf(j), 1);
    } else kept.push(i);
  });
  return kept;
}
