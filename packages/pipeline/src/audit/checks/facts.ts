import {
  negatedProcessProblem,
  duesProblem,
  hoursProblem,
  memberCountProblem,
  openMembershipProblem,
  type QuoteProblem,
} from "../../extract/evidence-rules";
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

export function checkFacts(data: AuditData): AuditFinding[] {
  const out: AuditFinding[] = [];
  for (const claim of data.claims) {
    const club = data.clubs.get(claim.clubId);
    if (!club) continue;
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
      judge(out, club, claim, "join", (q) => negatedProcessProblem(mode, q));
    } else if (claim.fieldKey === "club.join_mode" && claim.value === "open") {
      judge(out, club, claim, "join", openMembershipProblem);
      const quotes = quotesOf(claim);
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
