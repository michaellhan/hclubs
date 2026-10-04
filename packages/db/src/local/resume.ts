import { normalizeName } from "@hci/core/browser";
import { boardEligible } from "./board";
import { CONCEPT_BY_TERM, CONCEPTS, type Concept } from "./concepts";
import { matchClub, nameWordDf, parseQuery, type MatchReason } from "./search";
import type { IndexClub } from "./types";
import { wordVariants } from "./variants";

/**
 * Resume → club recommendations, entirely in the browser (the resume is never sent
 * anywhere). PURE.
 *
 * 1. `readResumeInterests` finds interests in the resume's text: search concepts
 *    ("python" → Software, "equity research" → Finance) and rare club-name words
 *    ("rowing", "bhangra") that point at a few clubs. Contact lines and the name line are
 *    skipped; generic resume phrases ("social media", "customer service") never count.
 * 2. `matchResume` scores every club with the directory's own relevance model, once per
 *    interest, weighted by how often the resume mentions it, plus a bonus for matching
 *    several interests. Each pick says which interests chose it.
 */

export interface ResumeInterest {
  /** Stable id: `c:<concept key>` or `w:<word>`. */
  key: string;
  label: string;
  /** What the search runs for this interest. */
  query: string;
  /** The resume's own words that produced it, as normalized. */
  evidence: string[];
  count: number;
}

export interface ResumeMatch {
  club: IndexClub;
  score: number;
  /** Labels of the interests that matched, strongest first. */
  interests: string[];
  reasons: MatchReason[];
}

/** Phrases resumes use that would otherwise read as a club topic. Longest first. */
const SKIP_PHRASES = [
  "social media",
  "social sciences",
  "social science",
  "customer service",
  "data entry",
  "financial aid",
  "competitive salary",
  "community college",
  "high school",
  "first year",
  "education",
  "service industry",
];

/** Words common on resumes that say nothing about which club: never a name-word interest. */
const RESUME_NOISE = new Set(
  "harvard radcliffe first second third years varsity junior senior president vice treasurer secretary founder cofounder chair captain lead leader member intern internship assistant associate analyst manager director coordinator officer volunteer fellow fellowship scholar award awards honors honor education experience skills languages interests activities leadership references summary objective university college school academy institute high present current january february march april may june july august september october november december spring summer fall winter boston cambridge massachusetts york california new city county national international american gpa expected graduation bachelor bachelors degree concentration minor relevant coursework proficient fluent native email phone linkedin github address".split(
    " ",
  ),
);

/** Words that make the capitalized word beside them part of a school's name ("Phillips Academy"). */
const INSTITUTION = new Set(["academy", "school", "university", "college", "institute", "high"]);

const MAX_WORD_INTERESTS = 8;
const DISTINCTIVE_DF = 3;

/**
 * Whether a resume's first line is the person's name: 2–4 capitalized words and no topic, in a
 * text of more than one line. A one-line list ("coding, debate, a cappella", "Rowing, Chess")
 * or a heading ("EXPERIENCE") is not a name.
 */
function isNameLine(line: string, lineCount: number): boolean {
  if (lineCount < 2 || /[\d,;:|]/.test(line)) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 4 || !words.every((w) => /^[A-Z]/.test(w))) return false;
  const norm = normalizeName(line).split(" ").filter(Boolean);
  return !norm.some((_, i) => conceptAt(norm, i));
}

/** Lines worth reading: no contact details, and not the name at the top. */
function contentLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.filter(
    (line, i) =>
      !/@|https?:|www\.|linkedin|github\.com|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/i.test(line) &&
      !(i === 0 && isNameLine(line, lines.length)),
  );
}

/**
 * Resume words the search's concepts don't list, because a typed search never needs them:
 * skills and job titles that say which topic a student's experience is in.
 */
