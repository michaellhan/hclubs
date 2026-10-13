import { normalizeName } from "@hci/core/browser";
import { clubAudience, clubAudiences, namesAudience, queryAudiences, type Audience } from "./audience";
import { boardEligible } from "./board";
import { CONCEPT_BY_TERM, CONCEPTS, type Concept } from "./concepts";
import type { MatchReason } from "./basics";
import { matchClub, nameWordDf, parseQuery } from "./search";
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
  // "Running a lab": a verb on a resume far more often than the sport.
  "running",
  // A workplace's or team's culture is not the student's (student testing round 4).
  "company culture",
  "corporate culture",
  "workplace culture",
  "team culture",
  "lab culture",
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
  // Round 13: running a paper is how a resume says journalism ("Editor-in-chief, school
  // newspaper" had found one mention, below a debate team's name).
  ["editor", "journalism"],
  ["editors", "journalism"],
  ["editor in chief", "journalism"],
  ["managing editor", "journalism"],
  ["copy editor", "journalism"],
  ["yearbook", "journalism"],
  ["literary magazine", "journalism"],
  // Clinical experience is how a pre-med resume says it (Round 10: hospital volunteering
  // had found no health interest).
  ["hospital", "premed"],
  ["hospitals", "premed"],
  ["patient", "premed"],
  ["patients", "premed"],
  ["clinic", "premed"],
  ["clinics", "premed"],
  ["clinical", "premed"],
  ["emt", "premed"],
  ["medical scribe", "premed"],
  ["shadowing", "premed"],
  // Lab techniques: "cell culture" is biology, never Cultural & identity, and "stem cells"
  // never STEM (student testing round 4, a pre-med resume).
  ["cell culture", "biology"],
  ["cell cultures", "biology"],
  ["tissue culture", "biology"],
  ["tissue cultures", "biology"],
  ["bacterial culture", "biology"],
  ["bacterial cultures", "biology"],
  ["cultured cells", "biology"],
  ["culturing", "biology"],
  ["cell line", "biology"],
  ["cell lines", "biology"],
  ["stem cell", "biology"],
  ["stem cells", "biology"],
]);

/**
 * Words a resume uses for an activity whose clubs are named for it another way: a role, a
 * past-tense verb or a credential → the club-name word for the activity. Each becomes its own
 * interest, so the named clubs lead ("tutored" → the Tutoring programs; "EMT" → CrimsonEMS,
 * whose name word ends in "ems"). The name word must exist in the index to count.
 */
const ACTIVITY_NAME_WORDS = new Map<string, { word: string; label: string }>();
for (const [word, label, forms] of [
  ["tutoring", "Tutoring", "tutor tutors tutored tutoring"],
  ["ems", "EMS", "emt emts paramedic paramedics"],
  ["rowing", "Rowing", "rower rowers rowed"],
  ["climbing", "Climbing", "climber climbers"],
  ["sailing", "Sailing", "sailor sailors sailed"],
  ["fencing", "Fencing", "fencer fencers"],
  ["swimming", "Swimming", "swimmer swimmers"],
] as const)
  for (const f of forms.split(" ")) ACTIVITY_NAME_WORDS.set(f, { word, label });

/**
 * Sports: a resume names them in lowercase ("club tennis", "intramural soccer"), and a sport
 * often names more clubs than a rare name word may (men's, women's, table tennis). Each that a
 * club's name holds is its own interest; one no club is named for counts as Sports. Ambiguous
 * words ("track", "crew", "ultimate", "running") are left out.
 */
