import { CSS_LIKE_TEXT, emailPublishProblem, normalizeUrl } from "@hci/core";
import { PARKED_HOSTS } from "../load";
import { nameKeys } from "./duplicates";
import { baseDomain, domainLabel, hostOf, identityScore, identityTokens, nameForms, namesClub, plain } from "../text";
import type { AuditClub, AuditData, AuditFinding, AuditLink, Confidence, Severity } from "../types";

/**
 * Link checks (websites, social handles, application links). PURE over `AuditData`.
 * A rejection fix targets every active club.link claim of that URL on the club, exactly
 * like `pnpm hci reject-link`.
 */

const SOCIAL_KINDS = new Set(["instagram", "facebook", "linkedin", "x", "tiktok", "youtube"]);

/** Harvard schools' and offices' own accounts: never a student club's. */
const INSTITUTIONAL_HANDLES = new Set([
  "harvard",
  "harvardhbs",
  "hbsadmissions",
  "harvardcollege",
  "harvardgsas",
  "harvardseas",
  "harvardgazette",
  "harvardlaw",
  "harvardkennedyschool",
  "harvardiop",
  "harvardhillel",
  "theharvardcrimson",
  "thecrimson",
  "harvardbusinessschool",
  "harvard-business-school",
  "harvardgse",
  "harvardchan",
  "harvarduniversity",
]);
/** Website-builder and theme vendors whose handles sit in page footers. */
const VENDOR_HANDLES = /^(wpzoom|squarespace|wix|elementor|themeisle|godaddy|weebly|wordpress|carrd|webflow)$/i;
/** Other universities' markers in a handle ("crueltyfreeneu"). */
const OTHER_SCHOOL_HANDLE =
  /(neu|northeastern|bu|bostonu|tufts|yale|princeton|stanford|columbia|brown|upenn|cornell|dartmouth)$/;

/** Directory pages of one organization, keyed by its slug: the slug must be about this club. */
const ORG_SLUG_PATH =
  /\/(?:organization|organizations|student-clubs|clubs|engage\/organization|chaplaincies|programs)\/([a-z0-9][a-z0-9-]{2,})\/?$/i;
/** Harvard pages that list many groups, never one club's site. */
const GENERIC_HARVARD_PATH =
  /^\/(?:initiatives|student-organizations?|student-groups?|clubs|organizations|resources|students?)\/?$/i;
/** Facebook paths that are not a page: a share button, a hashtag, or a page URL cut short. */
const FACEBOOK_NOT_A_PAGE =
  /^\/(people|pages|p|hashtag|share\.php|sharer(\.php)?|plugins|tr|dialog|recover|story\.php|login|photo\.php|permalink\.php)(\/.*)?$/i;
/** "matt.urban.353": Facebook's default URL for a person's profile. */
const PERSONAL_FB = /^[a-z]+\.[a-z]+(\.\d+)?$/;
const PORTAL_HOST =
  /^(thehub\.college\.harvard\.edu|soco\.college\.harvard\.edu|[a-z]+\.campuslabs\.com|engage\.[a-z.]+\.harvard\.edu|harvard\.campusgroups\.com)$/;
/** A blog post or article URL standing in for a website. */
const ARTICLE_URL = /[?&]p=\d+|\/20\d\d\/\d\d\/|\/(?:news|blog|article|story|posts?)\/[^/]+/i;
/** Graduate schools' hosts and paths. */
const GRAD_SCHOOL_URL =
  /(^|\.)(hbs\.edu|law\.harvard\.edu|hks\.harvard\.edu|hsph\.harvard\.edu|sph\.harvard\.edu|gse\.harvard\.edu|gsd\.harvard\.edu|hms\.harvard\.edu|hds\.harvard\.edu|extension\.harvard\.edu)$|hks\.campuslabs\.com/;

interface Ctx {
  data: AuditData;
  out: AuditFinding[];
  /** Per club: normalized link URLs whose evidence came from one of the club's own websites. */
  foundOnOwnSite: Map<string, Set<string>>;
}