const RESUME_TERMS: ReadonlyMap<string, string> = new Map([
  ["python", "software"],
  ["java", "software"],
  ["javascript", "software"],
  ["typescript", "software"],
  ["react", "software"],
  ["sql", "software"],
  ["full stack", "software"],
  ["equity research", "finance"],
  ["investment banking", "finance"],
  ["financial modeling", "finance"],
  ["valuation", "finance"],
]);
const CONCEPT_BY_KEY: ReadonlyMap<string, Concept> = new Map(CONCEPTS.map((c) => [c.key, c]));

function conceptAt(words: readonly string[], i: number): { concept: Concept; n: number; phrase: string } | null {
  for (let n = Math.min(4, words.length - i); n >= 1; n--) {
    const phrase = words.slice(i, i + n).join(" ");
    const forms = n === 1 ? wordVariants(phrase) : [phrase];
    for (const f of forms) {
      const resumeKey = RESUME_TERMS.get(f);
      const concept = (resumeKey ? CONCEPT_BY_KEY.get(resumeKey) : undefined) ?? CONCEPT_BY_TERM.get(f);
      if (concept) return { concept, n, phrase };
    }
  }
  return null;
}

interface Token {
  norm: string;
  /** Written with a capital letter in the resume. */
  cap: boolean;
  /** Which comma/semicolon-separated part of the line it's in: a name never spans parts. */
  part: number;
}

/** A line's words, normalized, remembering which were capitalized. */
function tokens(line: string): Token[] {
  const out: Token[] = [];
  line.split(/[,;:()|•·–—/]+/).forEach((part, k) => {
    for (const raw of part.split(/[\s&+]+/))
      for (const norm of normalizeName(raw).split(" ").filter(Boolean))
        out.push({ norm, cap: /^[A-Z]/.test(raw), part: k });
  });
  return out;
}

/** Interests in a resume's text, most mentioned first. PURE. */
export function readResumeInterests(text: string, clubs: readonly IndexClub[]): ResumeInterest[] {
  const df = nameWordDf(clubs);
  const nameDf = (w: string) => wordVariants(w).reduce((m, v) => Math.max(m, df.get(v) ?? 0), 0);
  const concepts = new Map<string, ResumeInterest>();
  const words = new Map<string, ResumeInterest>();
  const names = ` ${clubs.map((c) => c.searchNames.replace(/ \| /g, "  ")).join("  ")} `;
  for (const line of contentLines(text)) {
    const toks = tokens(line);
    const ws = toks.map((t) => t.norm);
    for (let i = 0; i < ws.length;) {
      const skip = SKIP_PHRASES.find((p) => ws.slice(i, i + p.split(" ").length).join(" ") === p);
      if (skip) {
        i += skip.split(" ").length;
        continue;
      }
      const hit = conceptAt(ws, i);
      if (hit) {
        const key = `c:${hit.concept.key}`;
        const cur = concepts.get(key) ?? {
          key,
          label: hit.concept.label,
          query: hit.concept.terms[0] ?? hit.phrase,
          evidence: [],
          count: 0,
        };
        cur.count++;
        if (!cur.evidence.includes(hit.phrase)) cur.evidence.push(hit.phrase);
        concepts.set(key, cur);
        i += hit.n;
        continue;
      }
      const t = toks[i]!;
      const w = t.norm;
      i++;
      // A club-name word counts only as a name the resume writes ("Bhangra", "Rowing"), never
      // an ordinary lowercase word ("stock pitches"), and never inside a longer proper name
      // ("Goldman Sachs", "Phillips Academy", "Boys & Girls Club") unless a club's name has
      // the same two words: an outside organization says nothing about the student's identity.
      if (!t.cap || w.length < 4 || /\d/.test(w) || RESUME_NOISE.has(w)) continue;
      const n = nameDf(w);
      if (n === 0 || n > DISTINCTIVE_DF) continue;
      const outsideName = (nb: Token | undefined, pair: string) =>
        !!nb?.cap &&
        nb.part === t.part &&
        (INSTITUTION.has(nb.norm) || !RESUME_NOISE.has(nb.norm)) &&
        !conceptAt([nb.norm], 0) &&
        !names.includes(` ${pair} `);
      const prev = toks[i - 2];
      const next = toks[i];
      const inProperName = outsideName(prev, `${prev?.norm} ${w}`) || outsideName(next, `${w} ${next?.norm}`);
      if (inProperName) continue;
      const cur = words.get(w) ?? {
        key: `w:${w}`,
        label: w[0]!.toUpperCase() + w.slice(1),
        query: w,
        evidence: [w],
        count: 0,
      };
      cur.count++;
      words.set(w, cur);
    }
  }
  const byCount = (a: ResumeInterest, b: ResumeInterest) => b.count - a.count || a.label.localeCompare(b.label);
  return [...[...concepts.values()].sort(byCount), ...[...words.values()].sort(byCount).slice(0, MAX_WORD_INTERESTS)];
}

