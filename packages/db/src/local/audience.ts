import { normalizeName } from "@hci/core/browser";
import { CONCEPTS, type Concept } from "./concepts";
import type { IndexClub } from "./types";

/**
 * Who a club is for, from its own name and one-liner: women or men, an identity community
 * (an `identity` concept: Black, South Asian, Jewish…) or a faith. Search orders such a club
 * after general clubs on a topic that doesn't name its audience ("coding": the Computer
 * Society before Women in Computer Science), "similar clubs" match identities, and /match
 * leaves gendered clubs out unless the resume says so. PURE.
 */

export type Audience = "women" | "men";

/** /match (`clubAudience`): unchanged since ADR 0047, voice-part groups included. */
const WOMEN_NAME = /\b(wom[ae]n|womens|girls?|female|ladies|sisters|sorority)\b/;
// Search also reads "Latina" before another word as women, in English order ("Latina
// Empowerment", "Latinas Unidas"); after a Spanish noun it only agrees with it ("Fuerza Latina").
const SEARCH_WOMEN_NAME = /\b(wom[ae]n|womens|womxn|girls?|female|ladies|sisters|sorority)\b|\blatinas?(?= \w)/;
/**
 * A gender word naming a singing group's voice parts, not who may join a club ("Male a
 * cappella group", "men's glee club", "treble choir"): normal for singing groups.
 */
const VOICE_PART =
  /\b(all[- ])?(male|female|men'?s|mens|women'?s|womens|men|women|treble|tenor|bass|upper[- ]voice|lower[- ]voice)(?: s)?\s+(a cappella|glee|choir|chorus|chorale|choral|singers|vocal|ensemble)\b/gi;
