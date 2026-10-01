import {
  classifyLink,
  isVagueTimeReference,
  newYorkDateParts,
  normalizeAcronym,
  normalizeName,
  parseDateExpression,
  parseTermExpression,
  siteKey,
  termForDate,
  termKey,
  type ClassYear,
  type JoinMode,
  type RecruitingSeason,
  type LinkKind,
  type ParseConfidence,
} from "@hci/core";
import type { DocBlock, LogoCandidate, PageDocument } from "../parse/document";
import type { ExtractedClaim } from "../types";

/**
 * Deterministic extractors (CLAUDE.md §11: prefer deterministic parsing; LLM only for
 * semantics). Conservative by design: a pattern that could plausibly mean something
 * else is not emitted. Every claim carries the verbatim sentence as its quote and the
 * block index as its locator.
 */
export const DETERMINISTIC_EXTRACTOR = { name: "site-deterministic", version: "1.5.3" } as const;

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

function sentences(b: DocBlock): string[] {
  return b.text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
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

/** Does the page title / h1 / og:title name this club? (evidence for "probable official site") */
export function pageNamesClub(doc: PageDocument, names: string[], acronyms: string[]): string | null {
  const targets = [doc.title, doc.h1, doc.ogTitle].filter((t): t is string => Boolean(t));
  const normNames = names.map(normalizeName).filter((n) => n.split(" ").length >= 2);
  const acr = acronyms.map(normalizeAcronym).filter((a) => a.length >= 3);
  for (const t of targets) {
    const nt = ` ${normalizeName(t)} `;
    if (normNames.some((n) => nt.includes(` ${n} `))) return t;
    const tokens = t.split(/[\s|:–—-]+/).map(normalizeAcronym);
    if (acr.some((a) => tokens.includes(a))) return t;
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

export function extractLinks(ctx: ExtractContext): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  const labelledSites = ctx.directoryPage ? labelledWebsiteTexts(ctx.doc) : new Set<string>();
  const ownSite = siteKey(ctx.doc.url);
  const acronyms = ctx.clubAcronyms.map((a) => a.toLowerCase());
  const nameTokens = ctx.clubNames.flatMap((n) => normalizeName(n).split(" ")).filter((t) => t.length >= 4);
  for (const link of ctx.doc.links) {
    // Header/footer links repeat on every page; record them once, from the home page.
    if (link.chrome && ctx.role !== "home") continue;
    const c = classifyLink(link.url);
    if (!c || c.isPersonal || c.isContentItem) continue;
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

    const inSite = ownSite !== null && siteKey(link.url) === ownSite;
    if (inSite) {
      // Internal application/recruiting page.
      if (APPLY_TEXT.test(link.text) && (!link.chrome || ctx.role === "home")) {
        out.push(
          claim({
            fieldKey: "club.link",
            value: { kind: "application_page", url: c.url, label: link.text.slice(0, 80) },
            quote: link.text,
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
    if (
      FORM_HOSTS.test(host) &&
      /\b(mailing list|newsletter|subscribe|listserv|stay (?:updated|in touch))\b/i.test(link.text)
    ) {
      out.push(
        claim({
          fieldKey: "club.link",
          value: { kind: "mailing_list", url: c.url, label: link.text.slice(0, 80) },
          quote: link.text,
          locator: loc(ctx, null, { href: link.url }),
        }),
      );
      continue;
    }
    if (FORM_HOSTS.test(host) && APPLY_TEXT.test(link.text)) {
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

/** Text about an individual person (bios, member profiles) — never used as club data. */
const PERSONAL =
  /\b(lived in|concentrat(?:ed|es|ing) in|class of|'[0-9]{2}\b|is a (?:first-year|freshman|sophomore|junior|senior)|(?:he|she) (?:is|was|studies|grew up)|his |her |hometown|in (?:his|her|their) free time)\b/i;

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

export function extractDescriptions(ctx: ExtractContext): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  if (ctx.role === "home" || ctx.role === "about") {
    const meta = ctx.doc.metaDescription ?? ctx.doc.ogDescription;
    if (
      meta &&
      meta.length >= 40 &&
      meta.length <= 400 &&
      !GENERIC_DESC.test(meta) &&
      !PERSONAL.test(meta) &&
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
      b.text.length <= 1200 &&
      !PERSONAL.test(b.text) &&
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
    "open",
    /\b(?:open to all(?: students| undergraduates)?|all are welcome|everyone is welcome|anyone (?:can|may) join|open membership|no application (?:is )?(?:required|necessary|needed))\b/i,
  ],
];

export function extractJoinModes(ctx: ExtractContext): ExtractedClaim[] {
  if (!["home", "about", "join", "recruiting", "faq"].includes(ctx.role)) return [];
  const out: ExtractedClaim[] = [];
  const seen = new Set<JoinMode>();
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    for (const [mode, re] of JOIN_PATTERNS) {
      if (seen.has(mode) || !re.test(sentence)) continue;
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

/** Images that are never the club's own logo (university marks, platforms, social icons). */
const NOT_CLUB_LOGO =
  /(\bharvard[-_ ]?(university|shield|veritas|college)[^/]*\.(png|svg|jpe?g|gif|webp)|shield|veritas|squarespace-(logo|favicon)|wix(static)?\.com\/.*favicon|\/wp-includes\/|gravatar|facebook|instagram|twitter|linkedin|youtube|tiktok|google|apple-pay|paypal|venmo|placeholder|spacer|pixel|sponsor|partner|upload\.wikimedia\.org|\.svg\.png|screenshot|banner|hero|background|(^|[-_ /])(white|light|reverse[d]?|inverse|inverted|negative)\b)/i;

/** Declared pixel width in CDN image URLs (Wix `w_32`, Squarespace `format=100w`, `?w=`). */
function declaredWidth(url: string): number | null {
  const m = /(?:[/,]w_|[?&]w=|format=)(\d{2,4})(?:w\b|[,&/_]|$)/i.exec(url);
  return m ? Number(m[1]) : null;
}
const LOGO_RANK: Record<LogoCandidate["kind"], number> = {
  jsonld: 0,
  header_img: 1,
  apple_touch_icon: 2,
  img: 3,
  og_image: 4,
  icon: 5,
};

/** The club's logo from its own home page, or null. PURE. */
export function pickLogo(candidates: readonly LogoCandidate[]): LogoCandidate | null {
  const usable = candidates.filter((c) => {
    // Test the decoded file name too: "White+Round+logo.png" is a white variant.
    let decoded = c.url;
    try {
      decoded = decodeURIComponent(c.url.replace(/\+/g, " "));
    } catch {
      /* keep the raw URL */
    }
    if (NOT_CLUB_LOGO.test(c.url) || NOT_CLUB_LOGO.test(decoded)) return false;
    try {
      if (/(^|\.)harvard\.edu$/i.test(new URL(c.url).hostname)) return false;
    } catch {
      return false;
    }
    const w = declaredWidth(c.url);
    if (w !== null && w < 64) return false;
    // Share images are usually banner photos; tiny favicons look bad enlarged.
    if (c.kind === "og_image") return /logo/i.test(c.url);
    if (c.kind === "icon") return (c.size ?? 0) >= 96 || /\.svg(\?|$)/i.test(c.url);
    return true;
  });
  usable.sort((a, b) => LOGO_RANK[a.kind] - LOGO_RANK[b.kind] || (b.size ?? 0) - (a.size ?? 0));
  return usable[0] ?? null;
}

export function extractLogo(ctx: ExtractContext): ExtractedClaim[] {
  if (ctx.role !== "home" || ctx.directoryPage) return [];
  const logo = pickLogo(ctx.doc.logoCandidates ?? []);
  if (!logo) return [];
  return [
    claim({
      fieldKey: "club.logo",
      value: logo.url,
      locator: loc(ctx, null, { logoKind: logo.kind }),
      confidenceFactor: logo.kind === "jsonld" || logo.kind === "header_img" ? 1 : 0.8,
    }),
  ];
}

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
  if (ROLLING.test(sentence)) out.add("rolling");
  return [...out].sort();
}

export function extractRecruitingSeasons(ctx: ExtractContext): ExtractedClaim[] {
  if (!["home", "about", "join", "recruiting", "faq"].includes(ctx.role)) return [];
  let best: { seasons: RecruitingSeason[]; sentence: string; block: DocBlock } | null = null;
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    const seasons = recruitingSeasonsIn(sentence);
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

const DEADLINE_CUE = /\b(deadline|due|apply by|submit(?:ted)? by|clos(?:e|es|ed|ing)|last day to apply)\b/i;
const OPENS_CUE = /\b(open(?:s|ing)?|will open|launch(?:es)?|begin(?:s)?|start(?:s)?|release[sd]?)\b/i;
const RECRUITING_CONTEXT =
  /\b(appl(?:y|ications?)|recruit(?:ing|ment)?|comp(?:ing)?|auditions?|try-?outs?|interest form)\b/i;
const DAY = 86_400_000;

function cycleTermFor(sentence: string, pageText: string, dateAt: string, ref: Date): string {
  const explicit = parseTermExpression(sentence, ref) ?? parseTermExpression(pageText.slice(0, 4000), null);
  if (explicit) return explicit.termKey;
  const [y, m, d] = dateAt.slice(0, 10).split("-").map(Number) as [number, number, number];
  return termKey(termForDate(new Date(Date.UTC(y, m - 1, d, 16))));
}

export function extractRecruiting(ctx: ExtractContext): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  const found = new Set<string>();
  const fetchYear = newYorkDateParts(ctx.fetchedAt).year;
  const recruitingPage = ctx.role === "join" || ctx.role === "recruiting";
  const emit = (field: "cycle.deadline" | "cycle.opens_at", fragment: string, sentence: string, block: DocBlock) => {
    if (isVagueTimeReference(fragment) && !/\d/.test(fragment)) return;
    const parsed = parseDateExpression(fragment, ctx.fetchedAt);
    if (!parsed) return;
    const t = Date.parse(parsed.precision === "date" ? `${parsed.at}T12:00:00Z` : parsed.at);
    // Ignore stale recruiting text (older than ~13 months) and implausible far-future dates.
    if (t < ctx.fetchedAt.getTime() - 400 * DAY || t > ctx.fetchedAt.getTime() + 400 * DAY) return;
    if (Number(parsed.at.slice(0, 4)) < fetchYear - 1) return;
    const key = `${field}:${parsed.at}`;
    if (found.has(key)) return;
    found.add(key);
    const term = cycleTermFor(sentence, ctx.doc.text, parsed.at, ctx.fetchedAt);
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
    const d = DEADLINE_CUE.exec(sentence);
    const o = OPENS_CUE.exec(sentence);
    // Each date is read from the text following its own cue ("open Sep 1 and close Oct 3").
    if (d) emit("cycle.deadline", sentence.slice(d.index), sentence, block);
    if (o && (!d || o.index < d.index))
      emit("cycle.opens_at", sentence.slice(o.index, d && d.index > o.index ? d.index : undefined), sentence, block);
  }
  // Process type + application form for any cycle we found on this page.
  const terms = [...new Set(out.map((c) => c.cycleTermKey).filter((t): t is string => Boolean(t)))];
  if (terms.length === 1) {
    const term = terms[0] as string;
    for (const j of extractJoinModes({ ...ctx, role: ctx.role === "other" ? "join" : ctx.role })) {
      if (j.value === "open") continue;
      out.push({ ...j, fieldKey: "cycle.process_type", cycleTermKey: term });
    }
    const form = ctx.doc.links.find((l) => {
      try {
        return FORM_HOSTS.test(new URL(l.url).hostname);
      } catch {
        return false;
      }
    });
    if (form)
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
      if (min !== null && min <= 40 && (max === null || (max >= min && max <= 60))) {
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
      if (n !== null && n >= 10 && (n < 1900 || n > 2100)) {
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
        if (e !== null && e >= 10 && e <= 3000 && (e < 1900 || e > 2100)) {
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
    if (m) {
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

const CLASS_WORDS: [ClassYear, RegExp][] = [
  ["first_year", /\b(first[- ]years?|freshm[ae]n)\b/i],
  ["sophomore", /\bsophomores?\b/i],
  ["junior", /\bjuniors?\b/i],
  ["senior", /\bseniors?\b/i],
];

export function extractEligibility(ctx: ExtractContext): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  for (const { block, sentence } of eachSentence(ctx.doc)) {
    if (/\b(open to|eligible|welcome|we (?:accept|recruit)|can apply|may apply)\b/i.test(sentence)) {
      if (/\ball (?:harvard )?(?:college )?(?:undergraduates|undergrads|class years|years)\b/i.test(sentence)) {
        out.push(
          claim({
            fieldKey: "club.eligible_classes",
            value: ["first_year", "sophomore", "junior", "senior"],
            quote: sentence,
            locator: loc(ctx, block),
          }),
        );
        return out;
      }
      const classes = CLASS_WORDS.filter(([, re]) => re.test(sentence)).map(([c]) => c);
      if (classes.length > 0 && !/\bnot\b|\bexcept\b|\bonly (?:upperclass|juniors|seniors)/i.test(sentence)) {
        if (classes.includes("first_year") && classes.length === 1) {
          out.push(
            claim({ fieldKey: "club.freshmen_eligible", value: true, quote: sentence, locator: loc(ctx, block) }),
          );
        } else {
          out.push(
            claim({ fieldKey: "club.eligible_classes", value: classes, quote: sentence, locator: loc(ctx, block) }),
          );
        }
        return out;
      }
    }
  }
  return out;
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
    if (!qualitative && QUALITATIVE.test(sentence) && sentence.length <= 400) {
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
export function extractDeterministic(ctx: ExtractContext): ExtractedClaim[] {
  return [
    ...extractLinks(ctx),
    ...extractLogo(ctx),
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
