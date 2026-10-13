import { classifyLink, normalizeAcronym, siteKey } from "@hci/core";

/**
 * Identity work for name-only clubs (ADR 0032). PURE: recoverability buckets, duplicate /
 * rename detection, and scoring of candidate links found for a club. Nothing here accepts
 * a link by itself: websites still have to name the club when fetched.
 */

// --- Names ---------------------------------------------------------------------------------------

/** Words that every Harvard org name shares; they don't identify a club. */
const BOILERPLATE = new Set([
  "harvard",
  "radcliffe",
  "harvardradcliffe",
  "undergraduate",
  "undergraduates",
  "college",
  "university",
  "the",
  "of",
  "at",
  "for",
  "and",
  "in",
  "a",
  "an",
  "student",
  "students",
  "club",
  "society",
  "association",
  "organization",
  "group",
  "chapter",
  "program",
  "programs",
  "pbha",
  "pbhas",
  "inc",
]);

const words = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** "Pre-Law" → "PreLaw": a hyphenated word's joined spelling. */
const joinHyphens = (s: string) => s.replace(/([A-Za-z0-9])-(?=[A-Za-z0-9])/g, "$1");

/** Crude plural stem so "Students"/"Student", "Careers"/"Career" agree. */
const stem = (w: string) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** The words that distinguish this club ("Harvard Undergraduate Bulgarian Club" → ["bulgarian"]). */
export function distinctiveTokens(name: string): string[] {
  const base = name.replace(/\([^)]*\)/g, " ");
  return [
    ...new Set(
      words(base)
        .filter((w) => !BOILERPLATE.has(w))
        .map(stem),
    ),
  ];
}

/** Words many Harvard groups share (faith, nationality, field): one alone doesn't identify a club. */
const SHARED_WORDS = new Set(
  "catholic christian jewish muslim hindu buddhist mexican latino latinx asian african black korean chinese indian law medicine health business finance consulting".split(
    " ",
  ),
);

/** Very common words: a name made only of these is ambiguous on the open web. */
const COMMON = new Set(
  "book puzzle spanish italian french thai art arts craft crafts music film photo photography science space food law health medicine policy business tennis ski survivor meditation fellowship christian catholic forum review initiative network collective project".split(
    " ",
  ),
);

// --- Buckets -------------------------------------------------------------------------------------

export type Bucket =
  | "likely_duplicate"
  | "college_program"
  | "pbha_program"
  | "invitation_only_social"
  | "other_school"
  | "possible_artifact"
  | "distinctive_acronym"
  | "distinctive_name"
  | "generic_name";

export interface BucketInput {
  name: string;
  acronym: string | null;
  tags: string[];
  duplicate: boolean;
}

const GRADUATE_NAME =
  /\b(GSAS|HKS|HBS|HLS|HMS|HSPH|GSD|HGSE|HDS|Extension School|Kennedy School|Business School|Law School|Medical School|Divinity School|Graduate School)\b/;

/** Where a name-only club most likely gets its information, in priority order. PURE. */
export function bucketFor(c: BucketInput): Bucket {
  const tags = c.tags.map((t) => t.toLowerCase());
  if (c.duplicate) return "likely_duplicate";
  if (
    tags.some((t) => ["house committee", "pre-orientation program", "college life"].includes(t)) ||
    /\bHouse Committee\b|^First[- ]Year\b/i.test(c.name)
  )
    return "college_program";
  if (tags.includes("pbha") || /^PBHA/i.test(c.name)) return "pbha_program";
  if (tags.some((t) => /final clubs|social clubs/.test(t))) return "invitation_only_social";
  if (GRADUATE_NAME.test(c.name)) return "other_school";
  if (c.name.length > 90 || /,\s*Inc\.?$|!$|\s\/\s/.test(c.name)) return "possible_artifact";
  const acr = c.acronym ? normalizeAcronym(c.acronym) : "";
  if (acr.length >= 3 && !["ACS", "NEW"].includes(acr.toUpperCase())) return "distinctive_acronym";
  const tokens = distinctiveTokens(c.name);
  if (tokens.length >= 2 || (tokens.length === 1 && !COMMON.has(tokens[0] ?? "") && (tokens[0]?.length ?? 0) >= 6))
    return "distinctive_name";
  return "generic_name";
}

