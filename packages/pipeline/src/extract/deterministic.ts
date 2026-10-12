import {
  blockingKey,
  classEligibility,
  classifyLink,
  isOwnSubdomain,
  joinQuoteScope,
  isVagueTimeReference,
  newYorkDateParts,
  normalizeAcronym,
  normalizeName,
  parseDateExpression,
  parseTermExpression,
  siteKey,
  termForDate,
  termKey,
  type JoinMode,
  type RecruitingSeason,
  type LinkKind,
  type ParseConfidence,
  type StageKind,
  type StageValue,
} from "@hci/core";
import {
  duesProblem,
  EVENT_REGISTRATION,
  eventBlurbProblem,
  eventDateProblem,
  headingAbove,
  outsiderApplicationProblem,
  namesPeopleProblem,
  navTextProblem,
  outsiderLinkProblem,
  isArticleUrl,
  isLegalPageUrl,
  laterStepDeadlineProblem,
  otherOrganizationProblem,
  selfDescribedSelectivityProblem,
  hoursProblem,
  memberCountProblem,
  joinModeProblem,
  leadershipApplicationProblem,
  rollingProblem,
  weekdayProblem,
} from "./evidence-rules";
import { applicationFormLinks, isApplicationSystemUrl, pageYears } from "../recruiting/signals";
import { siteKeyMentionsClub } from "../sites/candidates";
import type { DocBlock, DocLink, PageDocument } from "../parse/document";
import type { ExtractedClaim } from "../types";

/**
 * Deterministic extractors (CLAUDE.md §11: prefer deterministic parsing; LLM only for
 * semantics). Conservative by design: a pattern that could plausibly mean something
 * else is not emitted. Every claim carries the verbatim sentence as its quote and the
 * block index as its locator.
 */
export const DETERMINISTIC_EXTRACTOR = { name: "site-deterministic", version: "1.16.26" } as const;

/** A numeric or "Month D" date, to tell where a fragment moves on to a second date. */
const DATE_TOKEN_G =
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/gi;

/** Text about applying to the club rather than about what it does. */
const APPLICATION_TALK =
  /\b(appl(y|ying|icants?|ications?)|interviews?|written portion|submit|deadline|recruitment process)\b/i;

export type PageRole =
  "home" | "about" | "join" | "recruiting" | "faq" | "team" | "events" | "projects" | "sponsors" | "contact" | "other";

export interface ExtractContext {
  doc: PageDocument;
  role: PageRole;
  /** Snapshot fetch time: the ONLY reference for resolving relative dates. */
  fetchedAt: Date;
  /** Names/acronyms we know for the club (for identity checks and link filtering). */
  clubNames: string[];
  clubAcronyms: string[];
  /** Page is a directory's page ABOUT the club (PBHA/IOP/career center/Wikipedia), not its own site. */
  directoryPage?: boolean;
}

/** Hosts that are never a club's own website. */
const NOT_OWN_SITE =
  /(^|\.)(harvard\.edu|wikipedia\.org|wikimedia\.org|wikidata\.org|google\.com|goo\.gl|doi\.org|archive\.org|worldcat\.org|jstor\.org|nytimes\.com|thecrimson\.com|bostonglobe\.com|pbha\.org|youtu\.be|apple\.com|spotify\.com|amazon\.com)$/i;
const WEBSITE_LABEL = /\b(website|homepage|home page|official site|web site|visit (?:us|our site|the site))\b/i;

/** Distinctive tokens of a club's names/acronyms, for matching a domain like krokodiloes.com. */
function distinctiveTokens(names: string[], acronyms: string[]): string[] {
  const generic = new Set([
    "harvard",
    "college",
    "undergraduate",
    "society",
    "association",
    "club",
    "organization",
    "program",
    "student",
    "students",
    "team",
    "group",
    "the",
    "and",
    "for",
    "radcliffe",
    "university",
    "council",
  ]);
  const tokens = names.flatMap((n) => normalizeName(n).split(" ")).filter((t) => t.length >= 5 && !generic.has(t));
  return [...new Set([...tokens, ...acronyms.map((a) => a.toLowerCase()).filter((a) => a.length >= 3)])];
}

const CONF: Record<ParseConfidence, number> = { high: 1, medium: 0.85, low: 0.6 };

/**
 * Sentence boundary: . ! ? then space then a capital, digit or quote — but not after an
 * abbreviation ("Sep. 14", "Dr. Lee", "U.S. students"), which split dates in two before 1.9.0.
 */
