import { normalizeName } from "@hci/core/browser";
import { CONCEPT_BY_TERM } from "./concepts";
import { abbreviates, cleanQuery, distinctiveNamePrefixes, editDistance, nameInitials, nameWordDf } from "./search";
import type { IndexClub } from "./types";

/**
 * Typeahead: clubs whose name, acronym or alias the student is typing ("hcs", "harvard
 * comp", "krokodil", or "krokodils" with a one-letter slip). Names only — topic
 * search stays in `searchLocal`. Fast enough to run on every keystroke over the whole
 * index (no allocation-heavy parsing). PURE.
 */
export type SuggestionMatch =
  "acronym" | "name" | "alias" | "acronymPrefix" | "initials" | "word" | "abbreviation" | "spelling";

export interface Suggestion {
  club: IndexClub;
  match: SuggestionMatch;
}

const SCORE: Record<SuggestionMatch, number> = {
  acronym: 100,
  name: 90,
  alias: 80,
  acronymPrefix: 75,
  initials: 70,
  word: 60,
  abbreviation: 55,
  spelling: 40,
};

/** Leading words people skip when typing a name ("harvard undergraduate robotics" → "robotics"). */
const LEAD = new Set(["harvard", "radcliffe", "college", "undergraduate", "undergraduates", "the", "university"]);
const core = (n: string) => {
  const ws = n.split(" ");
  let i = 0;
  while (i < ws.length - 1 && LEAD.has(ws[i]!)) i++;
  return ws.slice(i).join(" ");
};

function best(
  club: IndexClub,
  q: string,
  compact: string,
  fullForms: readonly string[],
  df: ReadonlyMap<string, number>,
): SuggestionMatch | null {
  const names = club.searchNames.split(" | ");
  const acronyms = club.searchAcronyms.map((a) => a.toLowerCase());
  if (acronyms.includes(compact)) return "acronym";
  const [canonical = "", ...aliases] = names;
  if (canonical.startsWith(q) || core(canonical).startsWith(q)) return "name";
  // Aliases that are acronyms ("hcs") count as acronyms below.
  if (aliases.some((a) => !acronyms.includes(a) && (a.startsWith(q) || core(a).startsWith(q)))) return "alias";
  if (compact.length >= 2 && acronyms.some((a) => a.startsWith(compact))) return "acronymPrefix";
  if (compact.length >= 3 && names.some((n) => nameInitials(n) === compact)) return "initials";
  const qw = q.split(" ");
  const last = qw[qw.length - 1]!;
  const head = qw.slice(0, -1);
  if (last.length >= 2) {
    for (const n of names) {
      const ws = n.split(" ");
      if (head.every((w) => ws.includes(w)) && ws.some((w) => w.startsWith(last) && !head.includes(w))) return "word";
    }
  }
  // One slip in a word of 5+ letters (two from 8), first letter kept. Not shorter: half-typed
  // words are too close to unrelated ones ("comp" ~ "comb").
  if (last.length >= 5) {
    const max = last.length >= 8 ? 2 : 1;
    for (const n of names)
      for (const w of n.split(" ")) {
        if (w[0] !== last[0]) continue;
        // Compare with the word's start, so a half-typed slip still suggests ("krokod" ~ "krokodiloes").
        const stem = w.length > last.length + max ? w.slice(0, last.length) : w;
        if (editDistance(last, stem, max) <= max && head.every((h) => n.split(" ").includes(h))) return "spelling";
      }
  }
  // A nickname that begins a distinctive name word, also in the plural ("kroks" → Krokodiloes).
  if (last.length >= 4) {
    const pre = distinctiveNamePrefixes(last, df, df);
    if (pre.length) {
      for (const n of names) {
        const ws = n.split(" ");
        if (head.every((w) => ws.includes(w)) && pre.some((x) => ws.includes(x))) return "word";
      }
    }
  }
  // A known abbreviation of a phrase in the name ("mun" → Model United Nations).
  if (fullForms.some((f) => names.some((n) => ` ${n} `.includes(` ${f} `)))) return "abbreviation";
  return null;
}

/** Up to `n` clubs whose name the query starts or abbreviates, best first. PURE. */
export function suggest(clubs: readonly IndexClub[], text: string, n = 5): Suggestion[] {
  const q = normalizeName(cleanQuery(text));
  if (q.length < 2) return [];
  const compact = q.replace(/ /g, "");
  const concept = CONCEPT_BY_TERM.get(q);
  const fullForms = concept ? concept.terms.filter((t) => abbreviates(q, t)) : [];
  const df = nameWordDf(clubs);
  const out: { s: Suggestion; score: number }[] = [];
  for (const club of clubs) {
    if (club.activityStatus === "defunct") continue;
    const match = best(club, q, compact, fullForms, df);
    if (!match) continue;
    // Clubs that ended or belong to a graduate school stay findable, below current ones.
    const hidden = club.activityStatus === "inactive" || club.affiliationScope === "graduate_school";
    // Three letters are the initials of too many names ("hcc": Chess, Cricket, Curling
    // Club): those rank below every other kind of match.
    const weakInitials = match === "initials" && compact.length < 4;
    out.push({ s: { club, match }, score: SCORE[match] - (hidden ? 25 : 0) - (weakInitials ? 30 : 0) });
  }
  return out
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.s.club.name.length - b.s.club.name.length ||
        a.s.club.name.localeCompare(b.s.club.name) ||
        a.s.club.id.localeCompare(b.s.club.id),
    )
    .slice(0, n)
    .map((x) => x.s);
}
