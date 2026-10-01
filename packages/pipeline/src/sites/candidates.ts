import { classifyLink, normalizeAcronym, normalizeName, siteKey, type ClassifiedLink } from "@hci/core";
import { pageNamesClub } from "../extract/deterministic";
import type { PageDocument } from "../parse/document";

/**
 * Website discovery for clubs with no known site (ADR 0023). PURE.
 *
 * Candidates come from two places: domains guessed from the club's name, and results
 * from an official web-search API. Neither is evidence by itself. A candidate becomes a
 * `club.link` claim only after we fetch its home page and `siteIdentity` accepts it, and
 * even then it is "probable" (ADR 0017), never verified.
 */

export interface ClubNames {
  name: string;
  acronym: string | null;
  aliases: string[];
}

const STOP = new Set(["the", "of", "at", "for", "and", "in", "a", "on", "to"]);
const INSTITUTION = new Set([
  "harvard",
  "radcliffe",
  "college",
  "undergraduate",
  "undergrad",
  "university",
  "hc",
  "hu",
]);
const SUFFIX = new Set(["club", "society", "association", "organization", "group", "team", "program", "project"]);

/** "Running (Club Sport)" → { base: "Running", clubSport: true }. Other parentheticals are dropped. */
function splitName(name: string): { base: string; clubSport: boolean } {
  const clubSport = /\bclub sport\b/i.test(name);
  return { base: name.replace(/\([^)]*\)/g, " ").trim(), clubSport };
}

/**
 * Names a site may use for the club, for title matching: the listed names, "Harvard X"
 * forms of names that don't carry the institution, and "Harvard X Club" for club sports
 * (whose listed name is just the sport).
 */
export function identityNames(club: ClubNames): string[] {
  const out = new Set<string>();
  // A club sport's aliases ("Baseball") are sport names too: "Harvard Baseball" is the
  // varsity team, so they also only count as "Harvard <sport> Club".
  const sportClub = splitName(club.name).clubSport;
  for (const raw of [club.name, ...club.aliases]) {
    const { base, clubSport } = splitName(raw);
    if (!base) continue;
    const tokens = normalizeName(base).split(" ").filter(Boolean);
    if (clubSport || sportClub) {
      const sport = base
        .replace(/\b(men'?s|women'?s|co-?ed|harvard|club)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!sport) continue;
      out.add(`Harvard ${sport} Club`);
      out.add(`Harvard Club ${sport}`);
      // "Crimson Dance Team" already names a team, not just a sport.
      if (/\b(team|society|company|troupe|ensemble)\b/i.test(sport)) out.add(`Harvard ${sport}`);
      continue;
    }
    out.add(base);
    if (!tokens.some((t) => INSTITUTION.has(t))) out.add(`Harvard ${base}`);
  }
  return [...out];
}

function coreTokens(name: string): string[] {
  return normalizeName(splitName(name).base)
    .split(" ")
    .filter((t) => t && !STOP.has(t) && !INSTITUTION.has(t));
}

function initials(name: string, keepStop: boolean): string {
  return normalizeName(splitName(name).base)
    .split(" ")
    .filter((t) => t && (keepStop || !STOP.has(t)))
    .map((t) => t[0])
    .join("");
}

/**
 * Plausible domains for a club, most likely first, capped. Guessing costs one DNS lookup
 * per domain; only resolving hosts are fetched, and only a page that names the club counts.
 */
