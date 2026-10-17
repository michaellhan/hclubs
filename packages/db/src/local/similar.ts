import { normalizeName } from "@hci/core/browser";
import { clubIdentities, IDENTITY_CONCEPTS } from "./audience";
import { CONCEPTS, type Concept } from "./concepts";
import type { IndexClub } from "./types";
import { wordVariants } from "./variants";
import { clubWords } from "./words";

/**
 * "Similar clubs" (ADR 0034): a fixed, explainable score over shared categories, shared
 * descriptive words and the joining model. No tracking, no personalization. PURE.
 */

export const SIMILAR_WEIGHTS = {
  /** Per shared specific category (no subcategories: "Consulting", "Hobbies & Games"), at most two. */
  sharedLeafCategory: 3,
  /** Per shared broad category (has subcategories: "Public Service"), at most two. */
  sharedTopCategory: 1,
  /** × the Jaccard overlap of descriptive words. */
  wordOverlap: 8,
  /** Both selective (application/comp/audition/tryout) or both open. */
  sameJoinModel: 0.5,
  /**
   * A distinctive word in both names ("Queer", "Korean", "Jazz"): works for clubs with no
   * description, which otherwise only share a broad category.
   */
  sharedNameWord: 2.5,
  /** Both are about the same search topic ("Outdoors", "Finance & investing"), from names and descriptions. */
  sharedConcept: 2,
  /**
   * Extra when both are named for that topic ("Climbing Club" beside the Mountaineering and
   * Outing clubs): the topic is what each is, not a passing word (Round 11).
   */
  namedConcept: 2,
  /**
   * Both serve the same identity community ("Black & African diaspora", "South Asian"): more
   * than sharing Cultural & identity, which two different communities' groups share too.
   */
  sharedIdentity: 6,
  /** The same community, but one of the two only mentions it ("teaching Black history"). */
  mentionedIdentity: 4,
  /**
   * Taken off a club whose scope is unknown but whose name or one-liner places it at a
   * graduate school ("The Harvard Chan … Forum", "GSAS chapter"), beside a College club.
   */
  graduateNamed: 3,
  /**
   * One is a program of the other (Round 12): its name carries the other's acronym ("PBHA's
   * Chinatown ESL Program" beside PBHA) or begins with the other's whole name ("Harvard
   * Computer Society Tech for Social Good" beside the Computer Society).
   */
  program: 6,
  /** Below this a club isn't shown as similar (and one shared category alone never is). */
  minimum: 3,
} as const;

/** Words too common in club text to say two clubs are alike. */
const GENERIC = new Set(
  "student students harvard undergraduate undergraduates college university club clubs group groups community events event members member campus organization organizations program programs society association team teams annual weekly year years new also various through their our who that this with from offers offering hosting hosts provide provides providing interested interest across including help helps support supports run runs led based sport sports".split(
    " ",
  ),
);

/** Who plays ("Harvard men's club sports team for soccer"): not what two clubs share. */
const WHO_PLAYS = new Set(["mens", "womens"]);

export interface SimilarClub {
  club: IndexClub;
  score: number;
  /** "Also Consulting", "Similar description". */
  reasons: string[];
}

/** Concepts too broad to say two clubs are alike (the categories already say it). */
const BROAD_CONCEPTS = new Set([
  "culture",
  "social",
  "hobbies",
  "service",
  "mentoring",
  "research",
  "competition",
  "tech",
  // A way of being selected, read from field words ("data", "software"), not a club's topic.
  "tech-interviews",
]);
const TOPIC_CONCEPTS: readonly Concept[] = CONCEPTS.filter((c) => !BROAD_CONCEPTS.has(c.key) && !c.identity);
const IDENTITY_LABEL = new Map(IDENTITY_CONCEPTS.map((c) => [c.key, c.label]));

/**
 * The school's own names and colour: in a club's name they say where it is, never what it does
 * (Round 13: the Crimson's first similar club had been the Crimson Dance Team).
 */
const BRAND_WORDS = ["harvard", "radcliffe", "crimson"];

/** Name words that say nothing about what a club does. */
const NAME_NOISE = new Set([
  ...BRAND_WORDS,
  "pbha",
  "pbhas",
  "undergraduate",
  "undergraduates",
  "initiative",
  "collective",
  "forum",
  "network",
  "council",
  "project",
  "coalition",
  "alliance",
  "foundation",
  "institute",
  "company",
  "players",
  "women",
  // "Men's Soccer" and "Men's Rugby" share who plays, not a sport (Round 11).
  "mens",
  "womens",
  "black",
  "asian",
  "american",
  "international",
  "global",
  "national",
  // Compass words: "South Asian" and "South Slavic" share nothing (student testing, 2026-10-04).
  "north",
  "south",
  "east",
  "west",
  "northern",
  "southern",
  "eastern",
  "western",
  "central",
  "middle",
]);