/** Women in a query: any of these words, "latina" too. */
const WOMEN_QUERY = /\b(wom[ae]n|womens|womxn|girls?|female|ladies|sisters|sorority|latinas?)\b/;
const MEN_NAME = /\b(men|mens|gentlemen|brothers|fraternity)\b/;
const WOMEN_DESC =
  /\b(all[- ]wom[ae]n'?s?|all[- ]female|for (?:\w+ )?wom[ae]n|undergraduate women|women in \w+|female a cappella|targeted at women)\b/i;
const MEN_DESC = /\b(all[- ]male|male a cappella|for (?:\w+ )?men)\b/i;

/**
 * Who a club is for, when its name or own one-liner says it's for women or for men
 * ("Women in Computer Science", "Men's Soccer Club", "All-male final club"). Null for
 * everyone else, and for a name or description that speaks to both. PURE.
 */
export function clubAudience(club: Pick<IndexClub, "name" | "shortDescription">): Audience | null {
  const name = normalizeName(club.name);
  const desc = club.shortDescription ?? "";
  if (/gender[- ](neutral|inclusive)|all genders/i.test(desc)) return null;
  const women = WOMEN_NAME.test(name) || WOMEN_DESC.test(desc);
  const men = MEN_NAME.test(name) || MEN_DESC.test(desc);
  return women === men ? null : women ? "women" : "men";
}

/**
 * Women or men as search reads it: like `clubAudience`, but a voice part ("male a cappella",
 * "women's chorus") is not an audience, and "Latina Empowerment" is. PURE.
 */
function searchGender(club: Pick<IndexClub, "name" | "shortDescription">): Audience | null {
  const name = normalizeName(club.name).replace(VOICE_PART, " ");
  const desc = (club.shortDescription ?? "").replace(VOICE_PART, " ");
  if (/gender[- ](neutral|inclusive)|all genders/i.test(desc)) return null;
  const women = SEARCH_WOMEN_NAME.test(name) || WOMEN_DESC.test(desc);
  const men = MEN_NAME.test(name) || MEN_DESC.test(desc);
  return women === men ? null : women ? "women" : "men";
}

/**
 * Audiences the resume itself places the student in: a women's or men's team or group
 * ("Women's Varsity Soccer", "Society of Women Engineers"), a sorority or fraternity, or
 * stated pronouns. A resume that says neither gets no gendered clubs. PURE.
 */
export function resumeAudiences(text: string): Set<Audience> {
  const out = new Set<Audience>();
  if (/\b(wom[ae]n'?s?|girls?|female|ladies|sorority|sisterhood|she ?\/ ?her)\b/i.test(text)) out.add("women");
  if (/\b(men'?s?|gentlemen|fraternity|brotherhood|he ?\/ ?him)\b/i.test(text)) out.add("men");
  return out;
}

export const IDENTITY_CONCEPTS: readonly Concept[] = CONCEPTS.filter((c) => c.identity);

/** Faiths a club can be for (beside the Jewish and Muslim identity concepts). */
const FAITHS = [
  "christian",
  "christians",
  "catholic",
  "catholics",
  "protestant",
  "evangelical",
  "orthodox",
  "hindu",
  "hindus",
  "sikh",
  "sikhs",
  "buddhist",
  "buddhists",
  "mormon",
  "latter day saints",
];

/** Places, not people: a "China Forum" is about China, not for Chinese students. */
const PLACES = new Set([
  "china",
  "korea",
  "japan",
  "taiwan",
  "hong kong",
  "east asia",
  "africa",
  "south asia",
  "india",
  "pakistan",
  "bangladesh",
  "nepal",
  "iran",
  "persia",
  "mexico",
  "israel",
]);

/** Words beside an identity word in a one-liner that make it who the club is for ("Black undergraduates"). */
const PEOPLE =
  /^(students?|undergraduates?|undergrads?|people|community|communities|women|womxn|men|members|heritage|culture|cultural|identity|identifying|affinity|americans?|diaspora|group|choir|chorus|ensemble|troupe|fellowship|youth|life|a cappella group)$/;

/**
 * Identity words a club's name or text may use: its people ("pakistani") for who a club is
 * for, or (`loose`, similar clubs) any of the concept's words, art forms too ("bhangra").
 */
function identityWords(c: Concept, loose: boolean): string[] {
  const words = new Set(loose ? [...c.terms, ...(c.forms ?? []), ...c.related] : (c.people ?? []));
  for (const w of c.nameOnly ?? []) words.delete(w);
  return [...words].filter((w) => !PLACES.has(w) && (w.includes(" ") || w.length >= 3));
}
const PEOPLE_WORDS = new Map(IDENTITY_CONCEPTS.map((c) => [c, identityWords(c, false)]));
const ALL_WORDS = new Map(IDENTITY_CONCEPTS.map((c) => [c, identityWords(c, true)]));

/** Text without a concept's other-sense and not-this-sense phrases (" black tie " → " "). */
function senseText(text: string, c: Concept): string {
  let out = text;
  for (const x of c.notSense ?? []) out = out.split(` ${x} `).join("  ");
  return out;
}

/** Whether one of the concept's identity words is in `text` (space-padded), in the intended sense. */
function says(
  text: string,
  c: Concept,
  near: ((at: number, w: string) => boolean) | null,
  words: ReadonlyMap<Concept, string[]>,
): boolean {
  const t = senseText(text, c);
  const otherSense = (c.otherSense ?? []).some((x) => t.includes(` ${x} `));
  for (const w of words.get(c) ?? []) {
    if (otherSense && c.senseTerms?.includes(w)) continue;
    let at = t.indexOf(` ${w} `);
    while (at >= 0) {
      if (!near || near(at, w)) return true;
      at = t.indexOf(` ${w} `, at + 1);
    }
  }
  return false;
}

/**
 * The identity concepts a club is for. "strict" (search): its name names the people, or its
 * one-liner puts them beside people words ("for Black undergraduates", "Jewish a cappella
 * group"). "named": also any of the concept's words in its name, art forms included
 * ("Bhangra"). "loose": any of its words in its name or one-liner ("teaching Black history"). PURE.
 */
export function clubIdentities(
  club: Pick<IndexClub, "name" | "shortDescription">,
  mode: "strict" | "named" | "loose",
): Set<string> {
  const name = ` ${normalizeName(club.name)} `;
  const desc = ` ${normalizeName(club.shortDescription ?? "")} `;
  const out = new Set<string>();
  const besidePeople = (at: number, w: string) => {
    const before = desc.slice(0, at).trim().split(" ").slice(-2);
    const after = desc
      .slice(at + w.length + 2)
      .trim()
      .split(" ");
    const next = [after.slice(0, 1).join(" "), after.slice(0, 3).join(" "), after.slice(1, 2).join(" ")];
    return next.some((x) => PEOPLE.test(x)) || before.some((x) => /^(for|of|among)$/.test(x));
  };
  for (const c of IDENTITY_CONCEPTS) {
    const inName = says(name, c, null, mode === "strict" ? PEOPLE_WORDS : ALL_WORDS);
    const inDesc = mode === "loose" ? says(desc, c, null, ALL_WORDS) : says(desc, c, besidePeople, PEOPLE_WORDS);
    if (inName || inDesc) out.add(c.key);
  }
  return out;
}

const audienceCache = new WeakMap<object, Set<string>>();

/**
 * Every audience a club's name or one-liner marks: "women"/"men", `id:<identity concept>`,
 * `faith:<word>`. Empty for a club open to everyone. Cached per club object. PURE.
 */
export function clubAudiences(club: Pick<IndexClub, "name" | "shortDescription">): Set<string> {
  let out = audienceCache.get(club);
  if (!out) {
    out = new Set<string>();
    const g = searchGender(club);
    if (g) out.add(g);
    for (const k of clubIdentities(club, "strict")) out.add(`id:${k}`);
    const text = ` ${normalizeName(club.name)} ${normalizeName(club.shortDescription ?? "")} `;
    for (const f of FAITHS) if (text.includes(` ${f} `)) out.add(`faith:${f.replace(/s$/, "")}`);
    audienceCache.set(club, out);
  }
  return out;
}

/**
 * The audiences a query names: gender words ("women", "latina"), an identity word in any of
 * its forms ("black", "desi", "asian" in "asian american"), a faith. PURE.
 */
export function queryAudiences(norm: string): Set<string> {
  const out = new Set<string>();
  const t = ` ${norm} `;
  if (WOMEN_QUERY.test(norm)) out.add("women");
  if (MEN_NAME.test(norm)) out.add("men");
  const typed = new Set(norm.split(" ").filter((w) => w.length >= 4 && !GENERIC_QUERY.has(w)));
  for (const c of IDENTITY_CONCEPTS) {
    const all = [...c.terms, ...(c.forms ?? []), ...c.related, ...(c.nameOnly ?? [])];
    // A word of a multi-word identity ("asian" of "south asian") names it too.
    if (all.some((w) => t.includes(` ${w} `) || w.split(" ").some((x) => typed.has(x)))) out.add(`id:${c.key}`);
  }
  for (const f of FAITHS) if (t.includes(` ${f} `)) out.add(`faith:${f.replace(/s$/, "")}`);
  return out;
}

/** Audience wildcards a query can name (`conceptAudiences`). */
export const ANY_FAITH = "faith:*";
export const ANY_IDENTITY = "id:*";

/** Whether a query's audiences name a club's audience, directly or by wildcard. PURE. */
export function namesAudience(named: ReadonlySet<string>, a: string): boolean {
  return (
    named.has(a) ||
    (a.startsWith("faith:") && named.has(ANY_FAITH)) ||
    (a.startsWith("id:") && named.has(ANY_IDENTITY)) ||
    // Jewish and Muslim life are faiths too.
    ((a === "id:jewish" || a === "id:muslim") && named.has(ANY_FAITH))
  );
}

/** Query words too general to name a community ("american" is in many identities). */
const GENERIC_QUERY = new Set(["american", "americans", "south", "east", "pacific", "students", "student"]);

/**
 * Communities a topic itself is about, through its related words ("kpop": Korean, Asian):
 * a query for the topic names them, so their clubs are not ordered as audience clubs. PURE.
 */
export function conceptAudiences(c: Concept): Set<string> {
  const out = new Set<string>();
  if (c.identity) out.add(`id:${c.key}`);
  // A topic that is the audiences' own category names them all: "faith" is every faith's
  // group, "cultural" every community's.
  if (c.categories.includes("religious-spiritual")) out.add(ANY_FAITH);
  if (c.categories.includes("cultural-identity")) out.add(ANY_IDENTITY);
  const related = new Set(c.related);
  for (const k of IDENTITY_CONCEPTS)
    if ((k.people ?? []).some((w) => related.has(w) || w.split(" ").some((x) => x.length >= 4 && related.has(x))))
      out.add(`id:${k.key}`);
  return out;
}