// --- Duplicates and renames ----------------------------------------------------------------------

export interface DupClub {
  id: string;
  slug: string;
  name: string;
  acronym: string | null;
  websites: string[];
  instagrams: string[];
}

export interface DupPair {
  aId: string;
  bId: string;
  aSlug: string;
  bSlug: string;
  score: number;
  reasons: string[];
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) (d[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      (d[i] as number[])[j] = Math.min(
        (d[i - 1] as number[])[j]! + 1,
        (d[i] as number[])[j - 1]! + 1,
        (d[i - 1] as number[])[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return (d[a.length] as number[])[b.length]!;
}

/** Same word, allowing a spelling change in long words ("Latines"/"Latinos", "Prelaw"/"Pre-law"). */
const sameWord = (a: string, b: string) => a === b || (a.length >= 6 && b.length >= 6 && lev(a, b) <= 2);

/** Token-set similarity with fuzzy word matching (0–1). */
export function nameSimilarity(a: string, b: string): number {
  const ta = distinctiveTokens(a.replace(/-/g, ""));
  const tb = distinctiveTokens(b.replace(/-/g, ""));
  if (ta.length === 0 || tb.length === 0) return 0;
  // One-to-one: exact matches first, then a spelling variant ("Latines"/"Latinos") only for
  // words left over and only next to an exact match ("Iranian"/"Italian" alone is two groups).
  const left = [...tb];
  let matched = 0;
  const pending: string[] = [];
  for (const x of ta) {
    const k = left.indexOf(x);
    if (k >= 0) {
      left.splice(k, 1);
      matched++;
    } else pending.push(x);
  }
  if (matched >= 1)
    for (const x of pending) {
      const k = left.findIndex((y) => sameWord(x, y));
      if (k >= 0) {
        left.splice(k, 1);
        matched++;
      }
    }
  return matched / Math.max(ta.length, tb.length);
}

/**
 * Pairs that are probably the same organization: the same Instagram or website, the same
 * distinctive acronym, or names whose distinctive words match. Each pair becomes a merge
 * candidate for review — never an automatic merge. `focus` limits pairs to those touching
 * at least one of the given clubs. PURE.
 */
export function findDuplicatePairs(clubs: readonly DupClub[], focus: ReadonlySet<string>): DupPair[] {
  const pairs = new Map<string, DupPair>();
  const add = (a: DupClub, b: DupClub, score: number, reason: string) => {
    if (a.id === b.id || (!focus.has(a.id) && !focus.has(b.id))) return;
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const key = `${x.id}|${y.id}`;
    const p = pairs.get(key) ?? { aId: x.id, bId: y.id, aSlug: x.slug, bSlug: y.slug, score: 0, reasons: [] };
    p.score = Math.max(p.score, score);
    if (!p.reasons.includes(reason)) p.reasons.push(reason);
    pairs.set(key, p);
  };
  const byKey = (key: (c: DupClub) => string[]) => {
    const m = new Map<string, DupClub[]>();
    for (const c of clubs) for (const k of key(c)) if (k) m.set(k, [...(m.get(k) ?? []), c]);
    return m;
  };
  for (const [ig, cs] of byKey((c) => c.instagrams.map((u) => u.toLowerCase().replace(/\/+$/, "")))) {
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) add(cs[i]!, cs[j]!, 0.95, `same Instagram ${ig}`);
  }
  for (const [site, cs] of byKey((c) => c.websites.map((u) => siteKey(u) ?? ""))) {
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) add(cs[i]!, cs[j]!, 0.9, `same website ${site}`);
  }
  for (const [acr, cs] of byKey((c) => {
    const a = c.acronym ? normalizeAcronym(c.acronym).toUpperCase() : "";
    return a.length >= 4 ? [a] : [];
  })) {
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++) add(cs[i]!, cs[j]!, 0.6, `same acronym ${acr}`);
  }
  const focused = clubs.filter((c) => focus.has(c.id));
  // One club listed by its initials ("WISHR") and another by its full name.
  const initialsOf = new Map(clubs.map((c) => [c.id, new Set(initialisms(c.name))]));
  for (const a of clubs) {
    const short = [a.name, a.acronym ?? ""]
      .map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ""))
      .filter((x) => x.length >= 4 && x.length <= 8 && !/\s/.test(x));
    if (!short.length || a.name.trim().includes(" ")) continue;
    for (const b of clubs)
      if (b.id !== a.id && short.some((x) => initialsOf.get(b.id)?.has(x)))
        add(a, b, 0.8, `"${a.name}" is the initialism of "${b.name}"`);
  }
  for (const a of focused) {
    const ta = distinctiveTokens(a.name);
    if (ta.length === 0) continue;
    for (const b of clubs) {
      if (a.id === b.id) continue;
      const sim = nameSimilarity(a.name, b.name);
      const tb = distinctiveTokens(b.name);
      // Two-plus distinctive words in common, or a one-word name matching exactly.
      if (sim >= 0.99 && (ta.length >= 2 || (ta.length === 1 && tb.length === 1 && (ta[0]?.length ?? 0) >= 6)))
        add(a, b, 0.85, `same distinctive name words (${ta.join(" ")})`);
    }
  }
  return [...pairs.values()].sort((a, b) => b.score - a.score);
}