export const SENTENCE_BREAK =
  /(?<!\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun|St|Dr|Mr|Mrs|Ms|Prof|No|Nos|vs|Inc|Jr|Sr|Ave|Rm|approx|e\.g|i\.e|U\.S|a\.m|p\.m)\.)(?<=[.!?])\s+(?=[A-Z0-9"“(])/;

function sentences(b: DocBlock): string[] {
  return b.text
    .split(SENTENCE_BREAK)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

function* eachSentence(doc: PageDocument): Generator<{ block: DocBlock; sentence: string }> {
  for (const block of doc.blocks) for (const sentence of sentences(block)) yield { block, sentence };
}

const claim = (
  base: Omit<ExtractedClaim, "extractionMethod" | "isDirect" | "assertionKind"> & {
    assertionKind?: "stated" | "inferred";
  },
): ExtractedClaim => ({
  extractionMethod: "html_parse",
  assertionKind: base.assertionKind ?? "stated",
  isDirect: (base.assertionKind ?? "stated") === "stated",
  ...base,
});

const loc = (ctx: ExtractContext, block: DocBlock | null, extra: Record<string, unknown> = {}) => ({
  url: ctx.doc.url,
  role: ctx.role,
  ...(block ? { block: block.index, section: block.section } : {}),
  ...extra,
});

// --- Identity -----------------------------------------------------------------------------

/**
 * Is a heading token the club's acronym as written? Case counts: an all-caps token
 * ("HUCG", "H.U.C.G.") matches whatever the club's casing, and a mixed-case acronym only
 * as the club writes it, so the word "New" never stands for "NeW". PURE.
 */
export function acronymTokenMatches(token: string, acronym: string): boolean {
  const want = normalizeAcronym(acronym);
  if (want.length < 3) return false;
  const bare = token.replace(/[^\p{L}\p{N}]/gu, "");
  if (normalizeAcronym(bare) !== want) return false;
  const letters = bare.replace(/[^\p{L}]/gu, "");
  return letters === letters.toUpperCase() || bare === acronym.replace(/[^\p{L}\p{N}]/gu, "");
}

/** Does the page title / h1 / og:title name this club? (evidence for "probable official site") */
export function pageNamesClub(doc: PageDocument, names: string[], acronyms: string[]): string | null {
  const targets = [doc.title, doc.h1, doc.ogTitle].filter((t): t is string => Boolean(t));
  const normNames = names.map(normalizeName).filter((n) => n.split(" ").length >= 2);
  for (const t of targets) {
    const nt = ` ${normalizeName(t)} `;
    if (normNames.some((n) => nt.includes(` ${n} `))) return t;
    const tokens = t.split(/[\s|:–—-]+/);
    if (acronyms.some((a) => tokens.some((tok) => acronymTokenMatches(tok, a)))) return t;
  }
  return null;
}

/**
 * Spellings of a club's name its own, already linked website may use: the name before a colon
 * subtitle ("The John Adams Society: A Harvard Undergraduate Debating Society"), without a
 * leading "PBHA's" or a trailing "Club", "A Cappella", "Program" or "Inc.", and with "College"
 * and "Undergraduate" swapped (both undergraduate). Dropping "Undergraduate" altogether is never
 * a variant (CLAUDE.md §3: "Harvard X Society" may be a different organization). Each keeps two
 * words, at least one distinctive. Only for re-confirming a linked site, never for finding one.
 * PURE.
 */
export function linkedSiteNameVariants(names: string[]): string[] {
  const out = new Set<string>();
  const trims: [RegExp, string][] = [
    [/^pbhas /, ""],
    [/ (?:club|a cappella|program|inc)$/, ""],
  ];
  for (const name of names) {
    for (const base of new Set([name, name.split(":")[0] ?? name])) {
      let forms = [normalizeName(base)];
      for (const [re, by] of trims) forms = [...forms, ...forms.map((f) => f.replace(re, by))];
      for (const f of [...forms]) {
        const padded = ` ${f} `;
        if (padded.includes(" college ")) forms.push(padded.replace(" college ", " undergraduate ").trim());
        if (padded.includes(" undergraduate ")) forms.push(padded.replace(" undergraduate ", " college ").trim());
      }
      for (const f of forms) if (f.split(" ").length >= 2 && blockingKey(f) !== "") out.add(f);
    }
  }
  return [...out];
}

/**
 * The linked site's host spells the club's name, exactly ("harvardundergraduatethinktank.org",
 * "apichorus.org" for "ApiChorus A Cappella"): its registered name (the label before the
 * top-level domain) is a name or variant with the spaces taken out. A one-word spelling needs 8+ letters. Returns the host. PURE.
 */
export function hostSpellsClubName(url: string, names: string[]): string | null {
  let host: string;
  try {
    const u = new URL(url);
    // A site's root only: a page deeper in it ("/executive-committee.html") must name the club itself.
    if (u.pathname !== "/" && u.pathname !== "") return null;
    host = u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  // The registered name: "forms.harvardyearbook.com" → "harvardyearbook".
  const parts = host.split(".");
  const label = parts.length >= 2 ? (parts[parts.length - 2] ?? "") : "";
  const spellings = [...names.map(normalizeName), ...linkedSiteNameVariants(names)].flatMap((n) => {
    const t = n.replace(/ (?:club|a cappella|program|inc)$/, "");
    return [n, t];
  });
  for (const n of spellings) {
    const words = n.split(" ").filter(Boolean);
    const compact = words.join("");
    if (blockingKey(n) === "") continue;
    if (words.length < 2 && compact.length < 8) continue;
    if (compact === label) return host;
  }
  return null;
}

// --- Links --------------------------------------------------------------------------------

/** Institutional/platform accounts that commonly appear on club sites but are not the club's. */
const FOREIGN_HANDLES = new Set([
  "harvard",
  "harvardcollege",
  "harvarduniversity",
  "thecrimson",
  "harvardfas",
  "harvardseas",
  "harvardgazette",
  "squarespace",
  "wix",
  "wordpress",
  "wordpressdotcom",
  "weebly",
  "github",
  "google",
  "linktree",
  "instagram",
  "facebook",
  "twitter",
  "x",
  "youtube",
  "tiktok",
  "linkedin",
  // Directory publishers' own accounts (seen on their pages about individual clubs).
  "pbha",
  "pbhaboston",
  "phillipsbrookshouse",
  "harvardiop",
  "harvardinstituteofpolitics",
  "iop",
  "harvardcareers",
  "harvardmignone",
  "mignonecenter",
  "harvardocs",
  "harvardinnovationlabs",
  "innovationlabs",
  "harvardilab",
  "wikipedia",
  "harvardrec",
  "harvardrecreation",
  "harvardathletics",
  "gocrimson",
  "harvardgsas",
  "harvardkennedyschool",
]);
const SOCIAL_KINDS: LinkKind[] = [
  "instagram",
  "linkedin",
  "facebook",
  "x",
  "youtube",
  "tiktok",
  "github",
  "discord",
  "link_in_bio",
];
const APPLY_TEXT =
  /\b(apply|application|join|recruit(?:ing|ment)?|comp(?:ing)?|get involved|sign ?up|interest form)\b/i;
const FORM_HOSTS =
  /(^|\.)(forms\.gle|docs\.google\.com|typeform\.com|airtable\.com|jotform\.com|forms\.office\.com|tally\.so)$/i;

/**
 * Values in a "Website" row of an infobox-style table (label cell followed by value cell),
 * e.g. Wikipedia's infobox: | Website | kroks.com |. Normalized for comparison with link text.
 */
function labelledWebsiteTexts(doc: PageDocument): Set<string> {
  const out = new Set<string>();
  doc.blocks.forEach((b, i) => {
    const next = doc.blocks[i + 1];
    if (
      b.kind === "table_cell" &&
      /^(official )?(website|web site|homepage)$/i.test(b.text.trim()) &&
      next?.kind === "table_cell"
    )
      out.add(next.text.trim().toLowerCase());
  });
  return out;
}

const IDENTITY_ROLES = new Set(["home", "about", "contact", "join", "recruiting", "faq"]);
const NOT_JOINING_ROLES = new Set(["events", "team", "sponsors", "projects", "news", "blog"]);
const FORM_KINDS = new Set(["application_form", "application_page", "mailing_list", "newsletter"]);

/** Link text that says nothing on its own: "here", "this page", "learn more". */
const GENERIC_LINK_TEXT =
  /^(?:click |tap )?(?:here|this (?:link|page|(?:google |online )?form|website|site)|link|learn more|read more|find out more|see more|more(?: info(?:rmation)?)?|details)[.!]?$/i;
/** A mailing-list or newsletter sign-up in a link's own text ("Join our mailing list", "Newsletter"). */
const MAILING_LIST_WORDING =
  /\b(mailing list|newsletter|subscribe|listserv|stay (?:updated|in touch)|(?:be|get) notified|notifications? about)\b/i;
/**
 * The same in the sentence around a generic link ("To be notified about future events …, fill
 * out this google form", 1.16.21). A newsletter named there is not enough: "to submit an
 * announcement to the newsletter, please use this form" is a submission form.
 */
const MAILING_LIST_SENTENCE =
  /\b(mailing list|subscribe|listserv|stay (?:updated|in touch)|(?:be|get) notified|notifications? about)\b/i;
/** "Fill out our interest form here": the first step of joining, not a mailing list (1.16.23). */
const INTEREST_FORM = /\binterest form\b/i;

/**
 * The sentence a generic body link sits in, when the link text occurs in it exactly once
 * in its paragraph: "Learn more about our Fall 2026 comp [here]." (1.16.17).
 */
function linkSentence(link: DocLink): string | null {
  const text = link.text.trim();
  if (!link.context || !GENERIC_LINK_TEXT.test(text)) return null;
  const word = new RegExp(`(?<![\\w'’])${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w'’])`, "gi");
  if ((link.context.match(word) ?? []).length !== 1) return null;
  return link.context.split(/(?<=[.!?])\s+/).find((s) => new RegExp(word.source, "i").test(s)) ?? null;
}

/** What says a form is a mailing-list sign-up: its own text, or a generic link's sentence. Null when nothing does. */
function mailingWording(link: DocLink): string | null {
  if (MAILING_LIST_WORDING.test(link.text)) return link.text;
  const sentence = linkSentence(link);
  return sentence && MAILING_LIST_SENTENCE.test(sentence) && !INTEREST_FORM.test(sentence) ? sentence : null;
}

/**
 * What says a link is how to apply, verbatim: its own text ("Apply", "Join us"), or for a
 * generic link ("here") the sentence around it, unless that sentence is about a leadership
 * role or an article. Null when neither does.
 */
function applyWording(link: DocLink): string | null {
  if (APPLY_TEXT.test(link.text)) return link.text;
  const sentence = linkSentence(link);
  if (!sentence || !APPLY_TEXT.test(sentence) || isArticleUrl(link.url)) return null;
  if (leadershipApplicationProblem(sentence) || outsiderLinkProblem(sentence)) return null;
  return sentence;
}

/**
 * Page titles without the club's own name: "Harvard Undergraduate Capital Partners" is not a
 * partner form, nor "Alumni Association" … an alumni one (1.13.5).
 */
function ownNamesOut(ctx: ExtractContext, ...texts: (string | null | undefined)[]): (string | null)[] {
  const names = [...ctx.clubNames, ...ctx.clubAcronyms]
    .filter((n) => n.length >= 3)
    .sort((a, b) => b.length - a.length);
  return texts.map((t) => {
    if (!t) return null;
    let out = t;
    for (const n of names) out = out.split(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")).join(" ");
    return out;
  });
}

/**
 * The section heading a body link's paragraph sits under ("### Member Grants", "### Startup
 * Trek"): a form there is for that program, not for joining (1.16.26). The club's own names
 * are left out, as for page titles.
 */
function linkHeading(ctx: ExtractContext, link: DocLink): string | null {
  if (link.chrome) return null;
  // A link alone in its paragraph has no context: its own text, when the page has it once.
  const anchor = link.context ?? (link.text && ctx.doc.text.split(link.text).length === 2 ? link.text : null);
  return anchor ? (ownNamesOut(ctx, headingAbove(ctx.doc.text, anchor))[0] ?? null) : null;
}

/** A social handle that carries the club's own name or acronym ("huaphq", "hu.plant.based"). */
function handleNamesClub(handle: string | null | undefined, ctx: ExtractContext): boolean {
  if (!handle) return false;
  const acronym = ctx.clubAcronyms[0] ?? null;
  return ctx.clubNames.some((name) => siteKeyMentionsClub(handle, { name, acronym, aliases: [] }));
}

export function extractLinks(ctx: ExtractContext): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  const labelledSites = ctx.directoryPage ? labelledWebsiteTexts(ctx.doc) : new Set<string>();
  const ownSite = siteKey(ctx.doc.url);
  const acronyms = ctx.clubAcronyms.map((a) => a.toLowerCase());
  const nameTokens = ctx.clubNames.flatMap((n) => normalizeName(n).split(" ")).filter((t) => t.length >= 4);
  // Links in the body of a page that isn't about the club itself (a news post, a sponsors
  // or team page, a publication's article) point at other people's accounts and forms: the
  // Independent's "No Varsity, No Problem" links four club teams' Instagrams (1.13.1).
  const identityPage = ctx.directoryPage || (IDENTITY_ROLES.has(ctx.role) && !isArticleUrl(ctx.doc.url));
  for (const link of ctx.doc.links) {
    // Header/footer links repeat on every page; record them once, from the home page.
    // …except the Apply button in the header of a joining page, which is current there.
    const joiningPage = ctx.role === "join" || ctx.role === "recruiting";
    if (link.chrome && ctx.role !== "home" && !(joiningPage && APPLY_TEXT.test(link.text))) continue;
    const c = classifyLink(link.url);
    if (!c || c.isPersonal || c.isContentItem) continue;
    if (!link.chrome && !identityPage && c.kind !== "email" && !handleNamesClub(c.handle, ctx)) {
      // A form or mailing list in the body of the club's own volunteer/students/auditions
      // page is the club's; one on an events, team, sponsors or project page, or in an
      // article, is for something else (an event, a program, a partner).
      const formLike = FORM_KINDS.has(c.kind) || isApplicationSystemUrl(c.url);
      if (!formLike || NOT_JOINING_ROLES.has(ctx.role) || isArticleUrl(ctx.doc.url)) continue;
    }
    if (c.handle && FOREIGN_HANDLES.has(c.handle.toLowerCase())) continue;

    if (c.kind === "email") {
      // Only role/club addresses — never an individual's email (CLAUDE.md §21).
      const [local = "", domain = ""] = (c.handle ?? "").split("@");
      const clubLike =
        acronyms.some((a) => local.includes(a)) ||
        nameTokens.some((t) => local.includes(t)) ||
        (ownSite !== null && domain !== "" && ownSite.startsWith(domain)) ||
        /^(info|contact|board|hello|team|admin|exec|officers|recruit|recruiting|join|apply)\b/.test(local);
      if (!clubLike) continue;
      out.push(
        claim({
          fieldKey: "club.link",
          value: { kind: "email", url: c.url, handle: c.handle },
          quote: link.text || c.url,
          locator: loc(ctx, null, { href: link.url }),
        }),
      );
      continue;
    }

    // A subdomain of the club's own site is the club's too (`isOwnSubdomain`, 1.16.17–18),
    // except on a directory page, whose subdomains are other groups'.
    const inSite =
      ownSite !== null && (siteKey(link.url) === ownSite || (!ctx.directoryPage && isOwnSubdomain(link.url, ownSite)));
    if (inSite) {
      // Internal application/recruiting page.
      const wording = applyWording(link);
      if (
        wording &&
        (!link.chrome || ctx.role === "home") &&
        !outsiderLinkProblem(link.text, link.url, linkHeading(ctx, link))
      ) {
        out.push(
          claim({
            fieldKey: "club.link",
            value: {
              kind: "application_page",
              url: c.url,
              ...(wording === link.text ? { label: link.text.slice(0, 80) } : {}),
            },
            quote: wording,
            locator: loc(ctx, null, { href: link.url }),
          }),
        );
      }
      continue;
    }

    const host = (() => {
      try {
        return new URL(link.url).hostname;
      } catch {
        return "";
      }
    })();
    const mailing = FORM_HOSTS.test(host) ? mailingWording(link) : null;
    if (mailing) {
      out.push(
        claim({
          fieldKey: "club.link",
          value: { kind: "mailing_list", url: c.url, label: link.text.slice(0, 80) },
          quote: mailing,
          locator: loc(ctx, null, { href: link.url }),
        }),
      );
      continue;
    }
    // An application form: the anchor says "apply", or a joining/recruiting page links it
    // as its form (not feedback, merch or RSVP forms).
    if (
      isApplicationSystemUrl(link.url) &&
      !outsiderLinkProblem(
        link.text,
        ctx.doc.url,
        linkHeading(ctx, link),
        ...ownNamesOut(ctx, ctx.doc.h1, ctx.doc.title),
      ) &&
      (APPLY_TEXT.test(link.text) ||
        ((ctx.role === "join" || ctx.role === "recruiting") && applicationFormLinks(ctx.doc, true).includes(link)))
    ) {
      out.push(
        claim({
          fieldKey: "club.link",
          value: { kind: "application_form", url: c.url, label: link.text.slice(0, 80) },
          quote: link.text,
          locator: loc(ctx, null, { href: link.url }),
        }),
      );
      continue;
    }
    // On a directory's page about the club: the club's own website, if clearly identified.
    if (ctx.directoryPage && c.kind === "website" && !link.chrome && !NOT_OWN_SITE.test(host.replace(/^www\./, ""))) {
      const domain = host
        .replace(/^www\./, "")
        .split(".")
        .slice(0, -1)
        .join(".");
      const tokens = distinctiveTokens(ctx.clubNames, ctx.clubAcronyms);
      const inWebsiteRow = labelledSites.has(link.text.trim().toLowerCase());
      if (inWebsiteRow || WEBSITE_LABEL.test(link.text) || tokens.some((t) => domain.includes(t))) {
        out.push(
          claim({
            fieldKey: "club.link",
            value: { kind: "website", url: c.url },
            quote: inWebsiteRow ? `Website: ${link.text}` : link.text || c.url,
            locator: loc(ctx, null, { href: link.url, from: "directory_page" }),
          }),
        );
      }
      continue;
    }
    if (SOCIAL_KINDS.includes(c.kind) || c.kind === "mailing_list" || c.kind === "newsletter") {
      out.push(
        claim({
          fieldKey: "club.link",
          value: { kind: c.kind, url: c.url, handle: c.handle },
          quote: link.text || c.url,
          locator: loc(ctx, null, { href: link.url, chrome: link.chrome }),
        }),
      );
    }
  }
  return out;
}

// --- Descriptions -------------------------------------------------------------------------

const GENERIC_DESC =
  /^(welcome|home|coming soon|just another|a new site|this is a|lorem ipsum|powered by|stay (?:updated|tuned|connected)|learn more|official (?:website|site)|click|sign up|subscribe)/i;

/** Calls to action, prices and page furniture: not a description of the club. */
const NOT_ABOUT =
  /\b(subscri(?:be|ption)|inquiries|fill out the form|share your feedback|costs \$|this article is about|join us (?:on|this)|register (?:now|here)|i (?:co-)?founded)\b|\$\d|<img\b/i;

/**
 * A dated recruiting notice ("Auditions for our fall 2026 production … will be held on Monday,
 * September 14"): true for one round, then stale on the profile. Not a description (1.16.19).
 */
const DATED_NOTICE =
  /^(?:the\s+)?(?:auditions?|applications?|tryouts?|comps?|info(?:rmation)?\s+sessions?|interest\s+meetings?|recruitment|sign[- ]?ups?)\b[^.!?]{0,160}\b(?:will be held|are due|is due|due|(?:are|is) (?:now )?open|open|close[sd]?|begins?|starts?)\b[^.!?]{0,80}\b(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}|\d{1,2}\/\d{1,2})\b/i;

/** Text about an individual person (bios, member profiles) — never used as club data. */
const PERSONAL =
  /\b(?:lived in|concentrat(?:ed|es|ing) in|class of|is a (?:first-year|freshman|sophomore|junior|senior)|(?:he|she) (?:is|was|studies|grew up)|his |her |hometown|in (?:his|her|their) free time)\b|(?<![\w‘’'])['‘’][0-9]{2}\b(?!['’])/i;

/** Prose-like (not a nav/menu dump): mostly letters, has sentence punctuation, few separators. */
function isProse(text: string): boolean {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const separators = (text.match(/\||•|·|\uFE0E|→|►|»/g) ?? []).length;
  return letters / Math.max(1, text.length) > 0.7 && /[.!?]/.test(text) && separators <= 2;
}

/** Is the paragraph about the organization (mentions it, or speaks as "we/our")? */
/** Directory/site disclaimers that are never about a club. */
const BOILERPLATE =
  /\b(inclusion of external content|does not (?:necessarily )?constitute (?:an )?endorsement|is committed to ensuring access|all rights reserved|privacy policy|terms of use)\b/i;

function aboutTheClub(text: string, ctx: ExtractContext): boolean {
  if (BOILERPLATE.test(text)) return false;
  // "At College Ready, our mission is…": a sponsor or advertiser speaking (1.11.0).
  if (
    otherOrganizationProblem(text, {
      name: ctx.clubNames[0] ?? "",
      acronym: ctx.clubAcronyms[0] ?? null,
      aliases: ctx.clubNames.slice(1),
    })
  )
    return false;
  const nt = ` ${normalizeName(text)} `;
  // On a directory's page, "we/our" is the directory speaking — require the club to be named.
  if (!ctx.directoryPage && /\b(we|our|us)\b/i.test(text)) return true;
  if (ctx.clubNames.some((n) => normalizeName(n).length > 3 && nt.includes(` ${normalizeName(n)} `))) return true;
  const acronyms = [
    ...ctx.clubAcronyms,
    ...ctx.clubNames.map((n) => /\(([A-Za-z][A-Za-z0-9&.-]{1,14})\)\s*$/.exec(n)?.[1] ?? "").filter(Boolean),
  ];
  if (acronyms.some((a) => a.length >= 3 && new RegExp(`\\b${a.replace(/[.&-]/g, "\\$&")}\\b`).test(text))) return true;
  // A distinctive word of the club's name (e.g. "Chinatown", "Biotechnology") in the paragraph.
  return distinctiveTokens(ctx.clubNames, []).some((t) => nt.includes(` ${t} `));
}

/**
 * Text that is never club data: it names individual people (class years, credits, leaders) or is
 * one show's blurb (1.16.24, ADR 0033 amendment). Shared with LLM grounding and the audit.
 */
function peopleOrBlurb(text: string, ctx: ExtractContext): boolean {
  return Boolean(namesPeopleProblem(text, ctx.clubNames) ?? eventBlurbProblem(text));
}

export function extractDescriptions(ctx: ExtractContext): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  // A post's title and lede describe the post, not the club (1.11.0).
  if (isArticleUrl(ctx.doc.url)) return out;
  if (ctx.role === "home" || ctx.role === "about") {
    const meta = ctx.doc.metaDescription ?? ctx.doc.ogDescription;
    if (
      meta &&
      meta.length >= 40 &&
      meta.length <= 400 &&
      !GENERIC_DESC.test(meta) &&
      !PERSONAL.test(meta) &&
      !peopleOrBlurb(meta, ctx) &&
      isProse(meta)
    ) {
      out.push(
        claim({
          fieldKey: "club.short_description",
          value: meta,
          quote: meta,
          locator: loc(ctx, null, { from: "meta_description" }),
        }),
      );
    }
  }
  if (ctx.role === "about" || ctx.role === "home") {
    const para = ctx.doc.blocks.find(
      (b) =>
        b.kind === "paragraph" &&
        b.text.length >= 120 &&
        b.text.length <= 2000 &&
        !GENERIC_DESC.test(b.text) &&
        !PERSONAL.test(b.text) &&
        !peopleOrBlurb(b.text, ctx) &&
        !NOT_ABOUT.test(b.text) &&
        !DATED_NOTICE.test(b.text) &&
        !navTextProblem(b.text) &&
        isProse(b.text) &&
        aboutTheClub(b.text, ctx),
    );
    if (para)
      out.push(
        claim({ fieldKey: "club.long_description", value: para.text, quote: para.text, locator: loc(ctx, para) }),
      );
  }
  const mission = ctx.doc.blocks.find(
    (b) =>
      b.kind === "paragraph" &&
      aboutTheClub(b.text, ctx) &&
      /\b(our mission|mission is|we aim to|our goal is)\b/i.test(b.text) &&
      // "Here, we aim to get a sense of your motivations for applying" describes the
      // application, not the club (1.7.2). A stated "mission" is still taken.
      (/\bmission\b/i.test(b.text) || !APPLICATION_TALK.test(b.text)) &&
      b.text.length <= 1200 &&
      !PERSONAL.test(b.text) &&
      !peopleOrBlurb(b.text, ctx) &&
      !navTextProblem(b.text) &&
      isProse(b.text),
  );
  if (mission)
    out.push(claim({ fieldKey: "club.mission", value: mission.text, quote: mission.text, locator: loc(ctx, mission) }));
  return out;
}

// --- Joining ------------------------------------------------------------------------------

const JOIN_PATTERNS: [JoinMode, RegExp][] = [
  [
    "comp",
    /\b(?:our|the|a|this semester's|fall|spring)\s+comp\b|\bcomp(?:ing)?\s+(?:process|period|program|season|requirements?)\b|\bto comp\b|\bcompers\b/i,
  ],
  [
    "application",
    /\b(?:applications?\s+(?:are\s+)?(?:now\s+)?(?:open|due|close|closes|will open|for (?:the )?(?:fall|spring|new members?))|apply (?:now|here|today|to join|by)|application (?:form|process|deadline))\b/i,
  ],
  ["audition", /\baudition(?:s|ing)?\b/i],
  ["tryout", /\btry-?outs?\b/i],
  [
    "invite_only",
    /\b(?:by invitation only|invitation[- ]only|invite[- ]only|membership is by invitation|(?:new )?members are (?:invited|tapped|punched)|punch(?:ing)? (?:process|season))\b/i,
  ],
  [
    "attendance_based",
    /\b(?:membership is based on attendance|attend(?:ing)? (?:at least )?(?:\w+ ){0,2}(?:meetings|practices|rehearsals|events) (?:to|in order to) (?:become|be considered|count as) (?:a )?(?:full |voting )?members?|attendance[- ]based membership)\b/i,
  ],
  [
    "open",
    /\b(?:open to all(?: students| undergraduates)?|all are welcome|everyone is welcome|anyone (?:can|may) join|open membership|no application (?:is )?(?:required|necessary|needed)|no (?:auditions?|try-?outs?|cuts) (?:required|necessary|needed)?|non-?audition(?:ed)?|just show up|drop[- ]in)\b/i,
  ],
];

/** "No auditions", "without a tryout": the opposite of the selective pathway named. */
const NEGATED_PROCESS =
  /\b(?:no|without(?: an?)?|not require (?:an? )?|non-?)\s*(?:auditions?|try-?outs?|applications?|comp(?:ing)?|cuts)\b/i;

export function extractJoinModes(ctx: ExtractContext): ExtractedClaim[] {
  if (!["home", "about", "join", "recruiting", "faq"].includes(ctx.role)) return [];
  const out: ExtractedClaim[] = [];
  const seen = new Set<JoinMode>();
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    for (const [mode, re] of JOIN_PATTERNS) {
      if (seen.has(mode) || !re.test(sentence)) continue;
      if (mode !== "open" && mode !== "invite_only" && NEGATED_PROCESS.test(sentence)) continue;
      // Open membership about an event, a negated process ("we do not … require auditions"), a
      // job ad or outsiders' application, a board or venue application (shared rule, 1.16.0).
      if (joinModeProblem(mode, sentence, mode === "open" ? "" : ctx.doc.text)) continue;
      seen.add(mode);
      out.push(
        claim({
          fieldKey: "club.join_mode",
          value: mode,
          quote: sentence,
          locator: loc(ctx, block),
          confidenceFactor: 0.9,
        }),
      );
    }
  }
  return out;
}

// --- Logo -----------------------------------------------------------------------------------
// Logos are chosen by the logos stage (stages/logos.ts) from the site's root page, with the
// candidate images measured; this extractor no longer claims them (1.16.16).

// --- Recruiting pattern ("we recruit every fall and spring") -------------------------------

const SEASON_WORD = "(fall|autumn|spring|summer|winter)";
/** A season named as a recurring time, not one instance ("this fall", "Fall 2026"). */
const SEASON_PATTERN = new RegExp(
  `\\b(?:every|each|in the|during the|at the (?:start|beginning) of (?:the |each |every )?)\\s*${SEASON_WORD}(?:\\s*(?:and|&|or|\\/)\\s*(?:the\\s+)?${SEASON_WORD})?(?!\\s*(?:of\\s+)?20\\d\\d)\\b|\\b${SEASON_WORD}\\s*(?:and|&|\\/)\\s*${SEASON_WORD}\\s+(?:semesters?|terms?|comps?|recruit\\w*|cycles?)\\b`,
  "gi",
);
const EVERY_SEMESTER = /\b(every|each) semester\b|\bsemesterly\b|\btwice a year\b/i;
const ROLLING =
  /\b(on a rolling basis|rolling (admissions?|applications?|basis)|year-round|any time during the (semester|year))\b/i;
const SEASON_OF: Record<string, RecruitingSeason> = {
  fall: "fall",
  autumn: "fall",
  spring: "spring",
  summer: "summer",
  winter: "winter",
};

/** Seasons a sentence says the club recurrently recruits in. PURE. */
export function recruitingSeasonsIn(sentence: string): RecruitingSeason[] {
  if (!RECRUITING_CONTEXT.test(sentence) && !/\b(comps|recruits|tryouts)\b/i.test(sentence)) return [];
  const out = new Set<RecruitingSeason>();
  for (const m of sentence.matchAll(SEASON_PATTERN)) {
    for (const g of m.slice(1)) {
      const season = g ? SEASON_OF[g.toLowerCase()] : undefined;
      if (season) out.add(season);
    }
  }
  if (EVERY_SEMESTER.test(sentence)) {
    out.add("fall");
    out.add("spring");
  }
  if (ROLLING.test(sentence) && !rollingProblem(sentence)) out.add("rolling");
  return [...out].sort();
}

export function extractRecruitingSeasons(ctx: ExtractContext): ExtractedClaim[] {
  if (!["home", "about", "join", "recruiting", "faq"].includes(ctx.role)) return [];
  let best: { seasons: RecruitingSeason[]; sentence: string; block: DocBlock } | null = null;
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    const seasons = recruitingSeasonsIn(sentence);
    if (seasons.length && outsiderApplicationProblem(sentence, ctx.doc.text)) continue;
    // When the board or trip leaders are picked isn't when members join (1.16.12).
    if (seasons.length && (joinQuoteScope(sentence).scope === "role" || leadershipApplicationProblem(sentence)))
      continue;
    if (seasons.length > (best?.seasons.length ?? 0)) best = { seasons, sentence, block };
  }
  if (!best) return [];
  return [
    claim({
      fieldKey: "club.recruiting_seasons",
      value: best.seasons,
      quote: best.sentence,
      locator: loc(ctx, best.block),
      confidenceFactor: 0.9,
    }),
  ];
}

// --- Recruiting dates -----------------------------------------------------------------------

const DEADLINE_CUE =
  /\b(deadline|due|apply by|submit(?:ted)? by|clos(?:e|es|ed|ing)|last day to apply|no later than|(?:open|accepted|accepting|available|live)\s+(?:\w+\s+){0,3}?until)\b/i;
// "Decision released: Nov 16" is when results come out, not when applications open (1.7.1).
const OPENS_CUE =
  /\b(open(?:s|ing)?|will open|launch(?:es)?|begin(?:s)?|start(?:s)?|(?<!\b(?:decisions?|results?|offers?|notifications?|admissions?)\s{0,3})release[sd]?)\b/i;
/**
 * A process window stated as a range: "our comp will run from Sep. 14 to Sep. 22",
 * "auditions take place from October 3 through October 5" (1.9.0). The end is when the
 * process closes, so a finished comp no longer reads as "started, no deadline".
 */
const WINDOW_DATE = String.raw`(?:[A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)`;
const PROCESS_WINDOW = new RegExp(
  String.raw`\b(?:comp(?:ing)?|applications?|auditions?|try-?outs?|recruit(?:ing|ment))\b[^;]{0,40}?\b(?:runs?|will run|is open|are open|open|takes? place|will take place)\s+from\s+(${WINDOW_DATE})\s+(?:to|through|thru|until|–|-)\s+(${WINDOW_DATE})`,
  "i",
);
/**
 * Auditions or tryouts held on listed days: "Auditions for the Fallen Angels will take
 * place: Saturday September 5, 12:30-2:30PM | Farkas Hall Sunday, September 6, …". The
 * last listed day is the last chance to audition, so it closes the window (1.13.0). Not for
 * comps or info sessions, which go on after their first meeting.
 */
const AUDITION_DAYS =
  /\b(?:auditions?|try-?outs?)\b[^.]{0,60}?\b(?:will (?:take place|be held)|takes? place|are (?:being )?held|are scheduled)\b\s*(?:on|:)?/i;
const MONTH_NAME = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
// Month names only: "Memorial Hall 029" is a room, not a date.
const WINDOW_DATE_G = new RegExp(
  String.raw`(?:\b${MONTH_NAME}\.?\s+\d{1,2}(?!\d)(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)`,
  "g",
);
/**
 * A deadline label on its own line with the date on the next one, a common page-builder
 * layout: "First Round Application Due" / "Thursday, September 10th" (1.13.0).
 */
const DEADLINE_LABEL =
  /^(?:[\w-]+\s+){0,3}?(?:applications?|apps?|interest forms?)\s+(?:are\s+)?(?:due|close|deadline)$/i;
const BARE_DATE =
  /^(?:[A-Z][a-z]+,?\s+)?(?:[A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?:\s*(?:at|@|,|\|)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))?$/;

/** "9/11: Applications Due", "Sept. 12 – Applications close": a dated timeline entry. */
const TIMELINE_DEADLINE =
  /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|[A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?)\s*[:–—-]\s*(?:\w+\s+){0,3}?(?:applications?|apps?)\s+(?:are\s+)?(?:due|close|closes|deadline)\b/i;
const RECRUITING_CONTEXT =
  /\b(appl(?:y|ications?)|recruit(?:ing|ment)?|comp(?:ing)?|auditions?|try-?outs?|interest form)\b/i;
const DAY = 86_400_000;

/**
 * Months (inclusive, 1-12, possibly in the previous year) in which a term's recruiting dates
 * can fall: spring recruiting starts the previous fall; fall recruiting can open in April.
 */
function termWindow(key: string): { from: number; to: number } {
  const [ys, season] = key.split("-") as [string, string];
  const y = Number(ys);
  const at = (yy: number, mm: number) => yy * 12 + (mm - 1);
  if (season === "spring") return { from: at(y - 1, 10), to: at(y, 5) };
  if (season === "summer") return { from: at(y, 1), to: at(y, 8) };
  if (season === "winter") return { from: at(y - 1, 10), to: at(y, 2) };
  return { from: at(y, 4), to: at(y, 12) };
}

/** A date fits a term when it falls in that term's recruiting window. PURE. */
export function dateFitsTerm(dateAt: string, key: string): boolean {
  const [y, m] = dateAt.slice(0, 7).split("-").map(Number) as [number, number];
  const w = termWindow(key);
  const t = y * 12 + (m - 1);
  return t >= w.from && t <= w.to;
}

/**
 * The recruiting term a dated sentence belongs to: an explicit term in the sentence, else in
 * its section heading, else the term the date itself falls in. An explicit term the date
 * can't belong to (a "Fall 2025" heading over a 2026 date) makes the date ambiguous: null.
 */
function cycleTermFor(sentence: string, section: string | null, dateAt: string, ref: Date): string | null {
  const explicit = parseTermExpression(sentence, ref) ?? (section ? parseTermExpression(section, null) : null);
  if (explicit) return dateFitsTerm(dateAt, explicit.termKey) ? explicit.termKey : null;
  const [y, m, d] = dateAt.slice(0, 10).split("-").map(Number) as [number, number, number];
  return termKey(termForDate(new Date(Date.UTC(y, m - 1, d, 16))));
}

const STATED_OPEN =
  /\b(?:applications?|the comp|comp applications?|auditions?|try-?outs?|recruit(?:ing|ment))\s+(?:is\s+|are\s+)?(?:now\s+)?(?:open|live)\b|\bnow accepting applications\b/i;
const STATED_CLOSED =
  /\b(?:applications?|the comp|auditions?|recruit(?:ing|ment))\s+(?:is\s+|are\s+|has\s+|have\s+)?(?:now\s+)?closed\b|\bno longer accepting applications\b|\bapplications?\s+(?:to|for)\b[^.!?]{0,60}?\b(?:has|have|are|is)\s+(?:now\s+)?closed\b/i;
/** "We'll email you when Spring 2027 applications open": a future opening, not open now (1.16.20). */
const OPENS_LATER =
  /\b(?:when|once|until|before|after|as soon as|whenever)\b[^.!?]{0,60}\b(?:applications?|the comp|auditions?|try-?outs?|recruit(?:ing|ment))\s+(?:is\s+|are\s+)?(?:open|go live|opens?)\b/i;

/**
 * The recruiting term a joining page names in its title/headings or next to recruiting
 * words ("Fall 2026 recruitment") — only the current or next term, never a founding year
 * ("established in the fall of 1981") or a past cycle. PURE.
 */
export function pageRecruitingTerm(doc: PageDocument, fetchedAt: Date): string | null {
  const current = termKey(termForDate(fetchedAt));
  const [cy, cs] = current.split("-") as [string, string];
  const next = cs === "fall" ? `${Number(cy) + 1}-spring` : `${cy}-fall`;
  const candidates = [
    doc.title ?? "",
    doc.h1 ?? "",
    ...doc.blocks.filter((b) => b.kind === "heading").map((b) => b.text),
    ...doc.blocks.filter((b) => RECRUITING_CONTEXT.test(b.text)).map((b) => b.text),
  ];
  for (const text of candidates) {
    const t = parseTermExpression(text, null);
    if (t && (t.termKey === current || t.termKey === next)) return t.termKey;
  }
  return null;
}

export function extractRecruiting(ctx: ExtractContext): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  const found = new Set<string>();
  const fetchYear = newYorkDateParts(ctx.fetchedAt).year;
  const recruitingPage = ctx.role === "join" || ctx.role === "recruiting";
  const years = pageYears(ctx.doc, ctx.fetchedAt);
  const latestYear = years[years.length - 1];
  const staleYears = latestYear !== undefined && latestYear < fetchYear;
  // A news post that never states a year: its "Dec. 21" could be any December (1.15.1).
  const undatedArticle = years.length === 0 && isArticleUrl(ctx.doc.url);
  // "Adams Pool Theater Applications": a page about directing a show or booking a venue.
  const eventPage = eventDateProblem(ctx.doc.title ?? "") !== null;
  // A form titled "… Second Round Application" serves applicants who passed round one: its
  // dates and link are not when or where to apply (1.13.0).
  const laterStepPage = laterStepDeadlineProblem(`${ctx.doc.title ?? ""} | ${ctx.doc.h1 ?? ""}`) !== null;
  const emit = (field: "cycle.deadline" | "cycle.opens_at", fragment: string, sentence: string, block: DocBlock) => {
    if (laterStepPage || eventPage) return;
    if (isVagueTimeReference(fragment) && !/\d/.test(fragment)) return;
    // "EOD Friday 9/19/2025, and the first meeting is Saturday 9/20/2025, 3-4pm": a time that
    // follows a second date belongs to that date, not to this one (1.16.8).
    const dates = [...fragment.matchAll(DATE_TOKEN_G)];
    const second = dates[1];
    const parsed = parseDateExpression(second ? fragment.slice(0, second.index) : fragment, ctx.fetchedAt);
    if (!parsed) return;
    // "this Friday": the page's own date is unknown, so the crawl date is no reference.
    if (parsed.notes.some((n) => n.startsWith("relative weekday"))) return;
    // A month/day with no year on a page whose latest year is past: an old cycle's date.
    if (parsed.notes.some((n) => n.startsWith("year inferred")) && (staleYears || undatedArticle)) return;
    // "Saturday, Feb. 26" whose inferred year makes it a Friday: an old page (ADR 0033).
    if (weekdayProblem(fragment, parsed.at)) return;
    // An open rehearsal, a party or a shift deadline is not an application date.
    if (eventDateProblem(field === "cycle.opens_at" ? sentence : fragment)) return;
    if (EVENT_REGISTRATION.test(sentence)) return;
    // "Second Round Applications are due…", "Priority deadline": not when applying closes.
    if (field === "cycle.deadline") {
      const at = Math.max(0, sentence.indexOf(fragment.slice(0, 20)));
      if (laterStepDeadlineProblem(sentence.slice(Math.max(0, at - 45), at + 25))) return;
    }
    // A scholarship, a contest's entries, a conference's delegates: not the club recruiting.
    if (outsiderApplicationProblem(sentence, ctx.doc.text)) return;
    // "WiM Board Applications are open!! Apply by September 24th": the date belongs to the
    // board application named just before it or in its section heading (1.16.13).
    const at = block.text.indexOf(sentence);
    const lead = at > 0 ? block.text.slice(Math.max(0, at - 120), at) : "";
    if (leadershipApplicationProblem(`${block.section ?? ""} | ${lead} ${sentence}`)) return;
    const t = Date.parse(parsed.precision === "date" ? `${parsed.at}T12:00:00Z` : parsed.at);
    // Ignore stale recruiting text (older than ~13 months) and implausible far-future dates.
    if (t < ctx.fetchedAt.getTime() - 400 * DAY || t > ctx.fetchedAt.getTime() + 400 * DAY) return;
    if (Number(parsed.at.slice(0, 4)) < fetchYear - 1) return;
    const key = `${field}:${parsed.at}`;
    if (found.has(key)) return;
    found.add(key);
    const term = cycleTermFor(sentence, block.section, parsed.at, ctx.fetchedAt);
    if (!term) return;
    out.push(
      claim({
        fieldKey: field,
        value: {
          at: parsed.at,
          precision: parsed.precision,
          sourceText: parsed.originalText,
          parseConfidence: parsed.confidence,
        },
        quote: sentence,
        locator: loc(ctx, block, { parseNotes: parsed.notes }),
        cycleTermKey: term,
        confidenceFactor: CONF[parsed.confidence],
      }),
    );
  };
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    // Recruiting context: the sentence, its block/section, the preceding block, or a join/recruiting page.
    const prevBlock = ctx.doc.blocks[block.index - 1]?.text ?? "";
    const inContext = [sentence, block.text, block.section ?? "", prevBlock].some((t) => RECRUITING_CONTEXT.test(t));
    if (!inContext && !recruitingPage) continue;
    const w = PROCESS_WINDOW.exec(sentence);
    if (w?.[1] && w[2]) {
      emit("cycle.opens_at", w[1], sentence, block);
      emit("cycle.deadline", w[2], sentence, block);
      continue;
    }
    const a = AUDITION_DAYS.exec(sentence);
    if (a) {
      const days = [...sentence.slice(a.index + a[0].length).matchAll(WINDOW_DATE_G)].map((m) => m[0]);
      if (days.length >= 2) {
        emit("cycle.opens_at", days[0] as string, sentence, block);
        emit("cycle.deadline", days[days.length - 1] as string, sentence, block);
        continue;
      }
    }
    const d = DEADLINE_CUE.exec(sentence);
    const o = OPENS_CUE.exec(sentence);
    // Each date is read from the text following its own cue ("open Sep 1 and close Oct 3").
    // A timeline item "9/11: Applications Due @ 5 PM 9/13-9/15: Interviews": the date comes
    // BEFORE its label, so reading after "Due" would take the next item's date (1.12.0).
    const t = TIMELINE_DEADLINE.exec(sentence);
    if (t?.[1]) {
      const rest =
        sentence.slice(t.index + t[0].length).split(/\s(?=\d{1,2}\/\d{1,2}\b|[A-Z][a-z]{2,8}\.?\s+\d{1,2}\b)/)[0] ?? "";
      emit("cycle.deadline", `${t[1]} ${rest.slice(0, 30)}`, sentence, block);
    } else if (d) emit("cycle.deadline", sentence.slice(d.index), sentence, block);
    if (o && (!d || o.index < d.index))
      emit("cycle.opens_at", sentence.slice(o.index, d && d.index > o.index ? d.index : undefined), sentence, block);
  }
  // A deadline label with its date alone on the next line.
  for (const block of ctx.doc.blocks) {
    const label = block.text.trim();
    if (!DEADLINE_LABEL.test(label)) continue;
    const next = ctx.doc.blocks[block.index + 1]?.text.trim() ?? "";
    if (!BARE_DATE.test(next)) continue;
    emit("cycle.deadline", next, `${label}: ${next}`, block);
  }
  // Process type + application form for any cycle we found on this page.
  const terms = [...new Set(out.map((c) => c.cycleTermKey).filter((t): t is string => Boolean(t)))];
  // No dates, but a joining page that names the current (or next) term and says
  // applications are open/closed: that statement is the cycle's evidence (CLAUDE.md §8).
  if (terms.length === 0 && recruitingPage && !staleYears) {
    const named = pageRecruitingTerm(ctx.doc, ctx.fetchedAt);
    if (named) {
      for (const { block, sentence } of eachSentence(ctx.doc)) {
        const status = STATED_CLOSED.test(sentence)
          ? "closed"
          : STATED_OPEN.test(sentence) && !OPENS_LATER.test(sentence)
            ? "open"
            : null;
        if (!status) continue;
        // "Applications to this semester's fellowships have closed" is about now, not about the
        // later term the page also names ("… when Spring 2027 applications open").
        const term = /\bthis (?:semester|term)(?:'s)?\b/i.test(sentence) ? termKey(termForDate(ctx.fetchedAt)) : named;
        out.push(
          claim({
            fieldKey: "cycle.stated_status",
            value: status,
            quote: sentence,
            locator: loc(ctx, block),
            cycleTermKey: term,
            confidenceFactor: 0.85,
          }),
        );
        terms.push(term);
        break;
      }
    }
  }
  if (terms.length === 1) {
    const term = terms[0] as string;
    for (const j of extractJoinModes({ ...ctx, role: ctx.role === "other" ? "join" : ctx.role })) {
      if (j.value === "open") continue;
      out.push({ ...j, fieldKey: "cycle.process_type", cycleTermKey: term });
    }
    const { stages, quote: stageQuote } = extractStages(ctx);
    if (stages.length)
      out.push(
        claim({
          fieldKey: "cycle.stages",
          value: stages,
          quote: stageQuote,
          locator: loc(ctx, null, { from: "stage list" }),
          cycleTermKey: term,
          confidenceFactor: 0.85,
        }),
      );
    // The cycle's application form: only one the page clearly presents as the application.
    const form = applicationFormLinks(ctx.doc, recruitingPage)[0];
    if (
      form &&
      !laterStepPage &&
      !outsiderLinkProblem(form.text, ctx.doc.url, ...ownNamesOut(ctx, ctx.doc.h1, ctx.doc.title))
    )
      out.push(
        claim({
          fieldKey: "cycle.application_url",
          value: form.url,
          quote: form.text || form.url,
          locator: loc(ctx, null, { href: form.url }),
          cycleTermKey: term,
        }),
      );
  }
  return out;
}

// --- Recruiting stages --------------------------------------------------------------------------

/** Explicit stage names, in the order a page lists them (CLAUDE.md §4: never inferred). */
const STAGE_PATTERNS: [StageKind, RegExp][] = [
  ["info_session", /\b(info(?:rmation(?:al)?)? (?:session|meeting|night)s?)\b/i],
  [
    "written_application",
    /\b(written application|application form|online application|short answer (?:questions|responses))\b/i,
  ],
  ["coffee_chat", /\b(coffee chats?)\b/i],
  ["case_interview", /\b(case interviews?)\b/i],
  ["technical_interview", /\b(technical interviews?)\b/i],
  ["interview", /\b((?:first|second|1st|2nd|final)[- ]round interviews?|(?<!case |technical )interviews?)\b/i],
  ["audition", /\b(callbacks?|auditions?)\b/i],
  ["tryout", /\b(try-?outs?)\b/i],
  ["comp_period", /\b(comp (?:period|process|program)|(?:the )?comp(?=\s*(?:[,.;:)]|$)))/i],
  ["final_round", /\b(final rounds?|superday)\b/i],
  ["other", /\b(training (?:period|program|weeks?)|new member training|onboarding)\b/i],
];
const PROCESS_CONTEXT =
  /\b(process|stages?|steps?|timeline|rounds?|how to (?:join|apply)|recruit(?:ing|ment)|comp(?:ing)?|selection|consists of|involves|followed by)\b/i;

/**
 * Stages a joining/recruiting page lists explicitly: list items or sentences in a process
 * section ("Our process: info session, written application, coffee chat, interview"). At
 * least two distinct stages, each named verbatim; a lone "interview" mention isn't a process.
 */
export function extractStages(ctx: ExtractContext): { stages: StageValue[]; quote: string } {
  const none = { stages: [], quote: "" };
  if (ctx.role !== "join" && ctx.role !== "recruiting") return none;
  const found: { kind: StageKind; label: string; pos: number; text: string }[] = [];
  let pos = 0;
  for (const block of ctx.doc.blocks) {
    pos++;
    const inProcess =
      PROCESS_CONTEXT.test(block.section ?? "") || (block.kind !== "list_item" && PROCESS_CONTEXT.test(block.text));
    if (!inProcess || block.kind === "heading") continue;
    // One phrase is one stage: "Final round interview" is not also an "interview".
    const taken: [number, number][] = [];
    for (const [kind, re] of STAGE_PATTERNS) {
      const m = re.exec(block.text);
      if (!m?.[1]) continue;
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      if (found.some((f) => f.kind === kind && kind !== "other")) continue;
      taken.push([start, end]);
      found.push({ kind, label: m[1].trim(), pos: pos * 1000 + (m.index ?? 0), text: block.text });
    }
  }
  if (new Set(found.map((f) => f.kind)).size < 2) return none;
  const ordered = found.sort((a, b) => a.pos - b.pos).slice(0, 10);
  return {
    stages: ordered.map((f, i) => ({
      order: i,
      kind: f.kind,
      label: f.label.charAt(0).toUpperCase() + f.label.slice(1),
    })),
    // Each piece is verbatim page text.
    quote: [...new Set(ordered.map((f) => f.text))].join(" … ").slice(0, 1000),
  };
}

// --- Commitment, membership, money ------------------------------------------------------------

const HOURS_RANGE = /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:hours|hrs)\s*(?:per|a|\/|each|every)\s*week\b/i;
const HOURS_ONE =
  /\b(?:about|around|roughly|approximately|~)?\s*(\d{1,2})\+?\s*(?:hours|hrs)\s*(?:per|a|\/|each|every)\s*week\b/i;
const MEMBERS_MIN =
  /\b(?:over|more than|upwards of)\s+(\d{2,4})\s+(?:active\s+|current\s+|student\s+|undergraduate\s+)?members\b|\b(\d{2,4})\+\s+(?:active\s+|current\s+)?members\b/i;
const MEMBERS_EXACT = /\b(\d{2,4})\s+(?:active|current|undergraduate|student)?\s*members\b/i;

export function extractCommitmentAndSize(ctx: ExtractContext): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  let hours = false;
  let members = false;
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    if (!hours) {
      const r = HOURS_RANGE.exec(sentence);
      const one = r ? null : HOURS_ONE.exec(sentence);
      const min = r ? Number(r[1]) : one ? Number(one[1]) : null;
      const max = r ? Number(r[2]) : one ? (/\+/.test(one[0]) ? null : Number(one[1])) : null;
      const hourNums = [min, max].filter((n): n is number => n !== null);
      if (min !== null && (max === null || max >= min) && !hoursProblem(sentence, hourNums)) {
        const comp = /\bcomp|during (?:the )?(?:application|recruit)/i.test(sentence);
        out.push(
          claim({
            fieldKey: "club.hours_per_week",
            value: { min, max, ...(comp ? { qualifier: "comp_period" } : {}) },
            quote: sentence,
            locator: loc(ctx, block),
          }),
        );
        hours = true;
      }
    }
    if (!members && !/\b(founding|board|executive|alumni)\s+members\b/i.test(sentence)) {
      const mm = MEMBERS_MIN.exec(sentence);
      const n = mm ? Number(mm[1] ?? mm[2]) : null;
      if (n !== null && n >= 10 && (n < 1900 || n > 2100) && !memberCountProblem(sentence, [n])) {
        out.push(
          claim({
            fieldKey: "club.member_count",
            value: { kind: "range", min: n, max: null },
            quote: sentence,
            locator: loc(ctx, block),
          }),
        );
        members = true;
      } else {
        const me = MEMBERS_EXACT.exec(sentence);
        const e = me ? Number(me[1]) : null;
        if (e !== null && e >= 10 && e <= 3000 && (e < 1900 || e > 2100) && !memberCountProblem(sentence, [e])) {
          out.push(
            claim({
              fieldKey: "club.member_count",
              value: { kind: "exact", count: e },
              quote: sentence,
              locator: loc(ctx, block),
              confidenceFactor: 0.9,
            }),
          );
          members = true;
        }
      }
    }
  }
  return out;
}