const SPORTS = new Set(
  "tennis soccer rowing climbing bouldering squash fencing swimming diving volleyball basketball baseball softball lacrosse rugby hockey golf skiing sailing cycling triathlon badminton frisbee wrestling boxing judo karate taekwondo kendo archery polo skating gymnastics cheerleading football".split(
    " ",
  ),
);
/** Most clubs a sport may name and still be its own interest. */
const SPORT_DF = 6;
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
  const addWord = (w: string, label = w[0]!.toUpperCase() + w.slice(1)) => {
    const cur = words.get(w) ?? { key: `w:${w}`, label, query: w, evidence: [w], count: 0 };
    cur.count++;
    words.set(w, cur);
  };
  const addConcept = (concept: Concept, phrase: string) => {
    const key = `c:${concept.key}`;
    const cur = concepts.get(key) ?? {
      key,
      label: concept.label,
      query: concept.terms[0] ?? phrase,
      evidence: [],
      count: 0,
    };
    cur.count++;
    if (!cur.evidence.includes(phrase)) cur.evidence.push(phrase);
    concepts.set(key, cur);
    return cur;
  };
  const sports = CONCEPT_BY_KEY.get("sports");
  /** A multi-word phrase as a club's name writes it ("stem cells" → "stem cell"), or null. */
  const namedPhrase = (p: string) =>
    [p, p.replace(/s$/, "")].find((f) => f.includes(" ") && names.includes(` ${f} `)) ?? null;
  /**
   * The club-name word for an activity: the word itself, else the one name word that holds it
   * at its start or end with at least 3 more letters ("ems" → "crimsonems"), else null.
   */
  let vocab: Set<string> | null = null;
  const activityNameWord = (word: string) => {
    vocab ??= new Set(names.split(/\s+/).filter(Boolean));
    if (vocab.has(word)) return word;
    const compound = [...vocab].filter((v) => v.length >= word.length + 3 && (v.endsWith(word) || v.startsWith(word)));
    return compound.length === 1 ? compound[0]! : null;
  };
  for (const line of contentLines(text)) {
    const toks = tokens(line);
    const ws = toks.map((t) => t.norm);
    for (let i = 0; i < ws.length;) {
      const activity = ACTIVITY_NAME_WORDS.get(ws[i]!);
      const activityWord = activity ? activityNameWord(activity.word) : null;
      if (activity && activityWord) addWord(activityWord, activity.label);
      const skip = SKIP_PHRASES.find((p) => ws.slice(i, i + p.split(" ").length).join(" ") === p);
      if (skip) {
        i += skip.split(" ").length;
        continue;
      }
      const hit = conceptAt(ws, i);
      if (hit) {
        const cur = addConcept(hit.concept, hit.phrase);
        i += hit.n;
        // A topic word that also names a few clubs ("piano" → Piano Society, "violin"), or a
        // lab phrase that names one ("stem cells" → Stem Cell Society): its own interest too,
        // so the named club leads the topic's generic ones.
        const named = hit.n === 1 ? hit.phrase : namedPhrase(hit.phrase);
        const n = !named
          ? 0
          : hit.n === 1
            ? nameDf(named)
            : clubs.filter((c) => ` ${c.searchNames} `.includes(` ${named} `)).length;
        const most = SPORTS.has(hit.phrase) ? SPORT_DF : DISTINCTIVE_DF;
        if (named && n > 0 && n <= most && named !== cur.query && !RESUME_NOISE.has(named)) addWord(named);
        continue;
      }
      const t = toks[i]!;
      const w = t.norm;
      i++;
      if (SPORTS.has(w) || (w.endsWith("s") && SPORTS.has(w.slice(0, -1)))) {
        const n = nameDf(w);
        if (n > 0 && n <= SPORT_DF) addWord(w);
        else if (n === 0 && sports) addConcept(sports, w);
        continue;
      }
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
      addWord(w);
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
/** Whether a reason is the word itself in the club's name or text (any ending: "tutors"). */
function saysWord(r: MatchReason, word: string): boolean {
  if (NAMED.has(r.kind) && r.kind !== "related") return true;
  if (r.kind !== "description" && r.kind !== "topics") return false;
  const stem = word.slice(0, Math.max(4, word.length - 3));
  return r.word.split(" ").some((w) => w.startsWith(stem));
}

/**
 * The resume names a kind of organization (`Concept.kinds`: "newspaper") and the club's
 * one-liner says it is one ("Student newspaper publishing every weekday"): the same thing the
 * student did, ahead of the topic's other clubs (Round 13: the Crimson and the Independent for
 * "Editor-in-chief, school newspaper").
 */
const KIND_BONUS = 6;
function kindNamed(i: ResumeInterest, reasons: readonly MatchReason[]): boolean {
  const kinds = i.key.startsWith("c:") ? CONCEPT_BY_KEY.get(i.key.slice(2))?.kinds : undefined;
  if (!kinds?.some((k) => i.evidence.some((e) => ` ${k} `.includes(` ${e} `) || ` ${e} `.includes(` ${k} `))))
    return false;
  return reasons.some((r) => r.kind === "description" && kinds.includes(r.word));
}

/** At most this many picks whose strongest interest is the same, so one theme can't fill the list. */
const PER_THEME = 5;
/** Topics nearly every resume mentions in passing: they count half. */
const GENERIC = new Set(["c:research", "c:mentoring"]);

/**
 * A club for a community or faith the resume never names (ApiChorus, a Jewish a cappella group,
 * for a resume of orchestras and choirs) is multiplied by this: after general clubs, as the
 * directory orders audience clubs on a topic (Round 12).
 */
const AUDIENCE_FACTOR = 0.6;
/** A likely-graduate group's score is multiplied by this: below undergraduate picks, not gone. */
const GRADUATE_FACTOR = 0.4;
/** Name words for members past college ("Minority Biomedical Scientists of Harvard"). */
const GRADUATE_MEMBERS = /\b(scientists|researchers|physicians|doctors|postdocs?|residents|professionals|faculty)\b/;
/** One-liner phrases for graduate members; "undergraduate" never matches \bgraduate. */
const GRADUATE_TEXT = /\b(ph\.? ?d|postdoc\w*|graduate (students?|and professional)|doctoral)\b/i;
const UNDERGRAD_TEXT = /\b(undergrad\w*|college students?|first[- ]years?|freshm[ae]n)\b/i;

/**
 * A group whose scope isn't the College and whose name or one-liner points at graduate members
 * (scientists, PhD students, postdocs) and never at undergraduates. Resumes on /match are an
 * undergraduate's, so such a group ranks below the College's own. PURE.
 */
export function likelyGraduate(club: IndexClub): boolean {
  if (club.affiliationScope === "harvard_college") return false;
  if (club.affiliationScope === "graduate_school") return true;
  const desc = club.shortDescription ?? "";
  if (UNDERGRAD_TEXT.test(`${club.name} ${desc}`)) return false;
  return GRADUATE_MEMBERS.test(normalizeName(club.name)) || GRADUATE_TEXT.test(desc);
}

// Who a club is for lives in audience.ts (search orders by it too).
export { clubAudience, resumeAudiences, type Audience } from "./audience";

/**
 * Clubs that fit the given interests, best first. A club for women or for men is left out
 * unless the resume places the student in that audience (`audiences`): a CS interest never
 * suggests Women in Computer Science to a resume that doesn't say so. PURE.
 */
export function matchResume(
  clubs: readonly IndexClub[],
  interests: readonly ResumeInterest[],
  limit = 30,
  categoryName: (slug: string) => string = (s) => s,
  audiences: ReadonlySet<Audience> = new Set(),
): ResumeMatch[] {
  if (interests.length === 0) return [];
  // Gendered clubs are already left out unless the resume says so; no audience reordering here.
  const parsed = interests.map((i) => ({ i, q: { ...parseQuery(i.query), audiences: null } }));
  // Communities and faiths the resume's interests name ("Hillel" → Jewish): their clubs aren't demoted.
  const named = queryAudiences(normalizeName(interests.flatMap((i) => [i.query, ...i.evidence]).join(" ")));
  const out: ResumeMatch[] = [];
  for (const club of clubs) {
    if (!boardEligible(club)) continue;
    const audience = clubAudience(club);
    if (audience && !audiences.has(audience)) continue;
    let score = 0;
    const hits: { label: string; s: number; reasons: MatchReason[] }[] = [];
    for (const { i, q } of parsed) {
      const m = matchClub(club, q, i.query, categoryName);
      if (!m) continue;
      // A word interest stands for the word itself: the topic it belongs to is already its
      // concept interest, so "tutoring" must not count again at every public-service club.
      if (i.key.startsWith("w:") && !m.reasons.some((r) => saysWord(r, i.query))) continue;
      const s =
        Math.min(m.reasons.some((r) => NAMED.has(r.kind)) ? NAMED_CAP : INTEREST_CAP, m.weak ? m.score / 2 : m.score) *
        (1 + Math.log2(i.count)) *
        (GENERIC.has(i.key) ? 0.5 : 1);
      // A club the search orders after every real match (a conference run for high schoolers
      // under "debate"; Round 13) isn't a pick for that interest.
      if (s <= 0) continue;
      score += s + (kindNamed(i, m.reasons) ? KIND_BONUS : 0);
      hits.push({ label: i.label, s, reasons: m.reasons });
    }
    if (hits.length === 0) continue;
    score += (hits.length - 1) * MULTI_INTEREST_BONUS;
    if (likelyGraduate(club)) score *= GRADUATE_FACTOR;
    const others = [...clubAudiences(club)].filter((a) => a !== "women" && a !== "men");
    if (others.length && !others.some((a) => namesAudience(named, a))) score *= AUDIENCE_FACTOR;
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
  const list = [...picked, ...waiting].slice(0, limit);
  // Every interest the page shows as a chip gets its best club in the list ("club tennis" on a
  // pre-med resume still suggests the Tennis club): each missing one replaces the weakest
  // pick that isn't the only club for its own interest.
  for (const { label } of interests) {
    if (list.length < limit || list.some((p) => p.interests.includes(label))) continue;
    const best = out.find((m) => m.interests[0] === label && !list.includes(m));
    if (!best) continue;
    const covered = (p: ResumeMatch) => p.interests.every((l) => list.some((o) => o !== p && o.interests.includes(l)));
    const k = list.findLastIndex(covered);
    if (k >= Math.floor(limit / 2)) list.splice(k, 1, best);
  }
  return list;
}
