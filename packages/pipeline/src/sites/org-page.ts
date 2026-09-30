import type { DocLink, PageDocument } from "../parse/document";

/**
 * Web discovery of clubs we don't know yet (ADR 0025). PURE.
 *
 * A candidate page (from a search sweep or a link on a page we already crawled) counts as
 * a Harvard student organization's own site only when a heading segment is an org name
 * ("Harvard X Club", "X at Harvard", "Harvard-Radcliffe X Society"…) and the page talks
 * about students. Graduate-school, alumni and office pages are excluded: the index's
 * first scope is the College (§3), and alumni "Harvard Club of <city>" pages aren't
 * student organizations.
 */

const HARVARD = /\b(harvard|radcliffe)\b/i;
// "members" alone isn't enough: town historical societies and alumni clubs have members too.
const STUDENTS = /\b(students?|student-run|undergrad(uate)?s?|first-years?|freshm[ae]n)\b/i;

/** Nouns that make "Harvard …" an organization rather than a place, course or article. */
const ORG_NOUN =
  /\b(club|society|association|group|team|ensemble|orchestra|choir|chorus|chorale|glee|singers|troupe|company|collective|council|committee|review|journal|magazine|quarterly|advocate|lampoon|project|program|initiative|alliance|network|coalition|union|league|fund|capital|partners|consulting|investors|investments?|traders|forum|conference|labs?|players|band|theat(er|re)|dance|a ?cappella|federation|circle|guild|foundation|fellowship|ministry|cru|hillel|brotherhood|sisterhood|sorority|fraternity|organization|community|squad|crew|corps|summit|hackathon|tournament|olympiad|democrats|republicans|model (un|united nations|congress)|debate|mock trial|daily|times|post|crimson|independent|salient|votes|robotics|racing|rocketry|satellite|ventures|startups|builders)\b/i;

/** Not student organizations (or not the College's), whatever the heading says. */
const EXCLUDED_NAME =
  /\b(harvard club of|harvard clubs? (&|and) (shared interest|sig)|alumni|alumnae|harvard (business|law|medical|dental|kennedy|divinity|extension|summer) school|\bhbs\b|\bhls\b|\bhks\b|\bhms\b|\bgsas\b|\bgsd\b|\bhgse\b|graduate school|chan school|school of public health|harvard (university|college)$|harvard (university|college) (press|library|museum|police|admissions|dining|athletics)|harvard gazette|harvard magazine|harvard health|harvard business review|harvard art museums|harvard kennedy|harvard medical|harvard t\.?h\.? chan|shop|store|admissions consulting|college consulting|test prep|tutoring|harvard law review|harvard educational review|clinic(al)?( program)?|varsity club|summer (workshops?|programs?|school|institute)|camps?|model united nations \w+)\b/i;

/** Graduate-school club sites often say so in the host (harvardgsdreclub.com, hbs…). */
const GRAD_HOST = /(^|[.-])(hbs|hls|hks|hms|gsd|gse|hsph|gsas|mba|law|harvardgsd|harvardhbs|harvardlaw)/i;

/** Hosts that never are a student organization's own site. */
const NOT_ORG_HOST =
  /(^|\.)(harvard\.edu|hbs\.edu|mit\.edu|wikipedia\.org|wikiwand\.com|google\.com|goo\.gl|forms\.gle|linktr\.ee|instagram\.com|facebook\.com|fb\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|youtu\.be|tiktok\.com|github\.com|reddit\.com|eventbrite\.com|medium\.com|substack\.com|crunchbase\.com|glassdoor\.com|indeed\.com|yelp\.com|niche\.com|collegevine\.com|prepscholar\.com|usnews\.com|bostonglobe\.com|nytimes\.com|wsj\.com|forbes\.com|bloomberg\.com|cnbc\.com|amazon\.com|apple\.com|spotify\.com|soundcloud\.com|bandcamp\.com|campusgroups\.com|eventive\.org|square\.site|givecampus\.com|venmo\.com|paypal\.com|gofundme\.com|thecrimson\.com|harvardmagazine\.com|pbha\.org|squarespace\.com|wix\.com|wixsite\.com|wordpress\.com|weebly\.com|mailchimp\.com|list-manage\.com|calendly\.com|zoom\.us|notion\.so|docs\.google\.com|drive\.google\.com|typeform\.com|jotform\.com|airtable\.com|discord\.gg|discord\.com|slack\.com|groupme\.com|apple\.co|bit\.ly|tinyurl\.com|harvardclub\.com|harvardclubs\.org|alumni\.harvard\.edu)$/i;

/** Club sites hosted by the Harvard Computer Society are the club's own. */
const HCS_HOSTED = /(^|\.)hcs\.harvard\.edu$/i;

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Could this host be a student organization's own site? */
export function possibleOrgHost(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (HCS_HOSTED.test(host) && host !== "hcs.harvard.edu") return true;
  return !NOT_ORG_HOST.test(host) && !GRAD_HOST.test(host.replace(/\.[a-z]+$/, ""));
}