export function guessDomains(club: ClubNames, max = 14): string[] {
  const { clubSport } = splitName(club.name);
  const core = coreTokens(club.name);
  if (core.length === 0) return [];
  const stems = new Set<string>();
  const compact = core.join("");
  if (compact.length >= 3 && compact.length <= 24) stems.add(compact);
  // "Women in Business" → "womeninbusiness" as well as "womenbusiness".
  const withStop = normalizeName(splitName(club.name).base)
    .split(" ")
    .filter((t) => t && t !== "the" && !INSTITUTION.has(t))
    .join("");
  if (withStop !== compact && withStop.length <= 24) stems.add(withStop);
  const noSuffix = core.filter((t) => !SUFFIX.has(t)).join("");
  if (noSuffix.length >= 3 && noSuffix.length <= 24) stems.add(noSuffix);
  if (clubSport && compact.length >= 3) stems.add(`${compact}club`);

  const out: string[] = [];
  const add = (d: string) => {
    if (/^[a-z0-9-]{3,40}\.(org|com)$/.test(d) && !out.includes(d)) out.push(d);
  };
  for (const s of stems) {
    add(`harvard${s}.org`);
    add(`harvard${s}.com`);
  }
  const acronyms = new Set<string>();
  if (club.acronym) acronyms.add(normalizeAcronym(club.acronym).toLowerCase());
  if (!clubSport) {
    for (const keep of [true, false]) {
      const a = initials(club.name, keep);
      if (a.length >= 3 && a.length <= 6) acronyms.add(a);
    }
  }
  for (const a of acronyms) {
    if (a.length < 3) continue;
    // Initials of "Harvard X Y" start with h; "harvardxy" is the common domain form.
    const rest = a.startsWith("h") ? a.slice(1) : a;
    if (rest.length >= 2 && /^[a-z]+$/.test(rest)) add(`harvard${rest}.org`);
    // Bare acronym domains (bmes.org, casp.org) almost always belong to unrelated
    // organizations; only try Harvard-style acronyms ("huwib") the club itself uses.
    if (club.acronym && a.startsWith("h") && a.length >= 4 && a === normalizeAcronym(club.acronym).toLowerCase()) {
      add(`${a}.org`);
      add(`${a}.com`);
    }
  }
  for (const s of stems) {
    if (s.length >= 6) {
      add(`${s}harvard.org`);
      add(`${s}harvard.com`);
    }
  }
  return out.slice(0, max);
}

const PARKED =
  /\b(domain (is |may be )?for sale|buy this domain|this domain (name )?is (parked|available)|parked (free|domain)|hugedomains|sedoparking|dan\.com|afternic)\b/i;
const HARVARD = /\b(harvard|radcliffe)\b/i;

/** Words that vary between a club's listed name and its own site title. */
const TITLE_NOISE = new Set(["college", "university", "undergraduate", "undergrad", "the"]);
const TITLE_SEGMENT = /\s+[|–—:·•-]\s+|\s*[|–—·•,]\s*|\s*\(|\)\s*/;

function titleKey(text: string): string[] {
  return normalizeName(text.replace(/^\s*welcome to\s+/i, ""))
    .split(" ")
    .filter((t) => t && !TITLE_NOISE.has(t) && !/^(home|homepage|official|website)$/.test(t));
}

/**
 * Does one segment of a heading ("Home | The Harvard Karate Club | Cambridge") BE the club's
 * name, give or take one word ("PBHA Chinatown Afterschool Program")? A longer name that
 * merely contains the club's ("The Harvard Crimson Global Essay Comp") does not count.
 */
export function headingNamesClub(heading: string, club: ClubNames, pageText = ""): boolean {
  const names = identityNames(club)
    .map(titleKey)
    .filter((n) => n.length >= 2);
  // A club sport's site may be titled just "Harvard Curling" when the page says it's a club
  // sport; the varsity team's site ("Harvard Squash") doesn't.
  const { base, clubSport } = splitName(club.name);
  if (clubSport && /\bclub (sports?|team)\b/i.test(pageText.slice(0, 1500))) {
    const sport = titleKey(base.replace(/\b(men'?s|women'?s|co-?ed)\b/gi, " "));
    if (sport.length >= 1) names.push(["harvard", ...sport]);
  }
  // "Harvard Undergraduate Law Review" is not "Harvard Law Review" (CLAUDE.md §3): when the
  // heading drops the club's "undergraduate", the page itself must be about undergraduates.
  const droppedUndergrad =
    /\bundergrad(uate)?s?\b/i.test(club.name) &&
    !/\bundergrad(uate)?s?\b/i.test(heading) &&
    !/\b(undergrad(uate)?s?|college)\b/i.test(pageText.slice(0, 3000));
  if (droppedUndergrad) return false;
  for (const seg of [heading, ...heading.split(TITLE_SEGMENT)]) {
    const k = titleKey(seg);
    for (const n of names) {
      // One extra word ("PBHA …"); two for names of three or more words ("… Term-Time").
      if (k.length < n.length || k.length > n.length + (n.length >= 3 ? 2 : 1)) continue;
      const joined = k.join(" ");
      const name = n.join(" ");
      if (joined === name || joined.startsWith(`${name} `) || joined.endsWith(` ${name}`)) return true;
    }
  }
  return false;
}

/**
 * Does this home page belong to the club? Returns the matching heading (the evidence
 * quote) or null. Stricter than the enrichment probe because the URL itself carries no
 * trust: a title/h1/og:title segment must be the club's name (`headingNamesClub`), the
 * page must mention Harvard, parked-domain pages never count, and an acronym-only match
 * also needs "Harvard" in the heading.
 */