function push(
  ctx: Ctx,
  link: AuditLink,
  check: string,
  area: AuditFinding["area"],
  severity: Severity,
  confidence: Confidence,
  detail: string,
  reject: boolean,
) {
  const club = ctx.data.clubs.get(link.clubId);
  // A wrong link's page also left facts behind (a name, a summary, more links): reject the
  // ones whose only evidence is that page. A closed form or a dead page was the club's own,
  // so what it said stays (it is history, not an error).
  const page = urlKey(link.url);
  const dependents =
    reject && WRONG_IDENTITY.has(check)
      ? ctx.data.claims
          .filter(
            (c) =>
              c.clubId === link.clubId &&
              c.fieldKey !== "club.press_mention" &&
              c.evidence.length > 0 &&
              c.evidence.every((e) => urlKey(e.sourceUrl) === page),
          )
          .map((c) => c.id)
      : [];
  const claimIds = [...new Set([...link.claimIds, ...dependents])];
  ctx.out.push({
    check,
    area,
    severity,
    confidence,
    clubId: link.clubId,
    slug: club?.slug ?? null,
    subject: link.url,
    detail,
    displayed: true,
    fix:
      reject && claimIds.length
        ? {
            kind: "reject_claims",
            claimIds,
            reason: `audit ${check}: ${detail}${dependents.length ? ` (with ${dependents.length} fact(s) taken only from that page)` : ""}`,
          }
        : null,
  });
}

const urlKey = (u: string) => (normalizeUrl(u) ?? u).toLowerCase().replace(/\/+$/, "");

/** Checks that find a link is not the club's at all (so facts from its page aren't either). */
const WRONG_IDENTITY = new Set([
  "link.directory_page_other_org",
  "link.parked_domain",
  "link.redirects_unrelated",
  "link.article_as_website",
  "link.generic_harvard_page",
  "link.belongs_to_other_club",
]);

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

/** Handle (lowercase, no @) of a social profile URL. */
export function socialHandleOf(link: Pick<AuditLink, "url" | "handle" | "kind">): string {
  if (link.handle) return link.handle.replace(/^@/, "").toLowerCase();
  const segs = pathOf(link.url)
    .split("/")
    .filter(Boolean)
    .filter((s) => !/^(company|in|pages|groups|channel|c|user|people|pg|school|showcase)$/i.test(s));
  return (segs[0] ?? "").replace(/^@/, "").toLowerCase();
}

