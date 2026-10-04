/**
 * Whether a profile's About paragraph mostly repeats the one-line description shown above it.
 * One-liners are written from the club's own text, so on many profiles About says the same
 * thing again at greater length. Compares content words (light stemming, the club's own name
 * words ignored); About is hidden when the one-liner already covers most of them. PURE.
 */
const STOP = new Set(
  "the and for with from that this our are was were its their them they has have had who whom which what when where into onto about also all any can each more most other some such than then there these those through under over very will would been being both but not out per via how why you your yourself we us".split(
    " ",
  ),
);

const stem = (w: string) => w.replace(/(?:ing|ed|es|s)$/, "") || w;

function contentStems(text: string, ignore: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of text
    .toLowerCase()
    .normalize("NFKD")
    .match(/[a-z]+/g) ?? []) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    const s = stem(raw);
    if (!ignore.has(s)) out.add(s);
  }
  return out;
}

/** Share of About's content words the one-liner also uses, at or above which About is hidden. */
export const ABOUT_REPEAT_THRESHOLD = 0.7;

export function aboutCoverage(oneLine: string, about: string, clubName: string): number {
  const ignore = contentStems(clubName, new Set());
  const aboutWords = contentStems(about, ignore);
  if (aboutWords.size === 0) return 1;
  const lineWords = contentStems(oneLine, ignore);
  let covered = 0;
  for (const w of aboutWords) if (lineWords.has(w)) covered++;
  return covered / aboutWords.size;
}

/** A sentence the one-liner already says (most of its content words). */
const SENTENCE_REPEAT_THRESHOLD = 0.6;

/** Sentences, not split after an initial ("Harvard U. GlobalWE") or a common abbreviation. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?]["”’)]?\s+(?=["“(]?[A-Z0-9])/g)) {
    const end = (m.index ?? 0) + m[0].trimEnd().length;
    const before = text.slice(start, end);
    if (/(?:\b[A-Z]|\b(?:Mr|Ms|Mrs|Dr|St|Mt|Ave|Rd|Blvd|No|Jr|Sr|Prof|Inc|Co|vs|etc|e\.g|i\.e|U\.S))\.$/.test(before)) continue;
    out.push(before.trim());
    start = (m.index ?? 0) + m[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/**
 * The About text to show under a one-liner: null when it mostly repeats it, otherwise About
 * without the sentences the one-liner already says.
 */
export function aboutToShow(oneLine: string | null, about: string, clubName: string): string | null {
  if (!oneLine) return about;
  if (aboutCoverage(oneLine, about, clubName) >= ABOUT_REPEAT_THRESHOLD) return null;
  const kept = sentences(about).filter((s) => aboutCoverage(oneLine, s, clubName) < SENTENCE_REPEAT_THRESHOLD);
  return kept.length ? kept.join(" ") : null;
}