// --- Initialisms ---------------------------------------------------------------------------------

const INITIAL_STOP = new Set(["of", "at", "the", "and", "for", "in", "a", "an", "to", "&"]);
const HARVARD_WORDS = new Set(["harvard", "radcliffe", "college", "undergraduate", "undergraduates", "university"]);

/**
 * Initialisms a club plausibly goes by ("Eating Concerns Hotline and Outreach" → "echo",
 * "Bengali Association of Students at Harvard College" → "bash"/"bashc"), for matching
 * handles like @harvardecho. Hyphenated words count once ("First-Year Urban Program" → "fup")
 * and as two. Only initialisms of 3+ letters. PURE.
 */
export function initialisms(name: string): string[] {
  const clean = name.replace(/\([^)]*\)/g, " ").replace(/[’']s\b/g, "");
  const out = new Set<string>();
  for (const hyphen of [false, true]) {
    const ws = (hyphen ? clean.replace(/-/g, " ") : clean)
      .split(/[^A-Za-z0-9-]+/)
      .map((w) => w.toLowerCase())
      .filter((w) => w && !INITIAL_STOP.has(w));
    const all = (hyphen ? clean.replace(/-/g, " ") : clean)
      .split(/[^A-Za-z0-9-]+/)
      .map((w) => w.toLowerCase())
      .filter(Boolean);
    // Every keep/drop choice of the small words ("Women In Science at Harvard-Radcliffe" → wishr).
    const stopIdx = all
      .map((w, k) => (INITIAL_STOP.has(w) ? k : -1))
      .filter((k) => k >= 0)
      .slice(0, 4);
    const subsets: string[][] = [];
    for (let mask = 0; mask < 1 << stopIdx.length; mask++)
      subsets.push(
        all.filter((w, k) => !INITIAL_STOP.has(w) || stopIdx.some((x, bit) => x === k && mask & (1 << bit))),
      );
    const variants = [
      ...subsets,
      ws,
      ws.filter((w) => !["college", "undergraduate", "undergraduates", "university"].includes(w)),
      ws.filter((w) => !HARVARD_WORDS.has(w)),
    ];
    for (const v of variants) {
      const i = v.map((w) => w[0] ?? "").join("");
      if (i.length >= 3) out.add(i);
    }
  }
  return [...out];
}

/** "Committee" is "hoco" on campus; Harvard's houses make a name Harvard-specific. */
const HOUSE =
  /\b(adams|cabot|currier|dudley|dunster|eliot|kirkland|leverett|lowell|mather|pforzheimer|quincy|winthrop)\b/i;

// --- Candidate scoring ---------------------------------------------------------------------------

export interface IdentityClub {
  name: string;
  acronym: string | null;
  aliases: string[];
  /** The club is a Harvard College (undergraduate) organization. */
  college: boolean;
}

export interface CandidateLink {
  url: string;
  title: string;
  description?: string;
}

export type CandidateVerdict = "accept" | "ambiguous" | "reject";

export interface ScoredCandidate {
  url: string;
  kind: string;
  score: number;
  verdict: CandidateVerdict;
  reasons: string[];
}

const OTHER_UNIVERSITY =
  /\b(yale|princeton|stanford|columbia|upenn|cornell|dartmouth|duke|berkeley|ucla|nyu|georgetown|northwestern|uchicago|brown university|mit\b|massachusetts institute|tufts|boston university|boston college|wellesley|oxford|cambridge university|university of (?!harvard)[a-z]+)/i;
const GRAD_SCHOOL =
  /\b(hbs|harvard business school|business school|hls|harvard law|law school|hks|kennedy school|gsas|graduate school|extension school|hsph|chan school|medical school|harvard medical|gsd|hgse|divinity school)\b/i;
const SPAM_HOST =
  /(^|\.)(pinterest\.[a-z.]+|scribd\.com|issuu\.com|coursehero\.com|studocu\.com|quizlet\.com|zoominfo\.com|rocketreach\.co|glassdoor\.com|indeed\.com|yelp\.com|amazon\.com|ebay\.com|etsy\.com|slideshare\.net|academia\.edu|researchgate\.net|wikipedia\.org|wikiwand\.com|thecrimson\.com|harvardindependent\.com|harvardpolitics\.com|niche\.com|collegevine\.com|reddit\.com|quora\.com|causeiq\.com|prospeo\.io|nih\.gov|refinery29\.com|harvard\.com|medium\.com|campusgroups\.com|speechwire\.com|guidestar\.org|propublica\.org|opencorporates\.com|bizapedia\.com|dnb\.com|newsindiatimes\.com|campusreform\.org)$/i;
const COMPANY = /\b(inc\.?|llc|ltd|corp\.?|company|official store|shop now|buy now|for sale)\b/i;
/** Harvard Alumni Association clubs ("Harvard Club of Japan") are not student organizations. */
const ALUMNI = /\bharvard club of\b|harvardclubof|\balumni\b|clubs\.harvard\.edu|(^|\s)harvardclub[a-z]/i;
/** Harvard hosts that are portals, news or research sites — never a student club's own site. */
const HARVARD_PORTAL_HOST =
  /^(soco\.college|college|news|gazette|dso\.college|gsas|hbs|hls|hks|seas|fas|dataverse|scalar\.fas|studentpower\.scalar\.fas|mgh|[a-z]+\.mgh|hms|hsph|library|clubs|[a-z]+\.clubs)\.harvard\.edu$|^harvard\.edu$/i;
/** Harvard hosts whose pages are portals (dead or HarvardKey), alumni, scholars' or news pages. */
const NOT_DIRECTORY_HOST =
  /^([a-z]+\.hms|hms|thehub\.college|engage\.[a-z.]+|calendar\.college|alumni|archive\.blogs|blogs|scholar|health|gse|sites|mittalsouthasiainstitute|asiacenter|undergrad\.gov|biophysics\.fas|chaplains|environment|lifesciences\.fas|publicservice\.fas|hsspa|alp\.fas)\.harvard\.edu$/i;
/** Event, news, people and listing paths aren't a page about one club. */
const NOT_DIRECTORY_PATH =
  /(\/|-)(event|events|news|ideas|announcements|people|person|people-terms|filter_by|subfield|tag|links|calendar|role)\b|\/(19|20)\d\d\//i;
/** A path that is an article/post/event rather than a site's home. */
const ARTICLE_PATH =
  /\/(19|20)\d\d\/|\/(article|articles|story|stories|news|blog|post|posts|event|events|project|calendar|gazette)\b/i;
const IDENTITY_KINDS = ["website", "instagram", "facebook", "linkedin", "linktree", "x", "youtube", "tiktok"];

/**
 * Score a candidate link for a club (0–100) and decide: accept (≥ 60), ambiguous (35–59),
 * reject (< 35). Rewards the exact name (title over snippet), the distinctive words, the
 * acronym and "Harvard"; a social profile must carry the club's name or acronym in its
 * handle, and a website must be a site root. Penalizes graduate-school, alumni and
 * other-university organizations for a College club, Harvard portals, articles, personal
 * profiles, companies, aggregators and spam. PURE.
 */
export function scoreCandidate(cand: CandidateLink, club: IdentityClub): ScoredCandidate {
  const reasons: string[] = [];
  const link = classifyLink(cand.url);
  const kind = link?.kind ?? "other";
  const reject = (why: string): ScoredCandidate => ({
    url: link?.url ?? cand.url,
    kind,
    score: 0,
    verdict: "reject",
    reasons: [...reasons, why],
  });
  if (!link) return reject("not a usable link");
  if (link.isPersonal) return reject("personal profile URL");
  if (link.isContentItem) return reject("a single post, not a profile or site");
  let host = "";
  let path = "/";
  try {
    const u = new URL(cand.url);
    host = u.hostname.replace(/^www\./, "").toLowerCase();
    path = u.pathname;
  } catch {
    return reject("unparseable URL");
  }
  if (SPAM_HOST.test(host)) return reject(`${host} is an aggregator/news/spam host`);
  if (!host.includes(".")) return reject("not a real host");
  if (!IDENTITY_KINDS.includes(kind)) return reject(`${kind} links aren't identity links`);
  if (kind === "website") {
    if (HARVARD_PORTAL_HOST.test(host)) return reject(`${host} is a Harvard portal/news/research host`);
    // A page about the club on a Harvard office/house site is a Harvard source, not the club's
    // site: its LAST path segment carries every distinctive word of the name, the title names
    // the club, and it isn't an event/news/people page or a dead/aggregating portal.
    const lastSeg = (path.split("/").filter(Boolean).pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const toks = distinctiveTokens(club.name);
    const housePage =
      /house committee/i.test(club.name) &&
      (HOUSE.exec(club.name)?.[1]?.toLowerCase() ?? "\u0000") === host.split(".")[0]?.replace(/house$/, "") &&
      /house-?committee|hoco/.test(path.toLowerCase());
    const named =
      housePage ||
      (toks.length >= 2 &&
        lastSeg.length >= 6 &&
        toks.every((t) => lastSeg.includes(t.slice(0, Math.max(4, t.length - 1)))));
    const titleNames =
      toks.length > 0 && toks.every((t) => cand.title.toLowerCase().includes(t.slice(0, Math.max(4, t.length - 1))));
    if (
      host.endsWith(".harvard.edu") &&
      !NOT_DIRECTORY_HOST.test(host) &&
      !NOT_DIRECTORY_PATH.test(path) &&
      named &&
      (titleNames || housePage)
    )
      return {
        url: link.url,
        kind: "harvard_directory",
        score: 70,
        verdict: "accept",
        reasons: ["Harvard page named for the club"],
      };
    const segs = path.split("/").filter(Boolean);
    const homeish = (seg: string) =>
      /^(home|index(\.html?)?|about(-us)?|welcome|get-involved|join(-us)?)$/i.test(seg) ||
      [distinctiveTokens(club.name).join(""), club.acronym?.toLowerCase() ?? "\u0000"].includes(
        seg.toLowerCase().replace(/[^a-z0-9]/g, ""),
      );
    if (ARTICLE_PATH.test(path) || segs.length >= 2 || (segs.length === 1 && !homeish(segs[0] ?? "")))
      return reject("an article or inner page, not the club's own site");
    if (/^(donate|give|giving|shop|store)\./.test(host)) return reject("a donation/shop page, not the club's site");
  }

  const text = `${cand.title} ${cand.description ?? ""}`;
  const lower = text.toLowerCase();
  const titleLower = cand.title.toLowerCase();
  const handle = (link.handle ?? "").toLowerCase();
  const hostCore = host.replace(/\.(com|org|net|io|co|edu|us|info|club|site)$/g, "").replace(/[^a-z0-9]/g, "");
  const names = [club.name, ...club.aliases].map((n) => n.toLowerCase().replace(/\s+/g, " "));
  const tokens = distinctiveTokens(club.name);
  let score = 0;

  if (names.some((n) => titleLower.includes(n))) {
    score += 40;
    reasons.push("exact name in title");
  } else if (names.some((n) => lower.includes(n))) {
    score += 15;
    reasons.push("exact name in snippet");
  }
  // A hyphenated word and its joined spelling are one word ("Pre-Law" / "Prelaw"): the text
  // carries both forms, and the name's tokens are tried both ways.
  const textWords = new Set([...words(text), ...words(joinHyphens(text))].map(stem));
  const present = (ts: string[]) =>
    ts.filter((t) => textWords.has(t) || [...textWords].some((w) => sameWord(w, t))).length;
  const joinedTokens = distinctiveTokens(joinHyphens(club.name));
  const [hit, ofTokens] =
    joinedTokens.length > 0 &&
    present(joinedTokens) / joinedTokens.length > present(tokens) / Math.max(1, tokens.length)
      ? [present(joinedTokens), joinedTokens]
      : [present(tokens), tokens];
  if (ofTokens.length > 0) {
    const ratio = hit / ofTokens.length;
    if (ratio >= 0.99) {
      score += 25;
      reasons.push("all distinctive words present");
    } else if (ratio >= 0.6) {
      score += 12;
      reasons.push(`${hit}/${ofTokens.length} distinctive words`);
    }
  }
  const acr = club.acronym ? normalizeAcronym(club.acronym).toLowerCase() : "";
  // The acronym as its own segment of the handle/host ("harvard_nugs", "huspark"), not inside a word.
  const identSegments = `${handle} ${host.split(".")[0] ?? ""}`;
  const acrInIdent =
    acr.length >= 3 &&
    new RegExp(`(^|[^a-z])${acr}($|[^a-z])|(^|[^a-z])(harvard|hu|hc)${acr}($|[^a-z])|${acr}harvard`).test(
      identSegments,
    );
  // A handle/host that is an initialism of the name, with "harvard"/"hu"/"hc" around it
  // (@harvardbasha, @hcgaasa, fap.fas.harvard.edu), or "hoco" for a House Committee.
  const bare = (x: string) =>
    x
      .replace(/[^a-z0-9]/g, "")
      .replace(/^(harvard|hu|hc|hr)/, "")
      .replace(/harvard$/, "");
  const initialIdent = [handle, host.split(".")[0] ?? ""].some((seg) => {
    const b = bare(seg);
    return (
      b.length >= 3 && initialisms(club.name).some((i) => b === i || (b.startsWith(i) && b.length - i.length <= 1))
    );
  });
  const houseName = HOUSE.exec(club.name)?.[1]?.toLowerCase() ?? null;
  const hocoIdent =
    /house committee/i.test(club.name) &&
    houseName !== null &&
    /hoco/.test(`${handle} ${host} ${path.toLowerCase()}`) &&
    `${handle} ${host} ${path.toLowerCase()}`.includes(houseName);
  if (acr.length >= 3 && (new RegExp(`\\b${acr}\\b`).test(lower) || acrInIdent)) {
    score += 15;
    reasons.push("acronym matches");
  }
  const stemJoined = tokens.join("");
  const ident = `${handle} ${hostCore}`;
  const identMatch =
    initialIdent ||
    hocoIdent ||
    (stemJoined.length >= 5 && ident.includes(stemJoined)) ||
    tokens.some((t) => t.length >= 6 && ident.includes(t)) ||
    acrInIdent;
  // For a website the domain must carry the name itself, not one shared word ("campusreform").
  const strongIdent =
    initialIdent ||
    hocoIdent ||
    (stemJoined.length >= 5 && ident.includes(stemJoined)) ||
    tokens.filter((t) => t.length >= 4 && ident.includes(t)).length >= Math.min(2, tokens.length) ||
    acrInIdent;
  if (identMatch) {
    score += 20;
    reasons.push("handle/domain contains the name");
  }
  // "Harvard" must be in the title, handle or domain: a national organization's page mentions
  // Harvard in a snippet ("our Harvard chapter…") without being the chapter.
  const harvardOwn =
    /harvard|radcliffe/.test(titleLower) ||
    /harvard|hrvd|radcliffe/.test(handle) ||
    /^(hu|hc)[a-z]/.test(handle) ||
    hostCore.includes("harvard") ||
    host.endsWith(".harvard.edu") ||
    hocoIdent; // a Harvard house's committee
  if (initialIdent && !reasons.includes("acronym matches")) {
    score += 15;
    reasons.push("handle is the name's initialism");
  }
  if (harvardOwn) {
    score += 15;
    reasons.push("Harvard in title/handle/domain");
  } else if (/harvard/.test(lower)) {
    reasons.push("Harvard only in the snippet");
  } else {
    score -= 15;
    reasons.push("no Harvard reference");
  }
  if (club.college && GRAD_SCHOOL.test(`${text} ${host} ${handle}`) && !/undergrad|college/i.test(text)) {
    score -= 45;
    reasons.push("graduate-school organization, not College");
  }
  if (OTHER_UNIVERSITY.test(text) && !/harvard/i.test(text)) {
    score -= 50;
    reasons.push("another university's organization");
  }
  if (ALUMNI.test(`${text} ${host} ${handle}`) && !/alumni/i.test(club.name)) {
    score -= 45;
    reasons.push("Harvard alumni club, not a student organization");
  }
  if (COMPANY.test(text)) {
    score -= 20;
    reasons.push("looks like a company or shop");
  }
  // A social profile must carry the club's name or acronym in its handle (titles are easy to share).
  // Either the whole name is in the handle, or part of it plus "harvard" ("harvarddharma");
  // part of it alone ("humanist-chaplaincy") may be a neighbouring organization.
  if (kind !== "website" && !(strongIdent || (identMatch && /harvard|hrvd|radcliffe/.test(handle)))) {
    score = Math.min(score, 50);
    reasons.push("handle doesn't carry the club's name");
  }
  // A website must be named by its title or domain, not just mention the club in a snippet.
  if (kind === "website" && !strongIdent) {
    score = Math.min(score, 50);
    reasons.push("site's domain isn't named for the club");
  }
  if (!harvardOwn) score = Math.min(score, 50);
  // One distinctive word ("Catholic", "Mexican") is shared by many groups: the title must
  // carry the club's exact name, or the handle its initialism.
  if (
    tokens.length === 1 &&
    !reasons.includes("exact name in title") &&
    !initialIdent &&
    (SHARED_WORDS.has(tokens[0] ?? "") || !/harvard|radcliffe/.test(`${handle} ${host}`))
  ) {
    score = Math.min(score, 50);
    reasons.push("one-word name: needs the exact name in the title");
  }
  // A club whose own name doesn't say Harvard ("Sigma Chi", "Students for Freedom") shares it
  // with national organizations: the handle or domain itself must say Harvard.
  if (
    !/harvard|radcliffe|crimson|first[- ]year/i.test(club.name) &&
    !HOUSE.test(club.name) &&
    !/harvard|radcliffe|crimson|hrvd/.test(`${handle} ${host}`)
  ) {
    score = Math.min(score, 50);
    reasons.push("generic name: needs Harvard in the handle or domain");
  }
  score = Math.max(0, Math.min(100, score));
  const verdict: CandidateVerdict = score >= 60 ? "accept" : score >= 35 ? "ambiguous" : "reject";
  return { url: link.url, kind, score, verdict, reasons };
}