function websiteChecks(ctx: Ctx, link: AuditLink, club: AuditClub) {
  const host = hostOf(link.url);
  const path = pathOf(link.url);

  // A directory page of one organization whose slug names a different organization.
  // A fetched page is judged by its title: CMS slugs survive page copies ("/programs/
  // alzheimersbuddies-8acm7" is PBHA's Y2Y page). An unfetched one only by its slug.
  const slug = path.match(ORG_SLUG_PATH)?.[1];
  const titleSaysOther = link.pageTitle ? titleIsOtherOrg(link.pageTitle, club) : null;
  if (
    slug &&
    (link.kind === "website" || link.kind === "harvard_directory") &&
    (titleSaysOther ?? slugNamesOther(slug, club))
  )
    push(
      ctx,
      link,
      "link.directory_page_other_org",
      "links",
      "critical",
      "high",
      link.pageTitle
        ? `directory page titled "${link.pageTitle}" is about another organization than "${club.name}"`
        : `directory page /${slug} names no part of "${club.name}"`,
      true,
    );

  if (link.kind !== "website") return;

  // Dead link: the page itself is gone (403 and 5xx are blocks/outages, not evidence).
  if (link.lastFetch && link.lastFetch.status === "http_error" && [404, 410].includes(link.lastFetch.httpStatus ?? 0))
    push(
      ctx,
      link,
      "link.dead",
      "links",
      "high",
      "high",
      `HTTP ${link.lastFetch.httpStatus} when last fetched (${link.lastFetch.at.toISOString().slice(0, 10)})`,
      true,
    );
  else if (link.lastFetch?.status === "network_error" && /^host unreachable/.test(link.lastFetch.error ?? "")) {
    const kind = networkFailureKind(link.lastFetch.error ?? "");
    const since = link.lastFetch.failingSince ?? link.lastFetch.at;
    const days = (link.lastFetch.at.getTime() - since.getTime()) / 86_400_000;
    const sustained = (link.lastFetch.failures ?? 1) >= 2 && days >= 7;
    const when = `${link.lastFetch.at.toISOString().slice(0, 10)}${sustained ? `, failing since ${since.toISOString().slice(0, 10)}` : ""}`;
    if (kind === "tls_chain")
      // Our client lacks the site's intermediate certificate; browsers fetch it and load fine.
      push(ctx, link, "link.tls_chain_incomplete", "links", "low", "low", `${link.lastFetch.error} (${when})`, false);
    else if (kind === "tls")
      // The site answers, but its HTTPS certificate is wrong (often a host's default cert):
      // visitors see a warning. Not a dead site; the club may need to fix its hosting.
      push(ctx, link, "link.tls_error", "links", "low", "medium", `${link.lastFetch.error} (${when})`, false);
    else
      // One timeout or DNS miss is not a dead site (a local outage looks the same): only a
      // failure streak of a week or more is "high"; review, then `pnpm hci reject-link`.
      push(
        ctx,
        link,
        "link.unreachable",
        "links",
        sustained ? "high" : "medium",
        sustained && kind === "dns" ? "high" : "medium",
        `${kind === "timeout" ? "timed out" : kind === "dns" ? "domain doesn't resolve" : "unreachable"}: ${link.lastFetch.error} (${when})`,
        false,
      );
  } else if (link.lastFetch?.status === "http_error" && (link.lastFetch.httpStatus ?? 0) >= 500)
    push(
      ctx,
      link,
      "link.server_error",
      "links",
      "low",
      "low",
      `HTTP ${link.lastFetch.httpStatus} when last fetched`,
      false,
    );

  // Parked domain, or a redirect to an unrelated site.
  if (link.lastSnapshot) {
    const finalHost = hostOf(link.lastSnapshot.finalUrl);
    if (link.lastSnapshot.parked || PARKED_HOSTS.test(finalHost))
      push(
        ctx,
        link,
        "link.parked_domain",
        "links",
        "critical",
        "high",
        `lands on a parked/for-sale page (${finalHost})`,
        true,
      );
    else if (finalHost && baseDomain(finalHost) !== baseDomain(host) && !finalHost.endsWith("harvard.edu")) {
      const related =
        identityScore(domainLabel(finalHost), club) > 0 ||
        domainLabel(finalHost).includes(domainLabel(host).replace(/^harvard/, "")) ||
        domainLabel(host).includes(domainLabel(finalHost).replace(/^(harvard|the)/, "")) ||
        sharedRun(domainLabel(host), domainLabel(finalHost)) >= 4;
      // A new Harvard-named domain is usually a rename; only an unrelated one is a lapsed site.
      const harvardish = /harvard|crimson|radcliffe/.test(finalHost);
      if (!related)
        push(
          ctx,
          link,
          "link.redirects_unrelated",
          "links",
          harvardish ? "medium" : "critical",
          harvardish ? "medium" : "high",
          `redirects to ${finalHost}, which names nothing about the club${harvardish ? " (a rename?)" : ""}`,
          !harvardish,
        );
    }
  }

  if (ARTICLE_URL.test(link.url) && !/\/(?:about|join)/i.test(path))
    push(
      ctx,
      link,
      "link.article_as_website",
      "links",
      "high",
      "high",
      "an article or blog post, not the club's site",
      true,
    );

  if (host.endsWith("harvard.edu") && GENERIC_HARVARD_PATH.test(path) && identityScore(path, club) === 0)
    push(
      ctx,
      link,
      "link.generic_harvard_page",
      "links",
      "high",
      "high",
      `a Harvard page listing many groups (${path})`,
      true,
    );

  if (PORTAL_HOST.test(host))
    push(
      ctx,
      link,
      "link.portal_as_website",
      "links",
      "low",
      "medium",
      "a Harvard portal page, not the club's own site",
      false,
    );

  if (club.college && GRAD_SCHOOL_URL.test(host))
    push(
      ctx,
      link,
      "link.grad_school_on_college_club",
      "links",
      "high",
      "medium",
      `${host} belongs to a graduate school; "${club.name}" is a College group`,
      false,
    );
}

/**
 * Whether a directory slug ("/programs/harmony-mentoring-ceczy") is about another organization:
 * none of its meaningful words, nor its words' initials ("boston-refugee-youth-enrichment" →
 * "brye"), match the club. Random ids ("fxrbkxgwn1q8…") can't be judged and return false. PURE.
 */
export function slugNamesOther(slug: string, club: AuditClub): boolean {
  const words = slug
    .toLowerCase()
    .split("-")
    .filter((w) => w && !/\d/.test(w) && !/^(pbha|s|the|of|and|harvard|undergraduate|college|club|program)$/.test(w));
  if (!words.length || words.some((w) => w.length > 14 && !/[aeiou]{1}.*[aeiou]/.test(w))) return false;
  const tokens = identityTokens(club);
  const joined = words.join("");
  if (identityScore(joined, club) > 0 || identityScore(words.join(" "), club) > 0) return false;
  const initials = words.map((w) => w[0]).join("");
  if (initials.length >= 3 && tokens.includes(initials)) return false;
  // "brye-extension": a word that starts one of the club's initialisms.
  if (words.some((w) => w.length >= 3 && tokens.some((t) => t.length >= 4 && t.startsWith(w)))) return false;
  return true;
}

