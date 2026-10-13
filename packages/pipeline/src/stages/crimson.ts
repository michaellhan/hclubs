import { and, eq, gt, inArray, ne } from "drizzle-orm";
import { normalizeName, blockingKey } from "@hci/core";
import { finishRun, rejectClaims, resolveClubs, restoreClaims, schema, startRun, upsertClaim, type Db } from "@hci/db";
import { crawlSite, emptyCrawlStats, type CrawlStats } from "../crawl/site";
import type { Logger } from "../logger";
import { htmlToDocument, type PageDocument } from "../parse/document";
import { identityNames } from "../sites/candidates";
import type { SearchResult } from "../sites/candidates";
import { SearchCreditError, type WebSearchProvider } from "../sites/search";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";
import { cachedSearch } from "./web-discovery";

/**
 * crimson (ADR 0026): find Harvard Crimson articles about each club and record them as
 * `club.press_mention` claims (tier 6). Candidates come from one official-search-API query
 * per club (`site:thecrimson.com "<name>"`); an article counts only when its fetched text
 * contains the club's full name. We keep the headline, date and link, never the article
 * text (§21); a mention within the last year is an activity signal (ADR 0020).
 */

// 7 (2026-10-13): sibling organizations in headlines (`siblingInHeadline`); a quote that is only the name.
export const CRIMSON_VERSION = "7";
/** Clubs per paid search query ("A" OR "B" …); keeps queries short and credit use low. */
const PAID_BATCH_SIZE = 5;

const ARTICLE = /^https?:\/\/(?:www\.)?thecrimson\.com\/article\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/[a-z0-9-]+\/?$/i;

/** Student publications we read for articles about clubs (all allow crawling; §21: link + headline only). */
export interface Publisher {
  key: string;
  name: string;
  site: string;
  sourceType: "harvard_crimson" | "harvard_related_other";
  extractorName: string;
  /** The publication's own WordPress search API base (no web-search credit needed), if any. */
  wordpressBase?: string;
  /** Article URL → normalized URL (+ date when the URL carries one), or null for non-articles. */
  article: (url: string) => { url: string; publishedOn: string | null } | null;
}

