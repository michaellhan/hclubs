import {
  aboutTextProblem,
  auditionPrepProblem,
  eventBlurbProblem,
  governanceActivityProblem,
  namesPeopleProblem,
  navTextProblem,
  notAboutClubProblem,
} from "../../extract/evidence-rules";

// Shared with the extractors since 1.16.24 (ADR 0033 amendment); re-exported for tests.
export { namedLeader } from "../../extract/evidence-rules";
import { namesClub, plain } from "../text";
import type { AuditClaim, AuditClub, AuditData, AuditFinding, Confidence, Severity } from "../types";

/** Manual entries and submissions were checked by a person; only extracted text is judged. */
const extracted = (c: AuditClaim) => c.evidence.some((e) => e.method !== "manual" && e.method !== "user_submission");

/**
 * Description and summary checks. PURE. Questionable text is only flagged; a fix (rejection)
 * is attached only to text that is unambiguously not a description of the club.
 */

const DESCRIPTION_FIELDS = new Set(["club.short_description", "club.long_description", "club.mission"]);
const NEWS_SOURCES = new Set(["harvard_crimson"]);

/** Text that is never a club description (navigation, legal, commerce, page furniture). */
const JUNK: [RegExp, string][] = [
  [/\b(we use cookies|cookie (policy|settings|preferences)|accept (all )?cookies)\b/i, "cookie banner text"],
  [/\b(privacy policy|terms of (use|service)|all rights reserved)\b|©/i, "legal/footer text"],
  [/\b(skip to (main )?content|toggle navigation|main menu|back to top)\b/i, "navigation text"],
  [/\b(page not found|404 error|coming soon|under construction|lorem ipsum)\b/i, "placeholder page text"],
  // Website-builder template copy left on a page (Wix, Squarespace, WordPress themes).
  [
    /\b(use this space to (write|tell|describe|introduce)|visitors will want to know|(double[- ])?click (here )?to edit|i['’]m a (paragraph|title)|add your own (content|text)|this is your (about|team) (page|section)|tell (your )?visitors (more )?about)\b/i,
    "website template text",
  ],
  // A constitution's article heading: "Article One: Name and Relation with HCSSA The name of this organization shall be…".
  [/^\W*Article (?:One|I|1)\b[^.]{0,80}\bname of (?:this|the) organi[sz]ation shall be\b/i, "constitution text"],
  [/\b(subscribe to (our|the) newsletter|sign up for (our|the) newsletter|enter your email)\b/i, "subscription prompt"],
  [/\b(donate (now|today)|make a (gift|donation)|your (gift|donation) (helps|supports))\b/i, "donation pitch"],
  [/\b(add to cart|buy (tickets|now)|tickets? (are )?(on sale|available)|checkout)\b/i, "sales text"],
  [
    /\b(this page is for|this website (is|was)|welcome to (our|the) (new )?(website|site|page))\b/i,
    "text about the web page",
  ],
  [/\b(enable javascript|javascript is (disabled|required)|loading\.\.\.)/i, "page-loading text"],
  // Only as a heading: "…and contact information to get help" is a fine description.
  [
    /^\W*(staff )?contact information\b|\bstaff contact\b|^\W*meet (the|our) (team|board|presidents?|officers|leadership|executive board)\b/i,
    "contact or team-page text",
  ],
  // Wikipedia list residue: "(1836, 1878)" or "founded in 1971." says nothing about what the club does.
  [/^[\s(]*\d{4}(?:\s*[,–-]\s*\d{4})*[\s).]*$/, "only years"],
  [/^\s*(?:founded|established|formed|organized)(?: in)? \d{4}\.?\s*$/i, "only a founding year"],
];
/** Text about a person, not the club (article bylines, bios). */
const BIO =
  /\b(is a (first-year|freshman|sophomore|junior|senior) (in|at|concentrating)|staff writer|can be reached at|is (a|an) (crimson|staff) (writer|editor|reporter)|her research|his research|she is a|he is a)\b/i;
/** Our own listing leaking into the text ("listed among computer science clubs"). */
const LISTING_META =
  /\b(listed (among|in|on|as|under|for|with)|appears (on|in) (the|a) (list|directory)|this (listing|directory))\b/i;
/** Wikipedia markers. */
const WIKI_MARKER = /\[(\d+|citation needed|clarification needed|when\?|who\?|according to whom\?|dubious[^\]]*)\]/i;
/** Marketing superlatives a summary must not add on its own. */
const MARKETING =
  /\b(premier|(?:the|a) leading|world-class|best|top|renowned|prestigious|elite|largest|oldest|most (prestigious|selective|competitive))\b/i;
const EVENT_AD =
  /\b(join us|rsvp|this (friday|saturday|sunday|monday|tuesday|wednesday|thursday)|tonight|tomorrow)\b.*\b(\d{1,2}(:\d\d)?\s?(am|pm)|\d{1,2}\/\d{1,2})\b/i;

function finding(
  club: AuditClub,
  claim: AuditClaim,
  check: string,
  area: AuditFinding["area"],
  severity: Severity,
  confidence: Confidence,
  detail: string,
  reject: boolean,
): AuditFinding {
  const text = typeof claim.value === "string" ? claim.value : JSON.stringify(claim.value);
  return {
    check,
    area,
    severity,
    confidence,
    clubId: club.id,
    slug: club.slug,
    subject: `${claim.fieldKey}: ${text.slice(0, 120)}`,
    detail,
    displayed: club.displayedClaimIds.has(claim.id),
    fix: reject ? { kind: "reject_claims", claimIds: [claim.id], reason: `audit ${check}: ${detail}` } : null,
  };
}

/** A club's own names, so a person's name inside one ("John Adams Society") never counts. */
function ownNames(club: AuditClub): string[] {
  return [club.name, ...club.aliases];
}

/** The other clubs' names (for "this text describes another organization"). */
function otherClubNamed(text: string, self: AuditClub, clubs: AuditClub[]): AuditClub | null {
  if (namesClub(text, self)) return null;
  const t = ` ${plain(text)} `;
  for (const c of clubs) {
    if (c.id === self.id) continue;
    const full = plain(c.name);
    // Only long, specific names: "The Harvard Crimson" inside text is not evidence of identity.
    if (
      full.split(" ").length >= 4 &&
      t.includes(` ${full} `) &&
      t.trim().startsWith(full.split(" ").slice(0, 2).join(" "))
    )
      return c;
  }
  return null;
}

function textChecks(
  out: AuditFinding[],
  club: AuditClub,
  claim: AuditClaim,
  text: string,
  area: "description" | "summary",
  clubs: AuditClub[],
) {
  const nav = navTextProblem(text);
  if (nav) {
    out.push(finding(club, claim, `${area}.nav_text`, area, "high", "high", nav.why, true));
    return;
  }
  for (const [re, what] of JUNK)
    if (re.test(text)) {
      out.push(finding(club, claim, `${area}.junk`, area, "high", "high", `${what}: "${text.match(re)?.[0]}"`, true));
      return;
    }
  const people = namesPeopleProblem(text, ownNames(club));
  if (people) {
    out.push(finding(club, claim, `${area}.names_people`, area, "high", "high", people.why, true));
    return;
  }
  const blurb = eventBlurbProblem(text);
  if (blurb) {
    out.push(finding(club, claim, `${area}.event_blurb`, area, "high", "high", blurb.why, true));
    return;
  }
  // Round 4: welcome letters to delegates, notices to visitors, one event's recap, and generic
  // text whose only "our" is a call to action (About and mission only: a one-liner like "a
  // mentorship program that …" rightly doesn't name the club). Extracted text only: a person
  // chose manual entries.
  if (extracted(claim)) {
    const about =
      aboutTextProblem(text) ??
      (claim.fieldKey === "club.long_description" || claim.fieldKey === "club.mission"
        ? notAboutClubProblem(text, [...ownNames(club), ...(club.acronym ? [club.acronym] : [])])
        : null);
    if (about) {
      out.push(finding(club, claim, `${area}.${about.check}`, area, "high", "high", about.why, true));
      return;
    }
  }
  if (BIO.test(text) && !namesClub(text, club)) {
    out.push(
      finding(club, claim, `${area}.personal_bio`, area, "high", "high", "describes a person, not the club", true),
    );
    return;
  }
  if (LISTING_META.test(text)) {
    out.push(
      finding(
        club,
        claim,
        `${area}.describes_listing`,
        area,
        "medium",
        "high",
        `describes where the club is listed: "${text.match(LISTING_META)?.[0]}"`,
        true,
      ),
    );
    return;
  }
  if (EVENT_AD.test(text))
    out.push(
      finding(club, claim, `${area}.event_ad`, area, "medium", "medium", "reads like an event announcement", false),
    );
  if (area === "summary" && WIKI_MARKER.test(text))
    out.push(
      finding(
        club,
        claim,
        `${area}.wiki_markers`,
        area,
        "low",
        "high",
        `Wikipedia marker "${text.match(WIKI_MARKER)?.[0]}" (stripped on display)`,
        false,
      ),
    );
  if (area === "summary" && /^[a-z]/.test(text.trim()))
    out.push(
      finding(
        club,
        claim,
        `${area}.fragment`,
        area,
        "low",
        "high",
        "starts mid-sentence (capitalized on display)",
        false,
      ),
    );
  const words = plain(text).split(" ").filter(Boolean);
  if (words.length < 4)
    out.push(finding(club, claim, `${area}.too_short`, area, "low", "medium", `only ${words.length} word(s)`, false));
  if (
    /\bnational (network|organization|nonprofit|non-profit)\b/i.test(text) &&
    !/\b(chapter|harvard|campus|undergraduate|student)\b/i.test(text)
  )
    out.push(
      finding(
        club,
        claim,
        `${area}.national_org_text`,
        area,
        "medium",
        "medium",
        "describes a national organization, not the Harvard group",
        false,
      ),
    );
  const other = otherClubNamed(text, club, clubs);
  if (other)
    out.push(
      finding(
        club,
        claim,
        `${area}.describes_other_club`,
        area,
        "high",
        "medium",
        `opens by describing "${other.name}"`,
        false,
      ),
    );
}

/** Proper nouns and numbers in `summary` that the anchored page never mentions. */
export function unsupportedSpecifics(summary: string, pageText: string, club: AuditClub): string[] {
  const page = ` ${plain(pageText)} `;
  const own = ` ${plain([club.name, club.acronym ?? "", ...club.aliases].join(" "))} `;
  const out: string[] = [];
  for (const m of summary.matchAll(/\b\d[\d,.]*\b/g)) {
    const n = m[0].replace(/[,.]$/, "");
    if (!page.includes(` ${plain(n)} `) && !page.includes(plain(n))) out.push(n);
  }
  // Capitalized words after the first word (sentence starts are capitalized anyway).
  const words = summary.split(/\s+/).slice(1);
  for (const w of words)
    for (const part of w.split(/[^A-Za-z'’]+/)) {
      if (!/^[A-Z][a-z]{2,}/.test(part)) continue;
      const p = plain(part);
      if (!p || own.includes(` ${p} `)) continue;
      if (!page.includes(` ${p} `) && !page.includes(` ${p.slice(0, Math.max(4, p.length - 2))}`)) out.push(part);
    }
  return [...new Set(out)];
}

export function checkContent(data: AuditData): AuditFinding[] {
  const out: AuditFinding[] = [];
  const clubs = [...data.clubs.values()];
  for (const claim of data.claims) {
    const club = data.clubs.get(claim.clubId);
    if (!club || typeof claim.value !== "string") continue;
    const text = claim.value;
    if (DESCRIPTION_FIELDS.has(claim.fieldKey)) {
      textChecks(out, club, claim, text, "description", clubs);
      // A sentence from a news story describes an event in the club's life, not the club.
      if (claim.evidence.length && claim.evidence.every((e) => NEWS_SOURCES.has(e.sourceType)))
        out.push(
          finding(
            club,
            claim,
            "description.article_excerpt",
            "description",
            "medium",
            "medium",
            "taken only from a news article",
            false,
          ),
        );
    }
    // Audition instructions shown as the Experience row (round 5, HRO). Extracted text only.
    if (claim.fieldKey === "club.experience_required") {
      const prep = extracted(claim) ? auditionPrepProblem(text) : null;
      if (prep)
        out.push(
          finding(club, claim, "description.experience_audition_prep", "description", "high", "high", prep.why, true),
        );
      continue;
    }
    // Activities are short phrases; the only rule that applies is naming a person (§4, §21).
    if (claim.fieldKey === "club.activity") {
      const people = namesPeopleProblem(text, ownNames(club));
      if (people)
        out.push(
          finding(club, claim, "description.activity_names_people", "description", "high", "high", people.why, true),
        );
      // Board elections are governance, not something members do (round 3).
      const governance = extracted(claim) ? governanceActivityProblem(text) : null;
      if (governance)
        out.push(
          finding(
            club,
            claim,
            "description.activity_governance",
            "description",
            "medium",
            "high",
            governance.why,
            true,
          ),
        );
      continue;
    }
    if (claim.fieldKey !== "club.summary") continue;
    textChecks(out, club, claim, text, "summary", clubs);

    // Summaries must stay anchored to the club's own text.
    const ev = claim.evidence[0];
    if (!ev?.quote) {
      out.push(
        finding(club, claim, "summary.no_anchor", "summary", "high", "high", "summary has no anchoring quote", true),
      );
      continue;
    }
    // Template summaries ("Harvard club sports team for archery.") are anchored to the name itself.
    if (
      /\(club sport\)\s*$/i.test(ev.quote) ||
      /^Harvard (men's |women's )?club sports team for /.test(text) ||
      plain(ev.quote) === plain(club.name)
    )
      continue;
    const page = ev.snapshotId ? data.snapshotText.get(ev.snapshotId) : undefined;
    if (page && !plain(page).includes(plain(ev.quote).slice(0, 80)))
      out.push(
        finding(
          club,
          claim,
          "summary.anchor_not_in_page",
          "summary",
          "high",
          "high",
          "anchoring quote is not in the page",
          true,
        ),
      );
    if (ev.ownerClubId && ev.ownerClubId !== club.id)
      out.push(
        finding(
          club,
          claim,
          "summary.anchored_to_other_club",
          "summary",
          "critical",
          "high",
          "anchored to a page owned by another club",
          true,
        ),
      );
    if (page) {
      const extra = unsupportedSpecifics(text, page, club);
      if (extra.length)
        out.push(
          finding(
            club,
            claim,
            "summary.unsupported_specifics",
            "summary",
            "high",
            "medium",
            `not on the anchored page: ${extra.join(", ")}`,
            false,
          ),
        );
    }
    const marketing = text.match(MARKETING)?.[0];
    if (marketing && !(page ?? ev.quote).toLowerCase().includes(marketing.toLowerCase()))
      out.push(
        finding(
          club,
          claim,
          "summary.marketing_language",
          "summary",
          "medium",
          "medium",
          `"${marketing}" is not in the source`,
          false,
        ),
      );
    const content = plain(text)
      .split(" ")
      .filter((w) => !plain(club.name).split(" ").includes(w) && w.length > 3);
    if (content.length < 3)
      out.push(
        finding(club, claim, "summary.name_echo", "summary", "low", "medium", "mostly repeats the club's name", false),
      );
  }
  return out;
}