const LOGIN_TITLE = /identity system|\blog ?in\b|\bsign ?in\b|single sign-on|harvardkey|access denied/i;
const ORG_NOUN =
  /\b(club|society|association|organization|council|committee|caucus|alliance|union|collective|coalition|initiative|forum)$/i;

/**
 * Whether a fetched page's title is about another organization: it names nothing of the
 * club, or it is itself an organization's name that isn't one of the club's names
 * ("Entrepreneurship Through Acquisition Club | MBA" for "HBS Entrepreneurship Club").
 * Login walls say nothing and return null. PURE.
 */
export function titleIsOtherOrg(title: string, club: AuditClub): boolean | null {
  if (LOGIN_TITLE.test(title)) return null;
  const head = title.split(/\s+[|–—-]\s+/)[0]?.trim() ?? "";
  // A title that is itself an organization's name must be one of this club's names (up to
  // spelling); sharing a word ("Entrepreneurship") is not enough.
  if (ORG_NOUN.test(head))
    return (
      !nameForms(club).includes(plain(head)) && ![club.name, ...club.projectedAliases].some((n) => sameOrgName(head, n))
    );
  return !namesClub(title, club) && identityScore(plain(title), club) === 0;
}

/**
 * Two spellings of one organization's name: after `nameKeys` normalization one's words are
 * a subset of the other's, allowing abbreviations ("Biotech"/"Biotechnology") and joined
 * words ("Prelaw"/"Pre-Law"). PURE.
 */
export function sameOrgName(a: string, b: string): boolean {
  for (const ka of nameKeys(a))
    for (const kb of nameKeys(b)) {
      // Keys are sorted words, so "black pre law" sorts to "black law pre": compare letters.
      const letters = (k: string) => [...k.replace(/ /g, "")].sort().join("");
      if (ka.replace(/ /g, "").length >= 6 && letters(ka) === letters(kb)) return true;
      const [x, y] = [ka.split(" "), kb.split(" ")];
      const [small, big] = x.length <= y.length ? [x, y] : [y, x];
      const has = (t: string) =>
        big.some((u) => u === t || (Math.min(u.length, t.length) >= 5 && (u.startsWith(t) || t.startsWith(u))));
      if (small.every(has)) return true;
      if (small.join("") === big.join("")) return true;
    }
  return false;
}

/** Longest common substring length (for "harvardcollegedebatingunion" vs "harvarddebatingunion"). */
function sharedRun(a: string, b: string): number {
  const x = a.replace(/^(harvard|the)/, "");
  const y = b.replace(/^(harvard|the)/, "");
  let best = 0;
  for (let i = 0; i < x.length; i++)
    for (let j = 0; j < y.length; j++) {
      let k = 0;
      while (x[i + k] && x[i + k] === y[j + k]) k++;
      if (k > best) best = k;
    }
  return best;
}

