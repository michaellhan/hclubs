import {
  eligibleClassesProblem,
  freshmenEligibleProblem,
  joinModeProblem,
  duesProblem,
  hoursProblem,
  memberCountProblem,
  openMembershipProblem,
  explicitlyOpen,
  isArticleUrl,
  isLegalPageUrl,
  otherOrganizationProblem,
  selfDescribedSelectivityProblem,
  type QuoteProblem,
} from "../../extract/evidence-rules";
import { joinQuoteScope } from "@hci/core";
import type { AuditClaim, AuditClub, AuditData, AuditFinding, Confidence, Severity } from "../types";

/**
 * Checks for the facts most prone to hallucination and staleness: member counts, hours per
 * week, dues, and join modes. PURE. A claim fails when none of its evidence quotes supports
 * the value under the shared rules in `extract/evidence-rules.ts` (the same rules the
 * extractors now apply before writing a claim).
 */

function finding(
  club: AuditClub,
  claim: AuditClaim,
  check: string,
  severity: Severity,
  confidence: Confidence,
  detail: string,
  reject: boolean,
): AuditFinding {
  return {
    check,
    area: check.startsWith("join.") ? "recruiting" : "facts",
    severity,
    confidence,
    clubId: club.id,
    slug: club.slug,
    subject: `${claim.fieldKey}: ${JSON.stringify(claim.value)}`,
    detail,
    displayed: club.displayedClaimIds.has(claim.id),
    fix: reject ? { kind: "reject_claims", claimIds: [claim.id], reason: `audit ${check}: ${detail}` } : null,
  };
}

const quotesOf = (c: AuditClaim) => c.evidence.map((e) => e.quote ?? "").filter(Boolean);
/** Manual entries and submissions were checked by a person; only extracted text is judged. */
const extracted = (c: AuditClaim) => c.evidence.some((e) => e.method !== "manual" && e.method !== "user_submission");

/** The first quote's problem when every quote has one; null when any quote supports the value. */
function failing(quotes: string[], rule: (q: string) => QuoteProblem | null): QuoteProblem | null {
  let first: QuoteProblem | null = null;
  for (const q of quotes) {
    const p = rule(q);
    if (!p) return null;
    first ??= p;
  }
  return first;
}

const PAST = /\b(in the past|previously|used to|once had|at its peak|last year)\b/i;

function judge(
  out: AuditFinding[],
  club: AuditClub,
  claim: AuditClaim,
  prefix: string,
  rule: (q: string) => QuoteProblem | null,
) {
  const quotes = quotesOf(claim);
  if (!quotes.length || !extracted(claim)) return;
  const p = failing(quotes, rule);
  if (p) {
    out.push(finding(club, claim, `${prefix}.${p.check}`, "high", "high", p.why, true));
    return;
  }
  if (prefix === "facts" && quotes.some((q) => PAST.test(q)))
    out.push(finding(club, claim, "facts.stale_wording", "medium", "medium", "the quote describes the past", false));
}

const PROCESS_PAGE = /(audition|tryout|apply|application|comp)/i;
const OPEN_EVEN_ON_PROCESS_PAGE =
  /\b(can|may) (join|be a member|become a member)\b|\bno cut(s|offs?)\b|\bnon-?audition\b/i;
/** A selective mode its quote doesn't support: negated ("no auditions") or a board application. */
const processProblem = (mode: string, q: string) => joinModeProblem(mode, q);

const SELECTIVE = new Set(["audition", "comp", "application", "tryout", "invite_only"]);

/** Clubs with a stated (not negated) selective join mode, and which modes. */
function selectiveModes(data: AuditData): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const c of data.claims) {
    if (c.fieldKey !== "club.join_mode" || typeof c.value !== "string" || !SELECTIVE.has(c.value)) continue;
    const mode = c.value;
    const quotes = quotesOf(c);
    if (quotes.length && failing(quotes, (q) => processProblem(mode, q))) continue;
    // A board's, a competition team's or a conductor's process doesn't make general
    // membership selective (ADR 0041), so it can't knock out an "open" claim.
    if (quotes.length && quotes.every((q) => joinQuoteScope(q).scope === "role")) continue;
    const set = out.get(c.clubId) ?? new Set<string>();
    set.add(mode);
    out.set(c.clubId, set);
  }
  return out;
}