/** Split a title into its segments: "Home | Harvard Poker Club — Cambridge" → [...]. */
export function headingSegments(heading: string): string[] {
  return heading
    .split(/\s+[|•·–—-]\s+|\s*[|•·–—]\s*|:\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 4);
}

/**
 * Is this text segment the name of a Harvard student organization? Returns the cleaned
 * name or null. "Harvard Undergraduate Poker Club" ✓, "Startups at Harvard" ✓,
 * "Harvard Club of Boston" ✗, "Harvard Business School Finance Club" ✗, "Home" ✗.
 */
export function orgNameFromSegment(segment: string): string | null {
  const s = segment
    .replace(/^(welcome to|home of|about)\s+/i, "")
    .replace(/\s*\((official )?(site|website)\)\s*$/i, "")
    .replace(/[.!]+$/, "")
    .trim();
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 12 || s.length > 90) return null;
  if (!HARVARD.test(s)) return null;
  if (EXCLUDED_NAME.test(s)) return null;
  // Sentences ("Harvard students launch a club for…") aren't names.
  if (
    /\b(is|are|was|were|has|have|launch(es|ed)?|announces?|how|why|what|when|where|we|our|your|you|join|apply|to)\b/i.test(
      s,
    )
  )
    return null;
  const atHarvard = /\b(at|of) harvard( college| university)?$/i.test(s);
  // The College's own naming convention: "Harvard College X", "Harvard Undergraduate X", "Harvard-Radcliffe X".
  const collegeStyle = /^(the )?harvard(-radcliffe| college| undergraduate| undergrad)\b/i.test(s) && words.length >= 3;
  if (!ORG_NOUN.test(s) && !atHarvard && !collegeStyle) return null;
  return s;
}

/**
 * The heading segment that names a Harvard student org, from a title/anchor text. A
 * segment with an org noun ("Harvard College Union Society") beats a tagline-like
 * "X at Harvard" ("Free Speech at Harvard").
 */
export function orgNameFromTitle(title: string): string | null {
  const names = headingSegments(title)
    .map(orgNameFromSegment)
    .filter((n): n is string => n !== null);
  return names.find((n) => ORG_NOUN.test(n)) ?? names[0] ?? null;
}

/** Commercial admissions/tutoring businesses borrowing the Harvard name. */
const COMMERCIAL =
  /\b(top \d+ universit(y|ies)|college admissions?|admissions (consulting|counseling|coaching)|enroll now|tuition fees?|our mentors? (are|include) harvard)\b/i;

const PARKED =
  /\b(domain (is |may be )?for sale|buy this domain|this domain (name )?is (parked|available)|parked (free|domain)|hugedomains|sedoparking|dan\.com|afternic)\b/i;

export interface DiscoveredOrgPage {
  name: string;
  /** The heading the name came from (evidence quote). */
  quote: string;
}

/** Does this fetched home page belong to a Harvard student organization? */
export function harvardOrgFromPage(doc: PageDocument): DiscoveredOrgPage | null {
  if (!possibleOrgHost(doc.url)) return null;
  const sample = `${doc.title ?? ""} ${doc.metaDescription ?? ""} ${doc.text.slice(0, 8000)}`;
  if (PARKED.test(sample) || COMMERCIAL.test(sample)) return null;
  if (!STUDENTS.test(sample)) return null;
  // Title first, then h1, then og:title: the title is the site's name for itself.
  const host = (hostOf(doc.url) ?? "").replace(/[^a-z0-9]/g, "");
  for (const heading of [doc.title, doc.ogTitle, doc.h1]) {
    if (!heading) continue;
    const name = orgNameFromTitle(heading);
    if (!name) continue;
    // "X at Harvard" without an org noun may be a tagline ("Free Speech at Harvard" on the
    // Union Society's site): only a name when the domain spells it (startupsatharvard.com).
    if (!ORG_NOUN.test(name) && /\bat harvard\b/i.test(name)) {
      const compact = name
        .toLowerCase()
        .replace(/^the /, "")
        .replace(/[^a-z0-9]/g, "");
      if (!host.includes(compact)) continue;
    }
    return { name, quote: heading };
  }
  return null;
}

/**
 * Links on a page we already crawled that may lead to another Harvard student org's own
 * site: external, not a platform/news/Harvard office host, and either the anchor text
 * names an org or the host carries "harvard" (harvardpoker.org, hcs-hosted sites).
 */
export function orgLinkCandidates(pageUrl: string, links: readonly DocLink[]): { root: string; hint: string }[] {
  const pageHost = hostOf(pageUrl);
  const out = new Map<string, string>();
  for (const l of links) {
    const host = hostOf(l.url);
    if (!host || host === pageHost || !possibleOrgHost(l.url)) continue;
    const anchorName = l.text ? orgNameFromTitle(l.text) : null;
    const harvardHost = /harvard|radcliffe|crimson/.test(host) || HCS_HOSTED.test(host);
    if (!anchorName && !harvardHost) continue;
    const root = `https://${host}/`;
    if (!out.has(root)) out.set(root, anchorName ?? host);
  }
  return [...out].map(([root, hint]) => ({ root, hint }));
}
