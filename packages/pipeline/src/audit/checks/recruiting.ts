import { computeCycleStatus, compareTermKeys, termForDate, termKey, type DateValue } from "@hci/core";
import { findRecruitingIssues, type CycleClaimRow } from "../../recruiting/audit";
import { weekdayProblem } from "../../extract/evidence-rules";
import { hostOf } from "../text";
import type { AuditClaim, AuditData, AuditFinding, Confidence, Severity } from "../types";

/**
 * Recruiting checks: the existing recruiting audit (ADR 0031) plus the ones it lacked —
 * a stated weekday that contradicts the stored date (the year was inferred for an old page),
 * and dates that belong to events rather than applications. PURE.
 */

/** Dates of events that are not an application window. */
const EVENT_DATE: [RegExp, Confidence][] = [
  [
    /\b(open rehearsals?|rehearsal|party|darty|mixer|social|open house|info(rmation)? session|study break|concert|performance|show(case)?|gala|banquet)\b/i,
    "high",
  ],
  [/\b(shift assignments?|shifts?|volunteer schedule)\b/i, "high"],
  [/\b(delegates?|delegation|registration|register|tickets?|conference|tournament|hackathon)\b/i, "medium"],
];

function finding(
  data: AuditData,
  claim: AuditClaim,
  check: string,
  severity: Severity,
  confidence: Confidence,
  detail: string,
  reject: boolean,
): AuditFinding {
  const club = data.clubs.get(claim.clubId);
  return {
    check,
    area: "recruiting",
    severity,
    confidence,
    clubId: claim.clubId,
    slug: club?.slug ?? null,
    subject: `${claim.termKey ?? ""} ${claim.fieldKey}: ${JSON.stringify(claim.value).slice(0, 140)}`,
    detail,
    displayed: club?.displayedClaimIds.has(claim.id) ?? false,
    fix: reject ? { kind: "reject_claims", claimIds: [claim.id], reason: `audit ${check}: ${detail}` } : null,
  };
}

export function checkRecruiting(data: AuditData): AuditFinding[] {
  const out: AuditFinding[] = [];
  const cycleClaims = data.claims.filter((c) => c.fieldKey.startsWith("cycle.") && c.termKey);

  // The recruiting audit's own checks (each issue it reports is a rejection).
  const rows: CycleClaimRow[] = cycleClaims.map((c) => ({
    id: c.id,
    clubId: c.clubId,
    slug: data.clubs.get(c.clubId)?.slug ?? "",
    fieldKey: c.fieldKey,
    value: c.value,
    termKey: c.termKey as string,
    evidence: c.evidence.length,
    sourceTypes: [...new Set(c.evidence.map((e) => e.sourceType))],
  }));
  const siteHosts = new Map<string, string[]>();
  for (const l of data.links)
    if (l.kind === "website") siteHosts.set(l.clubId, [...(siteHosts.get(l.clubId) ?? []), hostOf(l.url)]);
  const byId = new Map(cycleClaims.map((c) => [c.id, c]));
  for (const issue of findRecruitingIssues(rows, siteHosts, data.now))
    for (const id of issue.rejectedClaimIds) {
      const claim = byId.get(id);
      if (claim) out.push(finding(data, claim, `recruiting.${issue.kind}`, "high", "high", issue.detail, true));
    }

  for (const c of cycleClaims) {
    if (c.fieldKey !== "cycle.deadline" && c.fieldKey !== "cycle.opens_at") continue;
    const v = c.value as { at?: string; sourceText?: string };
    if (!v.at) continue;
    const text = [v.sourceText ?? "", ...c.evidence.map((e) => e.quote ?? "")].join(" ");
    const wrongDay = weekdayProblem(v.sourceText ?? "", v.at);
    if (wrongDay) {
      out.push(finding(data, c, "recruiting.weekday_mismatch", "high", "high", wrongDay.why, true));
      continue;
    }
    for (const [re, confidence] of EVENT_DATE) {
      const m = (v.sourceText ?? "").match(re) ?? (c.fieldKey === "cycle.opens_at" ? text.match(re) : null);
      if (!m) continue;
      out.push(
        finding(
          data,
          c,
          "recruiting.event_date_not_application",
          confidence === "high" ? "high" : "medium",
          confidence,
          `the date is for an event ("${m[0]}"), not an application window`,
          confidence === "high",
        ),
      );
      break;
    }
  }

  // Past-term cycles must never read as current (computeCycleStatus guarantees it; verify).
  const current = termKey(termForDate(data.now));
  for (const cy of data.cycles) {
    const status = computeCycleStatus(
      {
        opensAt: cy.opens as DateValue | null,
        deadline: cy.deadline as DateValue | null,
        statedStatus: cy.statedStatus,
        termKey: cy.termKey,
      },
      data.now,
    );
    if ((status === "open" || status === "upcoming") && compareTermKeys(cy.termKey, current) < 0) {
      const club = data.clubs.get(cy.clubId);
      out.push({
        check: "recruiting.past_term_shown_current",
        area: "recruiting",
        severity: "critical",
        confidence: "high",
        clubId: cy.clubId,
        slug: club?.slug ?? null,
        subject: cy.termKey,
        detail: `${cy.termKey} cycle computes as "${status}" in ${current}`,
        displayed: true,
        fix: null,
      });
    }
  }
  return out;
}