const DUES_AMOUNT =
  /\$\s?(\d{1,4})(?:\.\d{2})?\s*(?:\/|per|a|each)?\s*(?:semester|year|term)?\s*(?:membership\s+)?(?:dues|fee)\b|\bdues\s+(?:are|of|is)\s+\$\s?(\d{1,4})/i;
const NO_DUES = /\b(?:no (?:membership )?dues|there are no dues|free to join|no membership fee)\b/i;

export function extractDues(ctx: ExtractContext): ExtractedClaim[] {
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    if (NO_DUES.test(sentence)) {
      return [
        claim({
          fieldKey: "club.dues",
          value: { hasDues: false, note: sentence.slice(0, 480) },
          quote: sentence,
          locator: loc(ctx, block),
        }),
      ];
    }
    const m = DUES_AMOUNT.exec(sentence);
    if (m && !duesProblem(sentence, Number(m[1] ?? m[2]))) {
      return [
        claim({
          fieldKey: "club.dues",
          value: { hasDues: true, amountUsd: Number(m[1] ?? m[2]), note: sentence.slice(0, 480) },
          quote: sentence,
          locator: loc(ctx, block),
        }),
      ];
    }
  }
  return [];
}

// --- Eligibility --------------------------------------------------------------------------------

/** Pages whose sentences about who may join speak for the club (not bios, events or news). */
const ELIGIBILITY_ROLES = new Set<PageRole>(["home", "about", "join", "recruiting", "faq", "other"]);