function socialChecks(ctx: Ctx, link: AuditLink, club: AuditClub) {
  if (link.kind === "facebook" && FACEBOOK_NOT_A_PAGE.test(pathOf(link.url))) {
    push(
      ctx,
      link,
      "social.not_a_profile",
      "social",
      "high",
      "high",
      `${pathOf(link.url)} is not a Facebook page (a share button, hashtag or truncated URL)`,
      true,
    );
    return;
  }
  const handle = socialHandleOf(link);
  if (!handle || link.kind === "youtube" || /^\d+$/.test(handle) || handle.startsWith("groups/")) return;
  const flat = handle.replace(/[^a-z0-9]/g, "");
  const fromOwnSite =
    link.discoveredVia.includes("club_website") ||
    (ctx.foundOnOwnSite.get(link.clubId)?.has(link.normalizedUrl) ?? false);
  if (link.kind === "facebook" && PERSONAL_FB.test(handle) && /\d/.test(handle) && identityScore(flat, club) === 0) {
    push(
      ctx,
      link,
      "social.personal_or_unrelated",
      "social",
      "critical",
      "high",
      `@${handle} is a person's Facebook profile`,
      true,
    );
    return;
  }
  if (
    (INSTITUTIONAL_HANDLES.has(flat) || INSTITUTIONAL_HANDLES.has(handle)) &&
    identityScore(flat.replace(/^(the)?harvard/, ""), club) === 0
  ) {
    push(
      ctx,
      link,
      "social.institutional_account",
      "social",
      "critical",
      "high",
      `@${handle} is a Harvard school/office account`,
      true,
    );
    return;
  }
  if (VENDOR_HANDLES.test(flat)) {
    push(
      ctx,
      link,
      "social.vendor_account",
      "social",
      "critical",
      "high",
      `@${handle} is a website vendor's account`,
      true,
    );
    return;
  }
  if (OTHER_SCHOOL_HANDLE.test(flat) && !/harvard/.test(flat) && identityScore(flat, club) <= 1) {
    push(ctx, link, "social.other_school", "social", "critical", "high", `@${handle} belongs to another school`, true);
    return;
  }
  if (identityScore(flat, club) > 0) return;
  const harvardish = /harvard|crimson|radcliffe|^hu|^hc|hu$|hc$/.test(flat);
  // Unrelated handles found on a club's own pages are members', designers' or vendors' accounts.
  if (fromOwnSite && !harvardish)
    push(
      ctx,
      link,
      "social.personal_or_unrelated",
      "social",
      "critical",
      "high",
      `@${handle} shares nothing with the club's name (found on its own pages: likely a member's or vendor's account)`,
      true,
    );
  else
    push(
      ctx,
      link,
      "social.unrelated_handle",
      "social",
      "medium",
      harvardish ? "low" : "medium",
      `@${handle} shares nothing with the club's name, acronym or initials`,
      false,
    );
}