/** Whether a club's text is outside where a topic's words mean the topic (`textCategories`, else its categories). */
function outsideText(k: Concept, slugs: readonly string[]): boolean {
  const home = k.textCategories ?? k.categories;
  return home.length > 0 && !home.some((x) => slugs.includes(x));
}

interface Shape {
  /** Distinctive words of the canonical name (and their variants), for "both names say". */
  nameWords: Map<string, string>;
  /** Topic concepts the name or description is about. */
  concepts: Set<string>;
  /** Of those, the topics its name says ("climbing" in Climbing Club). */
  namedConcepts: Set<string>;
  /** Identity communities its name or one-liner names (`clubIdentities` "named"), or only mentions ("loose"). */
  identities: Set<string>;
  mentions: Set<string>;
  leaf: Set<string>;
  top: Set<string>;
  words: Set<string>;
  selective: boolean | null;
  nameKey: string;
  links: string[];
}

const SELECTIVE = ["application", "comp", "audition", "tryout", "invite_only"];

/**
 * Umbrella categories with no subcategories but a hundred clubs between them (Academic &
 * Research, Technology & Engineering): sharing them says as little as sharing a broad one.
 * Two of them had made Women in Computer Science and the Crimson's Technology Board the
 * clubs most like the AI Safety Team (Round 13).
 */
const UMBRELLA_CATEGORIES: ReadonlySet<string> = new Set(["academic-stem", "technology"]);
const shapes = new WeakMap<IndexClub, Shape>();

function shape(c: IndexClub, isLeaf: (slug: string) => boolean): Shape {
  let s = shapes.get(c);
  if (!s) {
    const leaf = new Set<string>();
    const top = new Set<string>();
    for (const slug of c.categorySlugs) (isLeaf(slug) && !UMBRELLA_CATEGORIES.has(slug) ? leaf : top).add(slug);
    // Description, tags and activities — not category names, which are scored on their own.
    // Only for a club with a description: without one, its "words" are just the College
    // directory's label ("Creative and Performing Arts"), shared by dozens of unrelated
    // clubs, and "Similar description" would be false.
    const words = new Set(
      c.shortDescription?.trim()
        ? `${clubWords(c).about} ${c.searchTopics ?? ""}`
            .split(/\s+/)
            .filter((w) => w.length >= 4 && !GENERIC.has(w) && !WHO_PLAYS.has(w))
        : [],
    );
    const joins = c.joinModes;
    const canonical = c.searchNames.split(" | ")[0] ?? "";
    const nameWords = new Map<string, string>();
    for (const w of canonical.split(" "))
      if (w.length >= 4 && !GENERIC.has(w) && !NAME_NOISE.has(w)) for (const v of wordVariants(w)) nameWords.set(v, w);
    const text = ` ${canonical} ${c.shortDescription?.trim() ? clubWords(c).about : ""} `;
    // A concept whose related words count only in its categories ("asian" for K-pop at a
    // dance group) needs the category here too: "South Asian" isn't K-pop.
    // A concept whose words count in text only in some fields (`textCategories`: one camping trip
    // at a secular community isn't outdoors) reads only the name elsewhere.
    const nameOnlyText = ` ${canonical} `;
    const concepts = new Set(
      TOPIC_CONCEPTS.filter(
        (k) =>
          (!k.relatedInCategory || k.categories.some((x) => c.categorySlugs.includes(x))) &&
          k.related.some(
            (r) =>
              // Short words only as the topic's own terms ("ai", "vc"), never fragments.
              (r.length >= 4 || k.terms.includes(r)) &&
              !GENERIC.has(r) &&
              // A topic with categories reads a club's text only inside them: "policy fellowship" at
              // an AI safety group is neither politics nor faith (Round 13). Names always count.
              (outsideText(k, c.categorySlugs) ? nameOnlyText : text).includes(` ${r} `),
          ),
      ).map((k) => k.key),
    );
    const namedConcepts = new Set(
      TOPIC_CONCEPTS.filter(
        (k) =>
          concepts.has(k.key) &&
          [...k.related, ...(k.nameOnly ?? [])].some((r) => r.length >= 4 && nameOnlyText.includes(` ${r} `)),
      ).map((k) => k.key),
    );
    s = {
      nameWords,
      concepts,
      namedConcepts,
      identities: clubIdentities(c, "named"),
      mentions: clubIdentities(c, "loose"),
      leaf,
      top,
      words,
      selective: joins.length ? joins.some((m) => SELECTIVE.includes(m)) : null,
      nameKey: c.searchNames
        .split(" | ")[0]!
        .split(" ")
        .filter((w) => !GENERIC.has(w) && !["pbha", "pbhas", "radcliffe", "the"].includes(w))
        .join(" "),
      links: [c.quickLinks?.website, c.quickLinks?.instagram].filter((x): x is string => Boolean(x)),
    };
    shapes.set(c, s);
  }
  return s;
}