/**
 * Who may join, per the shared class-year reader (`classEligibility`, ADR 0041; 1.16.0): an
 * explicit first-years yes/no becomes `club.freshmen_eligible`; a list of class years or an
 * "all undergraduates" population becomes `club.eligible_classes`. Bios, outsiders'
 * programs and board roles are skipped. At most one claim of each field per page.
 */
export function extractEligibility(ctx: ExtractContext): ExtractedClaim[] {
  if (!ELIGIBILITY_ROLES.has(ctx.role) || isArticleUrl(ctx.doc.url)) return [];
  let explicit: ExtractedClaim | null = null;
  let classes: ExtractedClaim | null = null;
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    if (explicit && classes) break;
    // The sentence only: a service program's page is full of the youth it serves, and the
    // class-year reader already ignores outside-only populations.
    if (PERSONAL.test(sentence) || outsiderApplicationProblem(sentence)) continue;
    // Who may run for the board says nothing about who may join.
    if (joinQuoteScope(sentence).scope === "role" || leadershipApplicationProblem(sentence)) continue;
    const e = classEligibility(sentence);
    if (!e || e.firstYears === null) continue;
    const at = loc(ctx, block);
    if (e.kind === "population") {
      classes ??= claim({ fieldKey: "club.eligible_classes", value: e.classes, quote: sentence, locator: at });
      continue;
    }
    explicit ??= claim({ fieldKey: "club.freshmen_eligible", value: e.firstYears, quote: sentence, locator: at });
    // A real list ("first-years through juniors", "sophomores and up"), not one year named.
    if (e.classes.length >= 2)
      classes ??= claim({ fieldKey: "club.eligible_classes", value: e.classes, quote: sentence, locator: at });
  }
  return [explicit, classes].filter((c): c is ExtractedClaim => c !== null);
}