export function checkFacts(data: AuditData): AuditFinding[] {
  const out: AuditFinding[] = [];
  const selective = selectiveModes(data);
  for (const claim of data.claims) {
    const club = data.clubs.get(claim.clubId);
    if (!club) continue;
    // Evidence only from a privacy/permissions page, or a link only from a post: not the
    // club's own word (extractor 1.16.14 no longer reads them; this clears older claims).
    const machine =
      claim.evidence.length > 0 && claim.evidence.every((e) => e.method !== "manual" && e.method !== "user_submission");
    if (machine && claim.evidence.every((e) => isLegalPageUrl(e.sourceUrl))) {
      out.push(
        finding(
          club,
          claim,
          "evidence.policy_page",
          "medium",
          "high",
          "only from a site's privacy, terms or permissions page",
          true,
        ),
      );
      continue;
    }
    if (machine && claim.fieldKey === "club.link" && claim.evidence.every((e) => isArticleUrl(e.sourceUrl))) {
      out.push(
        finding(
          club,
          claim,
          "evidence.post_page_link",
          "low",
          "high",
          "a link found only on a news post or article",
          true,
        ),
      );
      continue;
    }
    if (claim.fieldKey === "club.member_count") {
      const v = claim.value as { count?: number; min?: number | null; max?: number | null };
      const nums = [v.count, v.min, v.max].filter((n): n is number => typeof n === "number");
      judge(out, club, claim, "facts", (q) => memberCountProblem(q, nums));
      if (Math.max(...nums, 0) > 2500 && club.college)
        out.push(
          finding(
            club,
            claim,
            "facts.member_count_implausible",
            "medium",
            "medium",
            `${Math.max(...nums)} members is implausible for a College group`,
            false,
          ),
        );
    } else if (claim.fieldKey === "club.hours_per_week") {
      const v = claim.value as { min?: number | null; max?: number | null };
      const nums = [v.min, v.max].filter((n): n is number => typeof n === "number");
      judge(out, club, claim, "facts", (q) => hoursProblem(q, nums));
    } else if (
      claim.fieldKey === "club.self_described_selectivity" ||
      claim.fieldKey === "cycle.self_described_selectivity"
    ) {
      judge(out, club, claim, "facts", selfDescribedSelectivityProblem);
    } else if (
      ["club.mission", "club.long_description", "club.short_description"].includes(claim.fieldKey) &&
      typeof claim.value === "string"
    ) {
      // Not `judge`: its past-tense check is for numbers; "was founded in…" is normal here.
      const p = extracted(claim) ? otherOrganizationProblem(claim.value, club) : null;
      if (p) out.push(finding(club, claim, `facts.${p.check}`, "high", "high", p.why, true));
      // Only blog posts or articles say it: their title or lede, not the club's description.
      else if (extracted(claim) && claim.evidence.length && claim.evidence.every((e) => isArticleUrl(e.sourceUrl)))
        out.push(
          finding(
            club,
            claim,
            "facts.description_from_article",
            "high",
            "high",
            "taken from a blog post or article",
            true,
          ),
        );
    } else if (claim.fieldKey === "club.eligible_classes" && Array.isArray(claim.value)) {
      // "Freshman Welcome Event", "includes both undergraduates and graduates" (ADR 0041).
      const classes = claim.value as string[];
      judge(out, club, claim, "eligibility", (q) => eligibleClassesProblem(classes, q));
    } else if (claim.fieldKey === "club.freshmen_eligible" && typeof claim.value === "boolean") {
      const value = claim.value;
      judge(out, club, claim, "eligibility", (q) => freshmenEligibleProblem(value, q));
    } else if (claim.fieldKey === "club.dues") {
      const v = claim.value as { amountUsd?: number | null };
      judge(out, club, claim, "facts", (q) => duesProblem(q, v.amountUsd));
    } else if (
      (claim.fieldKey === "club.join_mode" || claim.fieldKey === "cycle.process_type") &&
      typeof claim.value === "string" &&
      claim.value !== "open"
    ) {
      // "No auditions" read as "audition" (from older extractor versions and the LLM).
      const mode = claim.value;
      judge(out, club, claim, "join", (q) => processProblem(mode, q));
    } else if (claim.fieldKey === "club.join_mode" && claim.value === "open") {
      judge(out, club, claim, "join", openMembershipProblem);
      const quotes = quotesOf(claim);
      // "Open to all Harvard College undergraduates" beside a comp or audition says who may
      // apply, not that there is no selection. Only an explicit "no comp / anyone can join"
      // keeps "open" next to a selective process.
      // On the club's audition or comp page, "just show up!" and "no application required"
      // describe that process; only "anyone … can join" or "no cuts" still means open.
      const modes = selective.get(club.id);
      const explicit = claim.evidence.some(
        (e) =>
          e.quote &&
          explicitlyOpen(e.quote) &&
          (!PROCESS_PAGE.test(new URL(e.sourceUrl, "https://x.invalid").pathname) ||
            OPEN_EVEN_ON_PROCESS_PAGE.test(e.quote)),
      );
      if (modes && quotes.length && extracted(claim) && !explicit && !failing(quotes, openMembershipProblem))
        out.push(
          finding(
            club,
            claim,
            "join.open_beside_process",
            "high",
            "high",
            `the club also states a ${[...modes].join("/")}, and no quote says joining needs no selection: "${quotes[0]!.slice(0, 90)}"`,
            true,
          ),
        );
      if (
        quotes.length &&
        quotes.every(
          (q) =>
            /\b(mailing list|email list|newsletter|listserv)\b/i.test(q) &&
            !/\b(member|no comp|no application|open to)\b/i.test(q),
        )
      )
        out.push(
          finding(
            club,
            claim,
            "join.open_from_mailing_list",
            "medium",
            "medium",
            "only says how to join a mailing list",
            false,
          ),
        );
    }
  }
  return out;
}