/**
 * Whether `child` is one of `parent`'s programs: its canonical name carries the parent's
 * acronym as a word (possessive too: "PBHA's" → "pbhas"), or begins with the parent's whole
 * canonical name of two or more words. PURE.
 */
export function programOf(child: IndexClub, parent: IndexClub): boolean {
  const name = ` ${child.searchNames.split(" | ")[0] ?? ""} `;
  const acronym = parent.acronym?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  if (acronym.length >= 3 && (name.includes(` ${acronym} `) || name.includes(` ${acronym}s `))) return true;
  const full = parent.searchNames.split(" | ")[0] ?? "";
  // "The Crimson: Business Board": a board named after its parent before a colon.
  const head = child.name.includes(":") ? coreOf(normalizeName(child.name.slice(0, child.name.indexOf(":")))) : "";
  if (head && head === coreOf(full)) return true;
  // A whole name that is more than the school's own words ("Harvard Computer Society", not
  // "Harvard Crimson": the Crimson Dance Team is not the newspaper's program; Round 13).
  return (
    full.split(" ").length >= 2 &&
    coreOf(full) !== "" &&
    !coreOf(full)
      .split(" ")
      .every((w) => BRAND_WORDS.includes(w)) &&
    name.startsWith(` ${full} `) &&
    name.trim() !== full
  );
}

/** A normalized name without "the", "Harvard" and the like ("the harvard crimson" → "crimson"). */
function coreOf(normalized: string): string {
  return normalized
    .split(" ")
    .filter((w) => w && !["the", "harvard", "radcliffe", "college", "undergraduate", "undergraduates"].includes(w))
    .join(" ");
}

/** A graduate school named in a name or one-liner (not "graduate students", which mixed groups say). */
const GRADUATE_SCHOOL =
  /\b(gsas|gse|hbs|hks|hls|hms|hsph|harvard chan|chan school|graduate school|business school|law school|medical school|kennedy school|divinity school|extension school|school of public health|school of education)\b/i;

/**
 * Scope unknown (or cross-school), but the club's own name or one-liner says it belongs to a
 * graduate school (Round 10: the Harvard Chan PHIT Student Forum). PURE.
 */
export function graduateNamed(c: Pick<IndexClub, "name" | "shortDescription" | "affiliationScope">): boolean {
  if (c.affiliationScope === "harvard_college") return false;
  if (c.affiliationScope === "graduate_school") return true;
  return GRADUATE_SCHOOL.test(`${c.name} ${c.shortDescription ?? ""}`);
}

/**
 * The clubs most like `target`, best first. Leaves out the club itself, inactive clubs,
 * graduate-school groups (unless the target is one), and look-alike duplicates (same name
 * once boilerplate is removed, or the same website/Instagram).
 */