/** One handle or site on several clubs: give it to the club it names, flag the rest. */
function sharedLinkChecks(ctx: Ctx) {
  const groups = new Map<string, AuditLink[]>();
  for (const l of ctx.data.links) {
    let key: string | null = null;
    if (SOCIAL_KINDS.has(l.kind) && l.kind !== "youtube") key = `${l.kind}:${socialHandleOf(l)}`;
    else if (l.kind === "website" && !PORTAL_HOST.test(hostOf(l.url)) && !hostOf(l.url).endsWith("harvard.edu"))
      key = `site:${hostOf(l.url)}`;
    if (!key || key.endsWith(":")) continue;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  for (const [key, ls] of groups) {
    const clubIds = [...new Set(ls.map((l) => l.clubId))];
    if (clubIds.length < 2) continue;
    const label = key.slice(key.indexOf(":") + 1);
    const scored = clubIds.map((id) => {
      const club = ctx.data.clubs.get(id);
      return { id, club, score: club ? identityScore(label, club) : 0 };
    });
    const best = Math.max(...scored.map((s) => s.score));
    const winners = scored.filter((s) => s.score === best);
    for (const s of scored) {
      // Only a loser with a descriptive name can be judged ("HCURA" alone names nothing).
      const loses =
        winners.length === 1 && s.score === 0 && best > 0 && (s.club?.name.trim().split(/\s+/).length ?? 0) >= 2;
      for (const l of ls.filter((x) => x.clubId === s.id))
        push(
          ctx,
          l,
          loses ? "link.belongs_to_other_club" : "link.shared_by_clubs",
          l.kind === "website" ? "links" : "social",
          loses ? "high" : "medium",
          loses ? "high" : "low",
          loses
            ? `${label} names "${winners[0]?.club?.name}", which also lists it`
            : `${label} is listed for ${clubIds.length} clubs: ${scored.map((x) => x.club?.slug).join(", ")}`,
          loses,
        );
    }
  }
}

/**
 * A label that was never visible words: CSS from inside an anchor (the link is whatever
 * decorative element wrapped it), an icon-font class ("icon-comp Comp") or a site builder's
 * "Folder:" prefix. CSS means the link was not a labelled application at all, so it is
 * rejected; the others are only reported (a replay re-labels them).
 */
function labelChecks(ctx: Ctx, link: AuditLink) {
  const label = link.label ?? "";
  if (!label) return;
  if (CSS_LIKE_TEXT.test(label)) {
    push(ctx, link, "link.css_label", "links", "high", "high", `label is CSS text ("${label.slice(0, 60)}")`, true);
    return;
  }
  if (/^(?:icon|fa|fas|far|fab|glyphicon)[-_]\w|^Folder:/i.test(label))
    push(ctx, link, "link.markup_label", "links", "medium", "high", `label carries page markup ("${label}")`, false);
}

function applicationChecks(ctx: Ctx, link: AuditLink, club: AuditClub, joinEvidence: Set<string>) {
  if (link.kind !== "application_form") return;
  if (link.formClosed) {
    push(
      ctx,
      link,
      "application.form_closed",
      "application",
      "high",
      "high",
      "the form says it is no longer accepting responses",
      true,
    );
    return;
  }
  const label = plain(link.label);
  const applyish =
    /\b(apply|application|applications|comp|recruit|join|interest|audition|tryout|sign up|signup|membership)\b/.test(
      label,
    );
  if (!joinEvidence.has(club.id) && !applyish)
    push(
      ctx,
      link,
      "application.form_without_recruiting_evidence",
      "application",
      "low",
      "low",
      `form "${link.label ?? "untitled"}" with no joining/recruiting fact for the club`,
      false,
    );
  if (
    label &&
    !applyish &&
    identityTokens(club).every((t) => !label.replace(/ /g, "").includes(t)) &&
    /\b(rsvp|ticket|order|feedback|survey|registration|register|waiver)\b/.test(label)
  )
    push(
      ctx,
      link,
      "application.form_unrelated",
      "application",
      "medium",
      "medium",
      `form "${link.label}" looks like an event/registration form, not an application`,
      false,
    );
}

/**
 * Email links (§21): a template address ("info@mysite.com") or text run into an address is
 * wrong data; a person's address must not be published. The site already hides these
 * (publicProfile); rejecting them keeps the data clean too.
 */
function emailChecks(ctx: Ctx, link: AuditLink, club: AuditClub) {
  if (link.kind !== "email") return;
  const problem = emailPublishProblem(link.url.replace(/^mailto:/i, ""), [
    club.name,
    ...(club.acronym ? [club.acronym] : []),
    ...club.aliases,
  ]);
  if (!problem) return;
  if (problem === "personal")
    push(
      ctx,
      link,
      "link.personal_email",
      "links",
      "high",
      "medium",
      "looks like a person's address, not the club's",
      false,
    );
  else push(ctx, link, `link.${problem}_email`, "links", "medium", "high", `${problem} email address`, true);
}

export function checkLinks(data: AuditData): AuditFinding[] {
  const siteHosts = new Map<string, Set<string>>();
  for (const l of data.links)
    if (l.kind === "website") siteHosts.set(l.clubId, (siteHosts.get(l.clubId) ?? new Set()).add(hostOf(l.url)));
  const foundOnOwnSite = new Map<string, Set<string>>();
  for (const c of data.claims) {
    if (c.fieldKey !== "club.link") continue;
    const hosts = siteHosts.get(c.clubId);
    if (!hosts || !c.evidence.some((e) => hosts.has(hostOf(e.sourceUrl)))) continue;
    const url = (c.value as { url?: string }).url ?? "";
    const link = data.links.find((l) => l.clubId === c.clubId && l.claimIds.includes(c.id));
    foundOnOwnSite.set(c.clubId, (foundOnOwnSite.get(c.clubId) ?? new Set()).add(link?.normalizedUrl ?? url));
  }
  const ctx: Ctx = { data, out: [], foundOnOwnSite };
  const joinEvidence = new Set(
    data.claims.filter((c) => c.fieldKey === "club.join_mode" || c.fieldKey.startsWith("cycle.")).map((c) => c.clubId),
  );
  for (const link of data.links) {
    const club = data.clubs.get(link.clubId);
    if (!club) continue;
    websiteChecks(ctx, link, club);
    if (SOCIAL_KINDS.has(link.kind)) socialChecks(ctx, link, club);
    labelChecks(ctx, link);
    applicationChecks(ctx, link, club, joinEvidence);
    emailChecks(ctx, link, club);
  }
  sharedLinkChecks(ctx);
  return ctx.out;
}

/** What kind of network failure an error message describes. PURE. */
export function networkFailureKind(error: string): "dns" | "tls" | "tls_chain" | "timeout" | "other" {
  if (/unable to get local issuer certificate|unable to verify the first certificate/i.test(error)) return "tls_chain";
  if (/certificate|altnames|self[- ]signed|SSL|TLS|CERT_/i.test(error)) return "tls";
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|NXDOMAIN|doesn'?t resolve/i.test(error)) return "dns";
  if (/timeout|timed out|aborted/i.test(error)) return "timeout";
  return "other";
}