// --- Selectivity (explicit numbers only; CLAUDE.md §9) ---------------------------------------------

const APPLICANTS =
  /\b(\d{1,3}(?:,\d{3})?|\d{2,5})\s+(?:applicants|applications\s+(?:were\s+)?received|students\s+applied|people\s+applied)\b/i;
const ACCEPTED =
  /\b(?:accepted|admitted|selected|welcomed|offered spots? to)\s+(\d{1,4})\b|\b(\d{1,4})\s+(?:new\s+)?(?:members|analysts|associates|students|applicants)\s+(?:were\s+)?(?:accepted|admitted|selected)\b/i;
const RATE =
  /\b(\d{1,2}(?:\.\d+)?)\s?%\s+acceptance rate\b|\bacceptance rate (?:of|was|is)\s+(?:about\s+|around\s+|approximately\s+)?(\d{1,2}(?:\.\d+)?)\s?%/i;
const QUALITATIVE = /\b(?:highly|very|extremely|incredibly)\s+(?:competitive|selective)\b/i;

export function extractSelectivity(ctx: ExtractContext): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  let qualitative = false;
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    const term = parseTermExpression(sentence, null); // only an EXPLICIT term ties numbers to a cycle
    const num = (s: string | undefined) => (s ? Number(s.replace(/,/g, "")) : null);
    if (term) {
      const a = APPLICANTS.exec(sentence);
      if (a)
        out.push(
          claim({
            fieldKey: "cycle.applicants",
            value: num(a[1]),
            quote: sentence,
            locator: loc(ctx, block),
            cycleTermKey: term.termKey,
          }),
        );
      const acc = ACCEPTED.exec(sentence);
      if (acc)
        out.push(
          claim({
            fieldKey: "cycle.admits",
            value: num(acc[1] ?? acc[2]),
            quote: sentence,
            locator: loc(ctx, block),
            cycleTermKey: term.termKey,
          }),
        );
      const rate = RATE.exec(sentence);
      if (rate)
        out.push(
          claim({
            fieldKey: "cycle.stated_acceptance_rate",
            value: Number(rate[1] ?? rate[2]),
            quote: sentence,
            locator: loc(ctx, block),
            cycleTermKey: term.termKey,
          }),
        );
    }
    // Only the club's own joining process (1.10.0): not colleges, partners or outward programs.
    if (
      !qualitative &&
      QUALITATIVE.test(sentence) &&
      sentence.length <= 400 &&
      !selfDescribedSelectivityProblem(sentence)
    ) {
      out.push(
        claim({
          fieldKey: "club.self_described_selectivity",
          value: sentence,
          quote: sentence,
          locator: loc(ctx, block),
        }),
      );
      qualitative = true;
    }
  }
  return out;
}