export function similarClubs(
  target: IndexClub,
  clubs: readonly IndexClub[],
  opts: {
    limit?: number;
    /** Whether a category has no subcategories (the specific ones). */
    isLeaf: (slug: string) => boolean;
    exclude?: ReadonlySet<string>;
  },
): SimilarClub[] {
  const t = shape(target, opts.isLeaf);
  const out: SimilarClub[] = [];
  for (const c of clubs) {
    if (c.id === target.id || opts.exclude?.has(c.id)) continue;
    if (c.activityStatus === "inactive" || c.activityStatus === "defunct") continue;
    if (c.affiliationScope === "graduate_school" && target.affiliationScope !== "graduate_school") continue;
    // A house committee serves one house's residents: only like another governance body.
    if (c.orgType === "governance_body" && target.orgType !== "governance_body") continue;
    const s = shape(c, opts.isLeaf);
    if (s.nameKey === t.nameKey || s.links.some((l) => t.links.includes(l))) continue;
    const named = [...s.identities].find((x) => t.identities.has(x));
    const identity = named ?? [...s.mentions].find((x) => t.mentions.has(x));
    // Two different communities' groups share Cultural & identity and nothing else about it.
    const otherCommunity = !identity && s.mentions.size > 0 && t.mentions.size > 0;
    const shareable = (x: string) => !(otherCommunity && x === "cultural-identity");
    const leaf = [...s.leaf].filter((x) => t.leaf.has(x) && shareable(x));
    const top = [...s.top].filter((x) => t.top.has(x) && shareable(x));
    let shared = 0;
    for (const w of s.words) if (t.words.has(w)) shared++;
    const union = s.words.size + t.words.size - shared;
    const jaccard = union ? shared / union : 0;
    const nameWord = [...s.nameWords.keys()].find((w) => t.nameWords.has(w));
    const concept = TOPIC_CONCEPTS.find((k) => s.concepts.has(k.key) && t.concepts.has(k.key));
    const sharedConcepts = TOPIC_CONCEPTS.filter((k) => s.concepts.has(k.key) && t.concepts.has(k.key)).length;
    const program = programOf(c, target) ? "child" : programOf(target, c) ? "parent" : null;
    const score =
      (program ? SIMILAR_WEIGHTS.program : 0) +
      (named ? SIMILAR_WEIGHTS.sharedIdentity : identity ? SIMILAR_WEIGHTS.mentionedIdentity : 0) +
      (nameWord ? SIMILAR_WEIGHTS.sharedNameWord : 0) +
      (concept ? SIMILAR_WEIGHTS.sharedConcept : 0) +
      // A second shared topic sets two clubs apart from their category's others (persona round 8:
      // the Creative Writing Collective and the Advocate share Literature beside Writing).
      (sharedConcepts > 1 ? SIMILAR_WEIGHTS.sharedConcept / 2 : 0) +
      (concept && s.namedConcepts.has(concept.key) && t.namedConcepts.has(concept.key)
        ? SIMILAR_WEIGHTS.namedConcept
        : 0) +
      Math.min(2, leaf.length) * SIMILAR_WEIGHTS.sharedLeafCategory +
      Math.min(2, top.length) * SIMILAR_WEIGHTS.sharedTopCategory +
      jaccard * SIMILAR_WEIGHTS.wordOverlap +
      (s.selective !== null && s.selective === t.selective ? SIMILAR_WEIGHTS.sameJoinModel : 0);
    if (score < SIMILAR_WEIGHTS.minimum) continue;
    // After the minimum: a graduate group that is truly alike still shows, after College ones.
    const adjusted = graduateNamed(c) && !graduateNamed(target) ? score - SIMILAR_WEIGHTS.graduateNamed : score;
    // Something beyond one shared category: otherwise the list is just that category,
    // in arbitrary order, which "Browse the category" already offers.
    if (!program && !identity && !nameWord && !concept && jaccard < 0.05 && leaf.length < 2) continue;
    const word = nameWord ? (t.nameWords.get(nameWord) ?? nameWord) : null;
    // At most two reasons, most telling first; a topic that repeats the category is left out.
    const reasons = [
      ...(program === "child"
        ? [`A ${target.acronym ?? target.name} program`]
        : program === "parent"
          ? [`Runs this program`]
          : []),
      ...(identity ? [`Also ${IDENTITY_LABEL.get(identity) ?? identity}`] : []),
      ...(word ? [`“${word[0]!.toUpperCase()}${word.slice(1)}” in both names`] : []),
      ...leaf.slice(0, 1).map((x) => `cat:${x}`),
      ...(leaf.length ? [] : top.slice(0, 1).map((x) => `cat:${x}`)),
      ...(concept && !word && !leaf.length ? [`Also ${concept.label.toLowerCase()}`] : []),
      ...(jaccard >= 0.12 ? ["Similar description"] : []),
      ...(s.selective === false && t.selective === false ? ["Also open to join"] : []),
    ].slice(0, 2);
    out.push({ club: c, score: adjusted, reasons });
  }
  out.sort(
    (a, b) => b.score - a.score || b.club.completeness - a.club.completeness || a.club.name.localeCompare(b.club.name),
  );
  // Variety: one club per family of look-alike names ("Model Congress Europe/Asia/…"),
  // so near-copies don't crowd out other alternatives.
  const picked: SimilarClub[] = [];
  const families = new Set<string>();
  for (const s of out) {
    const family = shape(s.club, opts.isLeaf).nameKey.split(" ").slice(0, 2).join(" ");
    if (family && families.has(family)) continue;
    families.add(family);
    picked.push(s);
    if (picked.length >= (opts.limit ?? 5)) break;
  }
  return picked;
}
