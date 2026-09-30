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
  for (const raw of [club.name, ...club.aliases]) {
    const { base, clubSport } = splitName(raw);
    if (!base) continue;
    const tokens = normalizeName(base).split(" ").filter(Boolean);
    if (clubSport) {
      const sport = base.replace(/\b(men'?s|women'?s|co-?ed)\b/gi, " ").trim();
      out.add(`Harvard ${sport} Club`);
      out.add(`Harvard Club ${sport}`);
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

/**
 * Does this home page belong to the club? Returns the matching title text (the evidence
 * quote) or null. Stricter than the enrichment probe because the URL itself carries no
 * trust: the title/h1 must name the club, the page must mention Harvard, parked-domain
 * pages never count, and an acronym-only title match also needs "Harvard" in the title.
 */
export function siteIdentity(doc: PageDocument, club: ClubNames): string | null {
  const head = [doc.title, doc.h1, doc.ogTitle, doc.metaDescription].filter(Boolean).join(" ");
  if (PARKED.test(`${head} ${doc.text.slice(0, 3000)}`)) return null;
  if (!HARVARD.test(`${head} ${doc.text.slice(0, 3000)}`)) return null;
  const names = identityNames(club);
  const byName = pageNamesClub(doc, names, []);
  if (byName) return byName;
  if (!club.acronym) return null;
  const byAcronym = pageNamesClub(doc, [], [club.acronym]);
  return byAcronym && HARVARD.test(byAcronym) ? byAcronym : null;
}

/** Hosts that are never a club's own site, whatever a search result says. */
const NOT_A_SITE =
  /(^|\.)(harvard\.edu|wikipedia\.org|wikiwand\.com|google\.com|linktr\.ee|instagram\.com|facebook\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|github\.com|reddit\.com|eventbrite\.com|medium\.com|substack\.com|crunchbase\.com|glassdoor\.com|indeed\.com|yelp\.com|niche\.com|collegevine\.com|prepscholar\.com|usnews\.com|bostonglobe\.com|nytimes\.com|amazon\.com|apple\.com|spotify\.com|soundcloud\.com|campusgroups\.com|givecampus\.com|venmo\.com|gofundme\.com|thecrimson\.com)$/i;

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
    if (!link.handle) return null;
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
  return { kind: "site", root: `https://${key}/`, resultTitle: result.title };
}

/** The search query for a club: its name in quotes, plus "Harvard" if the name lacks it. */
export function searchQuery(club: ClubNames): string {
  const { base, clubSport } = splitName(club.name);
  if (clubSport) return `Harvard ${base} club sport`;
  return HARVARD.test(base) ? `"${base}"` : `"${base}" Harvard`;
}
