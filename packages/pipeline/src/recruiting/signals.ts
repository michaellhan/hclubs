import { compareTermKeys, newYorkDateParts, parseTermExpression, termForDate, termKey } from "@hci/core";
import { isFormUrl } from "../parse/forms";
import type { DocLink, PageDocument } from "../parse/document";

/**
 * Recruiting-page signals (ADR 0031). PURE: link scoring for the focused crawl, application
 * form detection, and a page classifier that keeps old recruiting pages from passing as
 * current ones.
 */

// --- Link scoring ------------------------------------------------------------------------------

/** Words in a URL path or anchor that point at joining/recruiting information, with weights. */
const LINK_TERMS: [RegExp, number][] = [
  [/\bapply\b|\bapplications?\b/, 10],
  [/\bcomp(?:ing|s)?\b/, 10],
  [/\brecruit(?:ing|ment)?\b/, 10],
  [/\baudition(?:s|ing)?\b/, 10],
  [/\btry-?outs?\b/, 10],
  [/\binterest[- ]form\b/, 9],
  [/\bjoin(?:[- ]us)?\b|\bhow[- ]to[- ]join\b/, 8],
  [/\bnew[- ]members?\b|\bprospective\b/, 7],
  [/\bget[- ]involved\b|\bmembership\b|\bbecome[- ]a[- ]member\b/, 6],
  [/\b(?:fall|spring)\b/, 2],
];
/** Links that look like recruiting but are news, archives or other people's jobs. */
const LINK_PENALTY =
  /\b(news|blog|posts?|archives?|press|article|jobs?[- ]board|careers?[- ]at|donate|alumni|newsletter|subscribe)\b|\/(19|20)\d\d\//;

/** 0 = not a recruiting link; higher = more likely the club's joining/recruiting page. */
export function scoreRecruitingLink(url: string, text = ""): number {
  let path = "";
  try {
    const u = new URL(url);
    path = `${u.pathname} ${u.search}`;
  } catch {
    return 0;
  }
  const hay = `${path} ${text}`
    .toLowerCase()
    .replace(/[_/.?=&+-]+/g, " ")
    .replace(/%20/g, " ");
  let score = 0;
  for (const [re, w] of LINK_TERMS) if (re.test(hay)) score += w;
  if (score === 0) return 0;
  if (LINK_PENALTY.test(`${path} ${text}`.toLowerCase())) score -= 8;
  return Math.max(0, score);
}

// --- Application forms -------------------------------------------------------------------------

/** Public application systems beyond the hosts `isFormUrl` knows (read as title + description only). */
const OTHER_APPLICATION_HOSTS = /(^|\.)(formstack\.com|cognitoforms\.com|surveymonkey\.com|forms\.microsoft\.com)$/i;
const APPLICATION_ANCHOR =
  /\b(apply|application|comp|audition|try-?out|interest form|sign[- ]?up|register|join|recruit)/i;