const WP_NON_ARTICLE = /^\/(category|tag|author|page|wp-|feed|about|contact|masthead|staff|subscribe|donate|search)\b/i;
const wordpressArticle = (host: RegExp) => (url: string) => {
  try {
    const u = new URL(url.split(/[?#]/)[0] ?? url);
    if (!host.test(u.hostname)) return null;
    if (!/^\/[a-z0-9-]+\/?$/i.test(u.pathname) || WP_NON_ARTICLE.test(u.pathname) || u.pathname === "/") return null;
    return { url: `https://${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/?$/, "/")}`, publishedOn: null };
  } catch {
    return null;
  }
};

export const PUBLISHERS: Publisher[] = [
  {
    key: "crimson",
    name: "The Harvard Crimson",
    site: "thecrimson.com",
    sourceType: "harvard_crimson",
    extractorName: "crimson-mentions",
    article: (url) => crimsonArticle(url),
  },
  {
    key: "independent",
    name: "The Harvard Independent",
    site: "harvardindependent.com",
    sourceType: "harvard_related_other",
    extractorName: "independent-mentions",
    wordpressBase: "https://harvardindependent.com",
    article: wordpressArticle(/^(www\.)?harvardindependent\.com$/i),
  },
  {
    key: "hpr",
    name: "Harvard Political Review",
    site: "harvardpolitics.com",
    sourceType: "harvard_related_other",
    extractorName: "hpr-mentions",
    wordpressBase: "https://theharvardpoliticalreview.com",
    article: wordpressArticle(/^(www\.)?(harvardpolitics|theharvardpoliticalreview)\.com$/i),
  },
];

/** Publication date from the page's JSON-LD (`datePublished`), as YYYY-MM-DD. PURE. */
export function jsonLdPublished(doc: PageDocument): string | null {
  const stack: unknown[] = [...doc.jsonLd];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    const rec = node as Record<string, unknown>;
    const d = rec.datePublished;
    if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
    for (const v of Object.values(rec)) if (v && typeof v === "object") stack.push(v);
  }
  return null;
}

/** A Crimson article URL and its publication date (from the URL), or null. PURE. */
export function crimsonArticle(url: string): { url: string; publishedOn: string } | null {
  const clean = url.split(/[?#]/)[0] ?? url;
  const m = ARTICLE.exec(clean);
  if (!m) return null;
  const [, y, mo, d] = m;
  const publishedOn = `${y}-${mo?.padStart(2, "0")}-${d?.padStart(2, "0")}`;
  return { url: clean.replace(/^http:/, "https:").replace(/\/?$/, "/"), publishedOn };
}

/**
 * Names specific enough to find in article text: 2+ words with something distinctive
 * left after generic words ("Harvard College" alone never counts). PURE.
 */
export function searchableNames(club: { name: string; acronym: string | null; aliases: string[] }): string[] {
  return identityNames(club).filter((n) => {
    const norm = normalizeName(n);
    return norm.split(" ").length >= 2 && blockingKey(n).length >= 4 && !/\bcrimson\b/.test(norm);
  });
}

// --- Is the article really about the club? (v3) ----------------------------------------------

/** Words that make a name generic: dropped to find the club's distinctive core. */
const CORE_NOISE =
  /\b(harvard|undergraduate|college|club|society|association|the|student|students|team|group|of|men|mens|women|womens|s)\b/g;
const CORE_NOISE_ONLY =
  /^(harvard|undergraduate|college|club|society|association|student|students|team|group|council)( |$)/;
const ORG_WORD = /\b(?:Club|Society|Association|Council|Group|Project|Fellowship|Center|Organization|Team|Union)\b/g;

export interface PressCandidate {
  title: string;
  quote: string;
  publishedOn: string;
  /** The publication that ran the article ("The Harvard Independent"), when known. */
  publisher?: string;
  /** How the stored article names the club (`articleSignals`), when its text is at hand (press-v6). */
  article?: ArticleSignals;
}

/** How an article names a club: mentions in its text, and whether its opening paragraph does. */
export interface ArticleSignals {
  mentions: number;
  inLead: boolean;
  /** The opening paragraph's text (press-v7: which of several sibling organizations it names). */
  leadText?: string;
}

/** Bylines, photo credits, captions, newsletter prompts and site chrome: not the article's opening. */
const NOT_PROSE =
  /^(?:by\b|photo|image|graphic|courtesy|\(?(?:photo|image)\b|get the crimson|recover your password|home\b|share\b|facebook)|\b(?:staff writers?|courtesy of|licensed under|contributing writer)\b/i;

/**
 * The names an article may use for the club after naming it once: its searchable names, those
 * names without a leading "Harvard"/"College"/"Undergraduate" when two words remain ("the
 * Republican Club"), and its acronym (3+ letters, same case). PURE.
 */
function articleNameForms(club: { name: string; acronym: string | null; aliases: string[] }): {
  forms: string[];
  acronym: RegExp | null;
} {
  const forms = new Set<string>();
  for (const n of searchableNames(club)) {
    const norm = normalizeName(n);
    forms.add(norm);
    const bare = norm.replace(/^(?:the )?(?:harvard |radcliffe |college |undergraduate |university )+/, "");
    if (bare.split(" ").length >= 2 && blockingKey(bare).length >= 4) forms.add(bare);
  }
  // The stated acronym, or the initials an article would use ("the PSC" for the Harvard
  // Undergraduate Palestine Solidarity Committee): counted as written, in capitals.
  const acronyms = new Set<string>();
  const a = club.acronym?.trim().replace(/[^A-Za-z0-9]/g, "");
  if (a && a.length >= 3 && /[A-Z]/.test(a)) acronyms.add(a);
  for (const n of [club.name, ...club.aliases]) {
    const words = n
      .replace(/[^A-Za-z0-9 -]+/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w && !/^(?:of|and|the|for|at|in|on|a|an)$/i.test(w));
    const bare = words.slice(words.findIndex((w) => !/^(?:harvard|radcliffe|college|undergraduate)$/i.test(w)));
    for (const ws of [words, bare]) {
      const ini = ws.map((w) => w[0]?.toUpperCase() ?? "").join("");
      if (ini.length >= 3 && ini.length <= 6) acronyms.add(ini);
    }
  }
  return {
    forms: [...forms],
    acronym: acronyms.size ? new RegExp(`\\b(?:${[...acronyms].join("|")})\\b`, "g") : null,
  };
}

/** Times `form` (normalized, word-bounded) occurs in normalized text. PURE. */
function occurrences(normText: string, form: string): number {
  let n = 0;
  for (let i = normText.indexOf(` ${form} `); i >= 0; i = normText.indexOf(` ${form} `, i + form.length + 1)) n++;
  return n;
}

/**
 * How a stored article names the club (press-v6): how many times its text does (full names,
 * the name without "Harvard", the acronym), and whether its opening paragraph (about the first
 * 300 characters of prose after the byline and photo credits) does. A club named once deep in
 * a story about something else is a passing mention. PURE.
 */
export function articleSignals(
  doc: PageDocument,
  club: { name: string; acronym: string | null; aliases: string[] },
): ArticleSignals {
  const { forms, acronym } = articleNameForms(club);
  const seen = new Set<string>();
  const prose: string[] = [];
  for (const b of doc.blocks) {
    if (b.kind === "list_item" || b.kind === "table_cell") continue;
    const t = b.text.trim();
    // A photo credit ("Courtesy of the … Club") or byline isn't the story naming the club.
    if (!t || seen.has(t) || NOT_PROSE.test(t)) continue;
    seen.add(t);
    prose.push(t);
  }
  const count = (text: string, withAcronym = true) => {
    const norm = ` ${normalizeName(text)} `;
    // Longest form first, so "Harvard Republican Club" isn't also counted as "Republican Club".
    let n = 0;
    let rest = norm;
    for (const f of [...forms].sort((a, b) => b.length - a.length)) {
      const k = occurrences(rest, f);
      if (k) {
        n += k;
        rest = rest.split(` ${f} `).join("  ");
      }
    }
    if (acronym && withAcronym) n += (text.match(acronym) ?? []).length;
    return n;
  };
  // Initials count only in an article that also spells the name out (another group may share them).
  const spelledOut = prose.some((t) => count(t, false) > 0);
  const mentions = prose.reduce((s, t) => s + count(t, spelledOut), 0);
  let lead = "";
  for (const b of doc.blocks) {
    if (lead.length >= 300) break;
    if (b.kind !== "paragraph" && b.kind !== "quote") continue;
    const t = b.text.trim();
    if (t.split(/\s+/).length < 8 || NOT_PROSE.test(t) || /@/.test(t)) continue;
    lead += ` ${t}`;
  }
  return { mentions, inLead: count(lead, spelledOut) > 0, leadText: lead.trim() };
}

/**
 * Umbrella organizations whose stories name their programs in passing (press-v6): an IOP
 * board announcement lists the Political Review and the Political Union; an HUA funding story
 * lists clubs. Their headline forms, normalized, plus the acronym as written.
 */
const PARENT_ORGS: { forms: string[]; acronym: RegExp }[] = [
  { forms: ["institute of politics"], acronym: /\bIOP(?:['’]s)?\b/ },
  { forms: ["phillips brooks house"], acronym: /\bPBHA(?:['’]s)?\b/ },
  { forms: ["harvard undergraduate association", "undergraduate association"], acronym: /\bHUA(?:['’]s)?\b/ },
  // "UC" alone also means UC Berkeley and the like: only the full name counts.
  { forms: ["undergraduate council"], acronym: /(?!)/ },
];

/** The umbrella organization a headline is about, when it isn't this club. PURE. */
function parentOrgInHeadline(club: { name: string; acronym: string | null; aliases: string[] }, title: string) {
  const own = [club.name, ...club.aliases].map((n) => ` ${normalizeName(n)} `);
  const t = ` ${normalizeName(title)} `;
  for (const p of PARENT_ORGS) {
    if (p.forms.some((f) => own.some((o) => o.includes(` ${f} `)))) continue;
    const acr = club.acronym?.trim().toUpperCase();
    if (acr && p.acronym.test(acr)) continue;
    const form = p.forms.find((f) => t.includes(` ${f} `));
    if (form) return form;
    const a = title.match(p.acronym)?.[0];
    if (a) return a.replace(/['’]s$/, "");
  }
  return null;
}

/** Articles before this year are about the club's 19th- or 20th-century namesake, not today's group. */
const OLDEST_PRESS_YEAR = 1990;

/**
 * One-word name cores that can only mean that club (press-v4): coined or foreign words, not
 * ordinary English words, common given names or places, nor another organization's name
 * ("Porcellian", "Hillel", "Krokodiloes"). Editor-reviewed and kept short on purpose: ordinary
 * words stay out even when the club capitalizes them (Advocate, Lampoon, Salient, Signet,
 * Delphic, Fly, Fox, Owl, Callbacks), as do publishers (Crimson, Independent) and words
 * another organization also uses (Kesem, Nucleate, Scientista, Ghungroo, the SASA show).
 */
export const DISTINCTIVE_NAME_WORDS: ReadonlySet<string> = new Set([
  "citystep",
  "datamatch",
  "exister",
  "hillel",
  "jewskies",
  "krokodiloes",
  "lowkeys",
  "mishelanu",
  "noteables",
  "opportunes",
  "pleiades",
  "porcellian",
  "satirev",
  "spee",
  "yarid",
]);

/** Context for `pressMentionProblem` from the whole club list. */
export interface PressContext {
  /** Name words used by more than one club (a shared word never identifies one club). */
  sharedNameWords?: ReadonlySet<string>;
  /** Every active club's name without "Harvard"/"College"/"Undergraduate"/"The" (two words or more). */
  otherClubNames?: readonly string[];
}

/** Name words that never tell clubs apart in a headline. */
const HEADLINE_NOISE = /\b(?:harvard|harvards|radcliffe|college|undergraduate|the|s)\b/g;

/** A club's name as a headline would write it: normalized, without "Harvard" and the like. PURE. */
export function headlineName(name: string): string {
  return normalizeName(name).replace(HEADLINE_NOISE, " ").replace(/\s+/g, " ").trim();
}

/**
 * Another club's name in the headline, when none of this club's names is: two or more words
 * and not part of (or containing) one of this club's names ("Glee Club" in "Glee Club Lite"
 * stays ambiguous, so it counts as this club). PURE.
 */
function otherClubInHeadline(
  club: { name: string; acronym: string | null; aliases: string[] },
  title: string,
  others: readonly string[] | undefined,
): string | null {
  if (!others?.length) return null;
  const own = [club.name, ...club.aliases].map(headlineName).filter(Boolean);
  const t = ` ${headlineName(title)} `;
  const raw = ` ${normalizeName(title)} `;
  for (const o of others) {
    // A one-word name ("Salient") counts only written as "Harvard <name>" ("… Shut Down The
    // Harvard Salient"; press-v6): alone it is an ordinary word.
    const hit = o.split(" ").length >= 2 ? t.includes(` ${o} `) : raw.includes(` harvard ${o} `);
    if (!hit) continue;
    if (own.some((n) => n.includes(o) || o.includes(n))) continue;
    return o;
  }
  return null;
}

/**
 * How a headline relates to sibling organizations: other clubs whose names begin with the same
 * two or more words as this club's ("Hasty Pudding" Theatricals, Club and Institute of 1770;
 * press-v7, a club president's check, 2026-10-13).
 *  - `sibling`: the headline names a sibling ("Hasty Pudding Club Finds New Home", "Pudding
 *    Institute Will Relocate…", "Hasty Pudding Clubs To Merge") and not this club: its story.
 *  - `ambiguous`: it names only the shared words ("Epstein Gave … to Hasty Pudding"), which fit
 *    every sibling; `forms` are the siblings' telling phrases ("pudding club").
 * Null when the headline names this club in full, or shares no words with a sibling. PURE.
 */
export function siblingInHeadline(
  club: { name: string; aliases: string[] },
  title: string,
  others: readonly string[] | undefined,
): { kind: "sibling"; name: string } | { kind: "ambiguous"; forms: RegExp[] } | null {
  if (!others?.length) return null;
  const own = [club.name, ...club.aliases].map(headlineName).filter((n) => n.split(" ").length >= 2);
  const t = ` ${headlineName(title)} `;
  if (own.some((n) => t.includes(` ${n} `))) return null;
  const forms: RegExp[] = [];
  for (const o of others) {
    if (own.includes(o)) continue;
    const ow = o.split(" ");
    for (const n of own) {
      const nw = n.split(" ");
      let k = 0;
      while (k < nw.length && k < ow.length && nw[k] === ow[k]) k++;
      if (k < 2 || k >= nw.length || k >= ow.length) continue;
      const last = nw[k - 1] as string;
      // The word as the name has it: "Hasty Pudding Clubs To Merge" names several, not the Club.
      const theirs = new RegExp(` ${last} ${ow[k]} `);
      const ours = new RegExp(` ${last} ${nw[k]} `);
      if (theirs.test(t) && !ours.test(t)) return { kind: "sibling", name: o };
      if (t.includes(` ${nw.slice(0, k).join(" ")} `)) forms.push(theirs);
    }
  }
  return forms.length ? { kind: "ambiguous", forms } : null;
}

/** Name words used by more than one club (names and aliases, normalized). PURE. */
export function sharedNameWords(clubs: { id: string; name: string; aliases: string[] }[]): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const c of clubs)
    for (const n of [c.name, ...c.aliases])
      for (const w of normalizeName(n).split(" ").filter(Boolean)) {
        const set = owners.get(w) ?? new Set<string>();
        set.add(c.id);
        owners.set(w, set);
      }
  return new Set([...owners].filter(([, ids]) => ids.size > 1).map(([w]) => w));
}

/**
 * The club's distinctive one-word core when the quote writes it as a proper noun
 * (capitalized), else null. PURE.
 */
function distinctiveWordInQuote(
  matched: string[],
  quote: string,
  shared: ReadonlySet<string> | undefined,
): string | null {
  const capitalized = new Set(
    quote
      .split(/[^\p{L}\p{N}'’]+/u)
      .filter((t) => /^\p{Lu}/u.test(t))
      .map((t) => normalizeName(t)),
  );
  for (const n of matched) {
    const core = nameCore(n);
    if (core.includes(" ") || !DISTINCTIVE_NAME_WORDS.has(core) || shared?.has(core)) continue;
    if (capitalized.has(core)) return core;
  }
  return null;
}

/** Is the article the club's own publication writing about itself? PURE. */
function ownPublication(club: { name: string; aliases: string[] }, publisher: string | undefined): boolean {
  if (!publisher) return false;
  const pub = normalizeName(publisher);
  return [club.name, ...club.aliases].some((n) => normalizeName(n) === pub);
}

/** A trailing generic noun ("Kuumba Singers", "Hasty Pudding Theatricals") a headline drops. */
const GENERIC_TAIL =
  /\s(singers|theatricals|society|council|committee|program|programs|association|company|ensemble|project|union|chorus|orchestra|band|players|institute)$/;

/** The club name without generic words ("Harvard Undergraduate Poker Club" → "poker"). PURE. */
function nameCore(name: string): string {
  return normalizeName(name).replace(CORE_NOISE, " ").replace(/\s+/g, " ").trim();
}

/**
 * Why a stored article mention is too weak to show as "In the news", or null. A passing
 * mention (a list of clubs, an old roster, a funding line, a program named without
 * "Harvard") says little about the club, so unless the headline names it:
 *  - nothing before 2010;
 *  - not as one of many organizations in a list;
 *  - a one- or two-word name needs the "Harvard <name>" form near the start of the sentence.
 * Names of three or more words (the full "Harvard Undergraduate Poker Club") are specific
 * enough to stand, and so is a name whose core is one distinctive word written as a proper
 * noun ("the Porcellian Club", "Harvard Hillel"; press-v4, `DISTINCTIVE_NAME_WORDS`). A
 * publication's own articles are never press about itself. PURE.
 */
export function pressMentionProblem(
  club: { name: string; acronym: string | null; aliases: string[] },
  m: PressCandidate,
  ctx: PressContext = {},
): string | null {
  if (ownPublication(club, m.publisher)) return "the club's own publication";
  // An 1888 Crimson story about the fencing team is about its 19th-century namesake (press-v6).
  if (Number(m.publishedOn.slice(0, 4)) < OLDEST_PRESS_YEAR) return `article from before ${OLDEST_PRESS_YEAR}`;
  const names = searchableNames(club);
  const padded = (t: string) => ` ${normalizeName(t)} `;
  const title = padded(m.title);
  // A headline names the club by any of its forms: full name, an alias ("Kuumba"), a rival
  // spelling ("Harvard Rugby Club" for the men's team), or the name minus generic words.
  const headlineForms = [...names, ...identityNames(club), club.name, ...club.aliases].flatMap((n) => {
    const core = nameCore(n);
    return [n, core, core.replace(GENERIC_TAIL, "")];
  });
  const inHeadline = headlineForms.some((f) => {
    const norm = normalizeName(f);
    if (norm.length >= 5) return !CORE_NOISE_ONLY.test(norm) && title.includes(` ${norm} `);
    // A four-letter one-word core no other club uses, capitalized in the headline ("'Pops and
    // the Island of Misfit Professors' Review" for the Pops Orchestra; press-v6).
    return (
      norm.length === 4 &&
      /^[a-z]+$/.test(norm) &&
      !CORE_NOISE_ONLY.test(norm) &&
      !ctx.sharedNameWords?.has(norm) &&
      new RegExp(`\\b${norm[0]?.toUpperCase()}${norm.slice(1)}\\b`).test(m.title)
    );
  });
  // A sibling organization's story (press-v7): "Hasty Pudding Club Finds New Home" is the Club's,
  // not the Theatricals'. A headline with only the shared words ("… to Hasty Pudding") counts
  // when the opening (or, without the article, the quoted sentence) names this club and no sibling.
  const sibling = siblingInHeadline(club, m.title, ctx.otherClubNames);
  if (sibling?.kind === "sibling") return `the headline is about a sibling organization ("${sibling.name}")`;
  if (sibling?.kind === "ambiguous" && inHeadline) {
    const opening = ` ${headlineName(m.article?.leadText ?? m.quote)} `;
    const own = [club.name, ...club.aliases].map(headlineName).filter((n) => n.split(" ").length >= 2);
    const namesUs = own.some((n) => opening.includes(` ${n} `));
    if (!namesUs || sibling.forms.some((f) => f.test(opening)))
      return "the headline's name is shared with sibling organizations, and the opening doesn't name this one alone";
    return null;
  }
  if (inHeadline) return null;
  if (Number(m.publishedOn.slice(0, 4)) < 2010) return "pre-2010 article that does not name the club in its headline";
  // A story about an umbrella organization ("The Institute of Politics Announces its 2026
  // Student Executive Board", "How the HUA Spends …") never flows to its programs or the clubs
  // it funds unless the headline names them (press-v6).
  const parent = parentOrgInHeadline(club, m.title);
  if (parent) return `the headline is about ${parent}, not this club`;
  // The headline names another club ("Harvard’s Debate Council Faces a Reckoning" on the
  // Debating Union's page; press-v5): the club is a side note in someone else's story.
  // Not when the headline or the sentence's opening names this club too ("Harvard College Live
  // Splits From College Events Board"; "Throughout October, the Harvard Institute of Politics’ …").
  const other = otherClubInHeadline(club, m.title, ctx.otherClubNames);
  const named = (t: string) =>
    [club.name, ...club.aliases].some((n) => normalizeName(n).split(" ").length >= 2 && padded(t).includes(padded(n)));
  // …or the headline uses a distinctive word of this club's name ("Resident Fellows" for Fellows and Study Groups).
  const ownWord = nameCore(club.name)
    .split(" ")
    .some((w) => w.length >= 5 && !GENERIC_TAIL.test(` ${w}`) && title.includes(` ${w} `));
  // With the article at hand, the exemption needs the club in its opening paragraph (press-v6),
  // not just at the start of the one sentence that names it.
  const opensWithClub = m.article ? m.article.inLead : named(m.quote.slice(0, 60));
  if (other && !ownWord && !named(m.title) && !opensWithClub) return `the headline is about another club ("${other}")`;
  const commas = (m.quote.match(/,/g) ?? []).length;
  if ((m.quote.match(ORG_WORD) ?? []).length >= 4 || commas >= 6)
    return "the club is one name in a list of organizations";
  // Named once, deep in a story about something else ("… co-chairs of the Harvard Votes
  // Challenge, declined to comment" in an inauguration story; a scholarship winner who "helps
  // run Harvard CIVICS"): a passing mention, whatever the name's length (press-v6).
  if (m.article && !m.article.inLead && m.article.mentions < 2)
    return "named once in passing (not in the headline or the opening paragraph)";
  const quote = padded(m.quote);
  // The quote is the club's name asked as a question ("The Hasty Pudding Theatricals?" in an essay
  // against final clubs) or a photo credit ("Courtesy of the … Club"; press-v7): nothing in it is
  // about the club. A bare name as a section heading ("Harvard College Consulting Group (HCCG)"
  // in a comp rundown) stands: the section below it is.
  const nameWords = new Set(names.flatMap((n) => normalizeName(n).split(" ")));
  const said = normalizeName(m.quote)
    .split(" ")
    .filter((w) => w.length >= 3 && !nameWords.has(w) && !/^(?:the|and|for|with|courtesy)$/.test(w));
  if (said.length < 3 && (/\?\s*$/.test(m.quote) || /\bcourtesy of\b/i.test(m.quote)))
    return "the quote is only the club's name (a question or a photo credit), not a sentence about it";
  const matched = names.filter((n) => quote.includes(padded(n)));
  if (matched.some((n) => normalizeName(n).split(" ").length >= 3)) return null;
  if (distinctiveWordInQuote(matched, m.quote, ctx.sharedNameWords)) return null;
  const head = padded(m.quote.slice(0, 60));
  const subject = matched.some((n) => /^harvard\b/.test(normalizeName(n)) && head.includes(` ${nameCore(n)} `));
  return subject
    ? null
    : "short or generic name mentioned in passing (needs the headline, or 'Harvard <name>' at the start of the sentence)";
}

/** "Chen ’22" / "Jane Q. Doe '25": a student named with their class year. */
const PERSON_WITH_YEAR = /(?:\b[A-Z][\w.’'-]*\s+){1,3}[’‘']\d{2}\b/g;

/** Drop individual students' names from an evidence sentence (no rosters or officer names, §4). PURE. */
export function redactPeople(sentence: string): string {
  return sentence.replace(PERSON_WITH_YEAR, "[a student]");
}

/**
 * The sentence of the article that names the club (evidence), or null. Prefers a
 * sentence that names no individual student; otherwise redacts them. PURE.
 */
export function articleMention(doc: PageDocument, names: string[]): string | null {
  const targets = names.map((n) => ` ${normalizeName(n)} `);
  let fallback: string | null = null;
  for (const block of doc.blocks) {
    for (const sentence of block.text.split(/(?<=[.!?”"])\s+/)) {
      const norm = ` ${normalizeName(sentence)} `;
      if (!targets.some((t) => norm.includes(t))) continue;
      const trimmed = sentence.trim().slice(0, 240);
      PERSON_WITH_YEAR.lastIndex = 0;
      if (!PERSON_WITH_YEAR.test(trimmed)) return trimmed;
      fallback ??= redactPeople(trimmed);
    }
  }
  return fallback;
}

/** "Harvard Poker Club Wins … | News | The Harvard Crimson" → "Harvard Poker Club Wins …". PURE. */
export function articleHeadline(doc: PageDocument): string | null {
  const raw = doc.ogTitle ?? doc.title ?? doc.h1;
  if (!raw) return null;
  const t = raw.replace(
    /\s*[|–-]\s*((News|Opinion|Arts|Sports|Magazine|Multimedia|Metro|Editorial|Blog)\s*\|\s*)?(The Harvard Crimson|The Harvard Independent|Harvard Independent|Harvard Political Review)\s*$/i,
    "",
  );
  return t.trim().length >= 3 ? t.trim().slice(0, 300) : null;
}

export interface CrimsonCounters extends CrawlStats {
  clubsConsidered: number;
  searches: number;
  searchesReused: number;
  searchFailures: number;
  articlesProbed: number;
  articlesNotNamingClub: number;
  mentionsRecorded: number;
  clubsWithMentions: number;
  clubsAlreadySearched: number;
  stoppedForCredit: number;
  [key: string]: number;
}

export async function runCrimson(
  deps: { db: Db; fetcher: SourceFetcher; store: SnapshotStore; logger: Logger; now?: () => Date },
  opts: {
    search: WebSearchProvider;
    clubSlug?: string;
    limit?: number;
    articlesPerClub?: number;
    concurrency?: number;
    /** Which publication to read (default The Harvard Crimson). */
    publisher?: Publisher;
    /** Search again for clubs already searched within a year. */
    refresh?: boolean;
  },
): Promise<{ runId: string; counters: CrimsonCounters; errors: string[] }> {
  const pub = opts.publisher ?? PUBLISHERS[0]!; // PUBLISHERS is a non-empty literal

  const { db, store, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const runId = await startRun(db, {
    job: "crimson",
    adapter: pub.extractorName,
    adapterVersion: CRIMSON_VERSION,
    options: { clubSlug: opts.clubSlug ?? null, limit: opts.limit ?? null },
  });
  const crawl = emptyCrawlStats();
  const c: CrimsonCounters = {
    ...crawl,
    clubsConsidered: 0,
    searches: 0,
    searchesReused: 0,
    searchFailures: 0,
    articlesProbed: 0,
    articlesNotNamingClub: 0,
    mentionsRecorded: 0,
    clubsWithMentions: 0,
    clubsAlreadySearched: 0,
    stoppedForCredit: 0,
  };
  const errors: string[] = [];
  const touched = new Set<string>();

  try {
    const conds = [eq(schema.club.recordState, "active"), ne(schema.club.dataOrigin, "fixture")];
    if (opts.clubSlug) conds.push(inArray(schema.club.slug, opts.clubSlug.split(",")));
    let clubs = await db
      .select({
        id: schema.club.id,
        slug: schema.club.slug,
        name: schema.club.canonicalName,
        acronym: schema.club.acronym,
      })
      .from(schema.club)
      .where(and(...conds))
      .orderBy(schema.club.slug);
    if (opts.limit !== undefined) clubs = clubs.slice(0, opts.limit);
    const pressCtx: PressContext = {
      sharedNameWords: await loadSharedNameWords(db),
      otherClubNames: await loadOtherClubNames(db),
    };
    const aliases = clubs.length
      ? await db
          .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
          .from(schema.clubAlias)
          .where(
            inArray(
              schema.clubAlias.clubId,
              clubs.map((x) => x.id),
            ),
          )
      : [];

    // Names already searched for this publication within a year: re-searching costs credit
    // and finds the same articles, so those clubs are skipped (search queries are stored
    // as sources titled "Search (<provider>): <query>").
    const since = new Date(now().getTime() - 365 * 86_400_000);
    const searched = new Set<string>();
    for (const row of await db
      .select({ title: schema.source.title })
      .from(schema.source)
      .where(and(eq(schema.source.adapter, pub.extractorName), gt(schema.source.lastFetchedAt, since)))) {
      for (const m of (row.title ?? "").matchAll(/"([^"]+)"/g)) searched.add(normalizeName(m[1] ?? ""));
    }

    type Target = {
      id: string;
      slug: string;
      names: string[];
      club: { name: string; acronym: string | null; aliases: string[] };
    };
    const targets: Target[] = [];
    for (const club of clubs) {
      const identity = {
        name: club.name,
        acronym: club.acronym,
        aliases: aliases.filter((a) => a.clubId === club.id).map((a) => a.alias),
      };
      const names = searchableNames(identity);
      const primary = names[0];
      if (!primary) continue;
      c.clubsConsidered++;
      // Only paid search skips; a publication's own free search is simply asked again.
      if (opts.search.paid && !opts.refresh && searched.has(normalizeName(primary))) {
        c.clubsAlreadySearched++;
        continue;
      }
      targets.push({ id: club.id, slug: club.slug, names, club: identity });
    }

    // Paid search: several clubs per query ("A" OR "B" …), each article checked against all
    // of them. A publication's own (free) search API: one club per query.
    const batchSize = opts.search.paid ? PAID_BATCH_SIZE : 1;
    const batches: Target[][] = [];
    for (let k = 0; k < targets.length; k += batchSize) batches.push(targets.slice(k, k + batchSize));

    let stop = false;
    let next = 0;
    const worker = async () => {
      while (next < batches.length && !stop) {
        const batch = batches[next++];
        if (!batch) continue;
        const quoted = batch.map((t) => `"${(t.names[0] ?? "").replace(/"/g, "")}"`);
        const query = `site:${pub.site} ${quoted.length > 1 ? `(${quoted.join(" OR ")})` : quoted[0]}`;
        let results: SearchResult[];
        try {
          // Paid results are kept a year; a free site search is asked again after 6 days.
          const r = await cachedSearch(
            { db, store, now },
            opts.search,
            query,
            runId,
            pub.extractorName,
            opts.search.paid ? 365 : 6,
          );
          if (r.reused) c.searchesReused++;
          else c.searches++;
          results = r.results;
        } catch (error) {
          if (error instanceof SearchCreditError) {
            // Out of credit (or at this run's cap): stop searching, keep what we have.
            stop = true;
            c.stoppedForCredit = 1;
            errors.push(`stopped: ${error.message}`);
            return;
          }
          c.searchFailures++;
          errors.push(`${batch.map((t) => t.slug).join(",")}: ${String(error)}`);
          continue;
        }
        const articles = results
          .map((x) => pub.article(x.url))
          .filter((x): x is { url: string; publishedOn: string | null } => x !== null)
          .filter((x, idx, all) => all.findIndex((y) => y.url === x.url) === idx)
          .slice(0, (opts.articlesPerClub ?? 4) * batch.length);
        for (const a of articles) {
          c.articlesProbed++;
          const [page] = await crawlSite({
            rootUrl: a.url,
            clubId: batch[0]?.id ?? "",
            officialSite: false,
            sourceTypeOverride: pub.sourceType,
            db,
            fetcher: deps.fetcher,
            store,
            runId,
            logger: logger.child({ publisher: pub.key }),
            now,
            maxPages: 1,
            maxDepth: 0,
            // Articles don't change: reuse a stored copy for a year.
            freshnessMs: 365 * 86_400_000,
            force: false,
            stats: crawl,
          });
          if (!page) continue;
          const title = articleHeadline(page.doc);
          const publishedOn = a.publishedOn ?? jsonLdPublished(page.doc);
          let named = false;
          for (const t of batch) {
            const quote = articleMention(page.doc, t.names);
            if (!quote || !title || !publishedOn) continue;
            named = true;
            const article = articleSignals(page.doc, t.club);
            if (pressMentionProblem(t.club, { title, quote, publishedOn, publisher: pub.name, article }, pressCtx))
              continue;
            const res = await upsertClaim(
              db,
              {
                clubId: t.id,
                fieldKey: "club.press_mention",
                value: { url: a.url, title, publishedOn, publisher: pub.name },
                assertionKind: "stated",
              },
              {
                sourceId: page.sourceId,
                sourceType: pub.sourceType,
                snapshotId: page.snapshotId,
                ingestionRunId: runId,
                observedAt: page.fetchedAt,
                quote,
                locator: { url: a.url, signal: "article text names the club" },
                extractionMethod: "html_parse",
                extractorName: pub.extractorName,
                extractorVersion: CRIMSON_VERSION,
                isDirect: true,
              },
            );
            if (res.claimCreated) c.mentionsRecorded++;
            if (!touched.has(t.id)) c.clubsWithMentions++;
            touched.add(t.id);
          }
          if (!named) c.articlesNotNamingClub++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, worker));

    const stats = await resolveClubs(db, { clubIds: [...touched], now: now() });
    errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
    Object.assign(c, crawl);
    await finishRun(db, runId, {
      status: errors.length ? "partial" : "succeeded",
      counters: c,
      errorSummary: errors.slice(0, 50).join("\n") || null,
    });
    return { runId, counters: c, errors };
  } catch (error) {
    await finishRun(db, runId, { status: "failed", counters: c, errorSummary: String(error) });
    throw error;
  }
}

/** Words used by more than one active club's name or alias (see `sharedNameWords`). */
async function loadSharedNameWords(db: Db): Promise<Set<string>> {
  const clubs = await db
    .select({ id: schema.club.id, name: schema.club.canonicalName })
    .from(schema.club)
    .where(eq(schema.club.recordState, "active"));
  const aliasRows = await db
    .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
    .from(schema.clubAlias);
  const aliases = new Map<string, string[]>();
  for (const a of aliasRows) aliases.set(a.clubId, [...(aliases.get(a.clubId) ?? []), a.alias]);
  return sharedNameWords(clubs.map((c) => ({ ...c, aliases: aliases.get(c.id) ?? [] })));
}

/** Active clubs' headline names (see `headlineName`), longest first. */
async function loadOtherClubNames(db: Db): Promise<string[]> {
  const clubs = await db
    .select({ name: schema.club.canonicalName })
    .from(schema.club)
    .where(eq(schema.club.recordState, "active"));
  return [...new Set(clubs.map((c) => headlineName(c.name)))]
    .filter(
      (n) =>
        n.split(" ").length >= 2 ||
        // One-word "Harvard X" names (the Salient, the Lampoon), never the newspapers themselves.
        (n.length >= 4 && !/^(?:crimson|independent)$/.test(n)),
    )
    .sort((a, b) => b.length - a.length);
}

/** Status reasons written by `rescorePressMentions` (any rules version): only these revive. */
const RESCORE_REASON = /^press-v\d+ rescore: /;

export interface RescoredMention {
  slug: string;
  title: string;
  publishedOn: string;
  publisher: string;
  quote: string;
  why: string;
}

/**
 * Re-judge stored mentions with the current rules, from stored data only (no search, no
 * fetch): active `club.press_mention` claims that fail `pressMentionProblem` are rejected
 * with the reason (never deleted), and mentions an earlier rescore rejected that now pass
 * are restored (audited `restore_claim`). Mentions rejected any other way stay rejected.
 */
export async function rescorePressMentions(
  db: Db,
  opts: {
    dryRun?: boolean;
    actor?: string;
    /** Stored article copies: with it, mentions are judged on the whole article (press-v6). */
    store?: SnapshotStore;
  } = {},
): Promise<{ checked: number; rejected: RescoredMention[]; restored: RescoredMention[] }> {
  const rows = await db
    .select({
      id: schema.claim.id,
      clubId: schema.claim.clubId,
      slug: schema.club.slug,
      name: schema.club.canonicalName,
      acronym: schema.club.acronym,
      value: schema.claim.value,
      status: schema.claim.status,
      statusReason: schema.claim.statusReason,
      quote: schema.claimEvidence.evidenceQuote,
      storageKey: schema.sourceSnapshot.storageKey,
      finalUrl: schema.sourceSnapshot.finalUrl,
    })
    .from(schema.claim)
    .innerJoin(schema.club, eq(schema.club.id, schema.claim.clubId))
    .innerJoin(schema.claimEvidence, eq(schema.claimEvidence.claimId, schema.claim.id))
    .leftJoin(schema.sourceSnapshot, eq(schema.sourceSnapshot.id, schema.claimEvidence.snapshotId))
    .where(and(eq(schema.claim.fieldKey, "club.press_mention"), inArray(schema.claim.status, ["active", "rejected"])));
  const aliasRows = await db
    .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.alias })
    .from(schema.clubAlias);
  const aliases = new Map<string, string[]>();
  for (const a of aliasRows) aliases.set(a.clubId, [...(aliases.get(a.clubId) ?? []), a.alias]);
  const ctx: PressContext = {
    sharedNameWords: await loadSharedNameWords(db),
    otherClubNames: await loadOtherClubNames(db),
  };

  // One parse per stored article (several clubs' mentions share it); a missing blob is judged without it.
  const docs = new Map<string, Promise<PageDocument | null>>();
  const storedArticle = (store: SnapshotStore, key: string, url: string) => {
    let p = docs.get(key);
    if (!p) {
      p = store
        .get(key)
        .then((bytes) => htmlToDocument(new TextDecoder().decode(bytes), url))
        .catch(() => null);
      docs.set(key, p);
    }
    return p;
  };

  // A claim with several evidence rows is kept if any of them stands.
  type Verdict = RescoredMention & { clubId: string; active: boolean; whys: (string | null)[] };
  const verdicts = new Map<string, Verdict>();
  for (const r of rows) {
    if (r.status === "rejected" && !RESCORE_REASON.test(r.statusReason ?? "")) continue;
    const v = r.value as { title?: string; publishedOn?: string; publisher?: string };
    if (!v.title || !v.publishedOn) continue;
    const identity = { name: r.name, acronym: r.acronym, aliases: aliases.get(r.clubId) ?? [] };
    const doc = opts.store && r.storageKey ? await storedArticle(opts.store, r.storageKey, r.finalUrl ?? "") : null;
    const why = pressMentionProblem(
      identity,
      {
        title: v.title,
        quote: r.quote ?? "",
        publishedOn: v.publishedOn,
        ...(v.publisher ? { publisher: v.publisher } : {}),
        ...(doc ? { article: articleSignals(doc, identity) } : {}),
      },
      ctx,
    );
    const cur: Verdict = verdicts.get(r.id) ?? {
      slug: r.slug,
      clubId: r.clubId,
      title: v.title,
      publishedOn: v.publishedOn,
      publisher: v.publisher ?? "",
      quote: r.quote ?? "",
      why: "",
      active: r.status === "active",
      whys: [],
    };
    cur.whys.push(why);
    if (why === null) cur.quote = r.quote ?? "";
    verdicts.set(r.id, cur);
  }
  const rejected: (RescoredMention & { id: string; clubId: string })[] = [];
  const restored: (RescoredMention & { id: string; clubId: string })[] = [];
  for (const [id, v] of verdicts) {
    const stands = v.whys.some((w) => w === null);
    const { active: _active, whys, ...m } = v;
    if (v.active && !stands) rejected.push({ ...m, id, why: whys[0] ?? "" });
    else if (!v.active && stands) restored.push({ ...m, id, why: "" });
  }
  if (!opts.dryRun && (rejected.length || restored.length)) {
    for (const why of new Set(rejected.map((r) => r.why))) {
      await rejectClaims(db, {
        claimIds: rejected.filter((r) => r.why === why).map((r) => r.id),
        actor: opts.actor ?? "cli",
        reason: `press-v${CRIMSON_VERSION} rescore: ${why}`,
      });
    }
    await restoreClaims(db, {
      claimIds: restored.map((r) => r.id),
      actor: opts.actor ?? "cli",
      reason: `press-v${CRIMSON_VERSION} rescore: passes the current press rules`,
    });
    await resolveClubs(db, { clubIds: [...new Set([...rejected, ...restored].map((r) => r.clubId))] });
  }
  const strip = ({ id: _id, clubId: _clubId, ...m }: RescoredMention & { id: string; clubId: string }) => m;
  return { checked: verdicts.size, rejected: rejected.map(strip), restored: restored.map(strip) };
}