/** Extra score for each interest a club matches beyond its first. */
const MULTI_INTEREST_BONUS = 6;
/**
 * Most one interest adds for one club. The search model's whole-query bonuses (exact name,
 * "research" = Research Association's core name) are for a typed query; here they let one
 * word outweigh a club that fits several interests.
 */
const INTEREST_CAP = 12;
/** A club named for the interest ("Bhangra", "Robotics Club") may add more. */
const NAMED_CAP = 30;
const NAMED: ReadonlySet<MatchReason["kind"]> = new Set(["name", "alias", "acronym", "initials", "related"]);
/** At most this many picks whose strongest interest is the same, so one theme can't fill the list. */
const PER_THEME = 5;
/** Topics nearly every resume mentions in passing: they count half. */
const GENERIC = new Set(["c:research", "c:mentoring"]);

/** Clubs that fit the given interests, best first. PURE. */
export function matchResume(
  clubs: readonly IndexClub[],
  interests: readonly ResumeInterest[],
  limit = 30,
  categoryName: (slug: string) => string = (s) => s,
): ResumeMatch[] {
  if (interests.length === 0) return [];
  const parsed = interests.map((i) => ({ i, q: parseQuery(i.query) }));
  const out: ResumeMatch[] = [];
  for (const club of clubs) {
    if (!boardEligible(club)) continue;
    let score = 0;
    const hits: { label: string; s: number; reasons: MatchReason[] }[] = [];
    for (const { i, q } of parsed) {
      const m = matchClub(club, q, i.query, categoryName);
      if (!m) continue;
      const s =
        Math.min(m.reasons.some((r) => NAMED.has(r.kind)) ? NAMED_CAP : INTEREST_CAP, m.weak ? m.score / 2 : m.score) *
        (1 + Math.log2(i.count)) *
        (GENERIC.has(i.key) ? 0.5 : 1);
      score += s;
      hits.push({ label: i.label, s, reasons: m.reasons });
    }
    if (hits.length === 0) continue;
    score += (hits.length - 1) * MULTI_INTEREST_BONUS;
    hits.sort((a, b) => b.s - a.s);
    out.push({ club, score, interests: hits.map((h) => h.label), reasons: hits[0]!.reasons });
  }
  out.sort((a, b) => b.score - a.score || a.club.name.localeCompare(b.club.name));
  // Spread across interests: past PER_THEME picks led by one interest, a club waits behind
  // clubs led by other interests, but only while those are at least half as strong.
  const perTheme = new Map<string, number>();
  const picked: ResumeMatch[] = [];
  const waiting: ResumeMatch[] = [];
  for (const m of out) {
    while (waiting.length && waiting[0]!.score > 2 * m.score && picked.length < limit) picked.push(waiting.shift()!);
    if (picked.length >= limit) break;
    const theme = m.interests[0]!;
    const n = perTheme.get(theme) ?? 0;
    perTheme.set(theme, n + 1);
    (n < PER_THEME ? picked : waiting).push(m);
  }
  return [...picked, ...waiting].slice(0, limit);
}