export function isApplicationSystemUrl(url: string): boolean {
  if (isFormUrl(url)) return true;
  try {
    return OTHER_APPLICATION_HOSTS.test(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

/**
 * Form links on a page that are clearly the club's application: the anchor says so, or the
 * page itself is a recruiting page. A form linked as "feedback" or "merch order" is not.
 */
export function applicationFormLinks(doc: PageDocument, recruitingPage: boolean): DocLink[] {
  return doc.links.filter((l) => {
    if (!isApplicationSystemUrl(l.url)) return false;
    if (/\b(feedback|merch|order|donat|rsvp|ticket|survey|contact|newsletter|mailing list)\b/i.test(l.text))
      return false;
    return APPLICATION_ANCHOR.test(l.text) || recruitingPage;
  });
}

// --- Page classification -----------------------------------------------------------------------

export type RecruitingPageKind = "active_application" | "recruiting_info" | "historical" | "membership" | "irrelevant";

export interface RecruitingPageClass {
  kind: RecruitingPageKind;
  score: number;
  signals: string[];
  /** Latest explicit calendar year on the page (or in its URL), if any. */
  latestYear: number | null;
  /** An explicit recruiting term on the page ("Fall 2026"), if any. */
  termKey: string | null;
}

const PROCESS_WORDS =
  /\b(comp(?:ing)?|audition|try-?out|application|apply|recruit(?:ing|ment)?|interview|coffee chat)/i;
const MEMBERSHIP_WORDS = /\b(join|membership|get involved|become a member|new members|mailing list|all are welcome)\b/i;
const OPEN_NOW =
  /\b(applications?|the comp|auditions?|try-?outs?|recruitment|recruiting)\s+(?:is\s+|are\s+)?(?:now\s+)?(open|live|underway)\b|\bapply (?:now|today|here)\b|\bnow accepting\b/i;
const CLOSED_NOW =
  /\b(applications?|the comp|auditions?|recruit(?:ing|ment))\s+(?:is\s+|are\s+|has\s+|have\s+)?(?:now\s+)?(closed|over|ended)\b|\bno longer accepting\b/i;
const DEADLINE_LANGUAGE = /\b(deadline|due|apply by|submit by|no later than|open until|close[sd]? on)\b/i;
const DATE_LIKE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b/i;

/** Latest year in a page's text/URL, and whether it is already past ("stale"). PURE. */
export function latestYearIn(text: string, url: string, fetchedAt: Date): { latest: number | null; stale: boolean } {
  const years = pageYears({ url, title: null, text }, fetchedAt);
  const latest = years[years.length - 1] ?? null;
  return { latest, stale: latest !== null && latest < newYorkDateParts(fetchedAt).year };
}

/**
 * Years a page mentions (2000…next year): written out, as a term with an apostrophe
 * ("Spring ’16"), or in its URL path (/2018/, /spring-2016-applications).
 */
export function pageYears(doc: Pick<PageDocument, "url" | "title" | "text">, fetchedAt: Date): number[] {
  const max = newYorkDateParts(fetchedAt).year + 1;
  const years = new Set<number>();
  const text = `${doc.title ?? ""}\n${doc.text}`;
  // Copyright lines ("© 2019 …") say when a template was made, not when recruiting happened.
  for (const m of text.replace(/(©|copyright)\s*\d{4}(\s*[-–]\s*\d{4})?/gi, " ").matchAll(/\b(20\d\d)\b/g)) {
    const y = Number(m[1]);
    if (y >= 2000 && y <= max) years.add(y);
  }
  // "Spring ’16", "Fall '25": a term with a two-digit year (never "Class of ’27", a class year).
  for (const m of text.matchAll(/\b(?:spring|fall|autumn|winter|summer)\s*[’'‘](\d\d)\b/gi)) {
    const y = 2000 + Number(m[1]);
    if (y <= max) years.add(y);
  }
  try {
    for (const m of new URL(doc.url).pathname.matchAll(/(?:^|[/_-])(20\d\d)(?=[/_.-]|$)/g)) {
      const y = Number(m[1]);
      if (y >= 2000 && y <= max) years.add(y);
    }
  } catch {
    /* no URL */
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * Classify a page for recruiting. "historical" means its explicit years are all in the past
 * (a 2024 comp page fetched in 2026); such pages are kept as evidence but never surface as
 * current recruiting.
 */
export function classifyRecruitingPage(doc: PageDocument, fetchedAt: Date): RecruitingPageClass {
  const signals: string[] = [];
  let score = 0;
  const head = [doc.title ?? "", doc.h1 ?? "", ...doc.blocks.filter((b) => b.kind === "heading").map((b) => b.text)]
    .join(" ")
    .slice(0, 2000);
  const body = doc.text.slice(0, 20_000);
  const urlScore = scoreRecruitingLink(doc.url);
  if (urlScore > 0) {
    score += Math.min(urlScore, 15);
    signals.push("url");
  }
  if (PROCESS_WORDS.test(head)) {
    score += 10;
    signals.push("heading");
  }
  if (PROCESS_WORDS.test(body)) {
    score += 4;
    signals.push("process words");
  }
  const forms = applicationFormLinks(doc, false);
  if (forms.length > 0) {
    score += 8;
    signals.push("application form link");
  }
  const deadline = DEADLINE_LANGUAGE.test(body) && DATE_LIKE.test(body);
  if (deadline) {
    score += 8;
    signals.push("deadline language");
  }
  const open = OPEN_NOW.test(body);
  if (open) {
    score += 6;
    signals.push("applications open");
  }
  const closed = CLOSED_NOW.test(body);
  if (closed) signals.push("applications closed");
  // A term counts only in a heading or next to recruiting words (not "founded in the fall of 1981").
  const term =
    parseTermExpression(head, null) ??
    doc.blocks
      .filter((b) => PROCESS_WORDS.test(b.text))
      .map((b) => parseTermExpression(b.text, null))
      .find((t) => t !== null) ??
    null;
  if (term) signals.push(`term ${term.termKey}`);

  const years = pageYears(doc, fetchedAt);
  const latestYear = years.length ? (years[years.length - 1] ?? null) : null;
  const fetchYear = newYorkDateParts(fetchedAt).year;
  const termYear = term ? Number(term.termKey.slice(0, 4)) : null;
  const currentTerm = termKey(termForDate(fetchedAt));
  // Only past years on the page, or an explicit term already over with nothing later
  // mentioned: an old cycle's page.
  const historical =
    (latestYear !== null && latestYear < fetchYear && (termYear === null || termYear < fetchYear)) ||
    (term !== null &&
      compareTermKeys(term.termKey, currentTerm) < 0 &&
      (latestYear === null || latestYear <= (termYear ?? 0)));

  let kind: RecruitingPageKind;
  if (score < 8 && !MEMBERSHIP_WORDS.test(`${head} ${body.slice(0, 4000)}`)) kind = "irrelevant";
  else if (score >= 8 && historical) kind = "historical";
  else if (score >= 18 && (open || forms.length > 0 || deadline) && !closed) kind = "active_application";
  else if (score >= 12 && PROCESS_WORDS.test(`${head} ${body}`)) kind = "recruiting_info";
  else if (MEMBERSHIP_WORDS.test(`${head} ${body.slice(0, 4000)}`)) kind = "membership";
  else kind = "irrelevant";
  return { kind, score, signals, latestYear, termKey: term?.termKey ?? null };
}