export function siteIdentity(doc: PageDocument, club: ClubNames): string | null {
  const head = [doc.title, doc.h1, doc.ogTitle, doc.metaDescription].filter(Boolean).join(" ");
  if (PARKED.test(`${head} ${doc.text.slice(0, 3000)}`)) return null;
  if (!HARVARD.test(`${head} ${doc.text.slice(0, 3000)}`)) return null;
  const headings = [doc.title, doc.h1, doc.ogTitle].filter((h): h is string => Boolean(h));
  const byName = headings.find((h) => headingNamesClub(h, club, doc.text));
  if (byName) return byName;
  if (!club.acronym) return null;
  const byAcronym = pageNamesClub(doc, [], [club.acronym]);
  return byAcronym && HARVARD.test(byAcronym) ? byAcronym : null;
}

/** Hosts that are never a club's own site, whatever a search result says. */
const NOT_A_SITE =
  /(^|\.)(harvard\.edu|wikipedia\.org|wikiwand\.com|google\.com|linktr\.ee|instagram\.com|facebook\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|github\.com|reddit\.com|eventbrite\.com|medium\.com|substack\.com|crunchbase\.com|glassdoor\.com|indeed\.com|yelp\.com|niche\.com|collegevine\.com|prepscholar\.com|usnews\.com|bostonglobe\.com|nytimes\.com|amazon\.com|apple\.com|spotify\.com|soundcloud\.com|campusgroups\.com|givecampus\.com|venmo\.com|gofundme\.com|thecrimson\.com|pbha\.org|bandcamp\.com)$/i;

/** Is this URL on a host that is never a club's own site? */
export function excludedSiteHost(url: string): boolean {
  try {
    return NOT_A_SITE.test(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return true;
  }
}

export interface SearchResult {
  url: string;
  title: string;
  description?: string;
}

export type SearchCandidate =
  { kind: "site"; root: string; resultTitle: string } | { kind: "social"; link: ClassifiedLink; quote: string };

const SOCIAL_KINDS = new Set(["instagram", "linkedin", "facebook", "x", "youtube", "tiktok"]);

/** Does a search result's title name the club (full name, or Harvard + a ≥2-token core)? */
export function titleNamesClub(title: string, club: ClubNames): boolean {
  const t = ` ${normalizeName(title)} `;
  for (const n of identityNames(club)) {
    const nn = normalizeName(n);
    if (nn.split(" ").length >= 2 && t.includes(` ${nn} `)) return true;
  }
  const core = coreTokens(club.name);
  return core.length >= 2 && HARVARD.test(title) && t.includes(` ${core.join(" ")} `);
}

/**
 * One search result → a site to probe, a social profile whose result title names the
 * club, or nothing. Sites are reduced to their root (a news article naming the club must
 * not make the news site "the club's site": the root's own title decides).
 */
export function classifySearchResult(result: SearchResult, club: ClubNames): SearchCandidate | null {
  const link = classifyLink(result.url);
  if (!link || link.isPersonal || link.isContentItem) return null;
  if (SOCIAL_KINDS.has(link.kind)) {
    // Path-style profile URLs (facebook.com/p/…) don't yield a real handle.
    if (!link.handle || link.handle.length < 3) return null;
    return titleNamesClub(result.title, club) ? { kind: "social", link, quote: result.title } : null;
  }
  if (link.kind !== "website") return null;
  let host = "";
  try {
    host = new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (NOT_A_SITE.test(host)) return null;
  const key = siteKey(link.url);
  if (!key) return null;
  // Only fetch results that plausibly are the club's own site: most results for a club
  // name are news, directories and unrelated namesakes, and each probe is a real request.
  if (!titleNamesClub(result.title, club) && !siteKeyMentionsClub(key, club)) return null;
  return { kind: "site", root: `https://${key}/`, resultTitle: result.title };
}

/** Does the host (or shared-host path) contain the club's distinctive name or its acronym? */
export function siteKeyMentionsClub(key: string, club: ClubNames): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  const core = coreTokens(club.name);
  const stems = [core.join(""), core.filter((t) => !SUFFIX.has(t)).join("")].filter((s) => s.length >= 5);
  if (stems.some((s) => k.includes(s))) return true;
  const acr = club.acronym ? normalizeAcronym(club.acronym).toLowerCase() : "";
  return acr.length >= 3 && k.includes(acr) && (acr.length >= 4 || k.includes("harvard"));
}

/** The search query for a club: its name in quotes, plus "Harvard" if the name lacks it. */
export function searchQuery(club: ClubNames): string {
  const { base, clubSport } = splitName(club.name);
  if (clubSport) return `Harvard ${base} club sport`;
  return HARVARD.test(base) ? `"${base}"` : `"${base}" Harvard`;
}