// --- Sponsors ------------------------------------------------------------------------------------

export function extractSponsors(ctx: ExtractContext): ExtractedClaim[] {
  if (ctx.role !== "sponsors") return [];
  const out: ExtractedClaim[] = [];
  for (const b of ctx.doc.blocks) {
    if (b.kind !== "list_item" || !b.section || !/\b(sponsors?|partners?)\b/i.test(b.section)) continue;
    if (b.text.length > 60 || b.text.split(" ").length > 6) continue;
    out.push(claim({ fieldKey: "club.sponsor", value: b.text, quote: b.text, locator: loc(ctx, b) }));
    if (out.length >= 30) break;
  }
  return out;
}

/** Run every deterministic extractor for one page. */
// --- Former names (1.14.0) ------------------------------------------------------------------

/** "(formerly known as the Harvard College Law Review)": the name the club used before. */
const FORMERLY =
  /\bformerly\s+(?:known\s+as|called|named)\s+(?:the\s+)?((?:[A-Z][\w'’&.-]*\s+(?:(?:of|for|and|the|in|at|on|&)\s+)*){1,9}[A-Z][\w'’&.-]*)(?:\s*\(([A-Z][A-Za-z&]{1,9})\))?/;

/**
 * A former name the club states for itself on its own about/home/FAQ/joining page: "We were
 * formerly known as the Harvard Speech and Parliamentary Debate Society (HSPDS)". The
 * sentence must be about the club (its name, acronym, or "we"/"our"), so a page mentioning
 * that X was formerly Twitter adds nothing. Stored as an alias, so the old name finds the
 * club; whether it is the same organization (a merge) stays an editorial decision. PURE.
 */
export function extractFormerNames(ctx: ExtractContext): ExtractedClaim[] {
  if (ctx.directoryPage || !["home", "about", "faq", "join"].includes(ctx.role) || isArticleUrl(ctx.doc.url)) return [];
  const own = [...ctx.clubNames, ...ctx.clubAcronyms].filter((n) => n.length >= 3).map((n) => n.toLowerCase());
  const current = new Set(ctx.clubNames.map((n) => normalizeName(n)));
  const out: ExtractedClaim[] = [];
  const seen = new Set<string>();
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    const m = FORMERLY.exec(sentence);
    if (!m?.[1]) continue;
    const before = sentence.slice(0, m.index).toLowerCase();
    if (!/\b(we|our|us)\b/.test(before) && !own.some((n) => before.includes(n))) continue;
    const name = m[1].replace(/\s+/g, " ").trim();
    const key = normalizeName(name);
    if (key.split(" ").length < 2 || current.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(
      claim({
        fieldKey: "club.alias",
        value: { name, kind: "former" },
        quote: sentence,
        locator: loc(ctx, block),
        confidenceFactor: 0.9,
      }),
    );
    const acronym = m[2];
    if (acronym && !ctx.clubAcronyms.some((a) => a.toLowerCase() === acronym.toLowerCase()) && !seen.has(acronym))
      out.push(
        claim({
          fieldKey: "club.alias",
          value: { name: acronym, kind: "former" },
          quote: sentence,
          locator: loc(ctx, block),
          confidenceFactor: 0.9,
        }),
      );
  }
  return out;
}

export function extractDeterministic(ctx: ExtractContext): ExtractedClaim[] {
  // A privacy policy or reprint-permissions page says nothing about the club (1.16.14).
  if (isLegalPageUrl(ctx.doc.url)) return [];
  return [
    ...extractFormerNames(ctx),
    // A post's links are the post's; the club's channels come from its home and about pages (1.16.14).
    ...(isArticleUrl(ctx.doc.url) ? [] : extractLinks(ctx)),
    ...extractDescriptions(ctx),
    ...extractJoinModes(ctx),
    ...extractRecruiting(ctx),
    ...extractRecruitingSeasons(ctx),
    ...extractCommitmentAndSize(ctx),
    ...extractDues(ctx),
    ...extractEligibility(ctx),
    ...extractSelectivity(ctx),
    ...extractSponsors(ctx),
  ];
}
