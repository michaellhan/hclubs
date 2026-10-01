import {
  computeCycleStatus,
  compareTermKeys,
  normalizeUrl,
  parseDateExpression,
  termForDate,
  termKey,
  type DateValue,
} from "@hci/core";
import { findRecruitingIssues, type CycleClaimRow } from "../../recruiting/audit";
import {
  eventDateProblem,
  laterStepDeadlineInQuote,
  laterStepDeadlineProblem,
  outsiderApplicationProblem,
  outsiderLinkProblem,
  weekdayProblem,
} from "../../extract/evidence-rules";
import { pageYears } from "../../recruiting/signals";
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
    // An event or conference registration date in the quote (shared rule with the extractors).
    const quotes = c.evidence.map((e) => e.quote ?? "").filter(Boolean);
    const shared =
      eventDateProblem(v.sourceText ?? "") ??
      (quotes.length && quotes.every((q) => eventDateProblem(q)) ? eventDateProblem(quotes[0] ?? "") : null);
    if (shared) {
      out.push(finding(data, c, "recruiting.event_date_not_application", "high", "high", shared.why, true));
      continue;
    }
    // "Due at 2:00 pm on Sunday": only a weekday, resolved against the crawl date by an old
    // extractor version (current ones refuse it). Not a date the page states.
    const ref = c.evidence[0]?.snapshotFetchedAt ?? c.firstObservedAt;
    if (v.sourceText && parseDateExpression(v.sourceText, ref)?.notes.some((n) => n.startsWith("relative weekday"))) {
      out.push(
        finding(
          data,
          c,
          "recruiting.weekday_only_date",
          "high",
          "high",
          `"${v.sourceText.slice(0, 60)}" names only a weekday; the date was guessed from when we crawled`,
          true,
        ),
      );
      continue;
    }
    // A date whose year the page never states, on a page whose latest year is past (a 2016
    // news post read in 2026): the year was guessed. Every observation must agree.
    const dateYear = Number(v.at.slice(0, 4));
    const stale = c.evidence.map((e) => {
      const text = e.snapshotId ? data.snapshotText.get(e.snapshotId) : undefined;
      if (!text) return null;
      const fetched = e.snapshotFetchedAt ?? data.now;
      const years = pageYears({ url: e.sourceUrl, title: null, text }, fetched);
      const latest = years[years.length - 1];
      return latest !== undefined && latest < fetched.getUTCFullYear() && latest < dateYear ? latest : null;
    });
    if (stale.length && stale.every((y) => y !== null)) {
      out.push(
        finding(
          data,
          c,
          "recruiting.year_guessed_on_old_page",
          "high",
          "high",
          `the page's latest year is ${Math.max(...(stale as number[]))}; ${dateYear} was guessed for a date written without a year`,
          true,
        ),
      );
      continue;
    }
    // A scholarship, contest entry or delegate application: every observation must agree.
    const outsider = c.evidence.length
      ? c.evidence.map((e) =>
          outsiderApplicationProblem(e.quote ?? "", (e.snapshotId && data.snapshotText.get(e.snapshotId)) || ""),
        )
      : [];
    if (outsider.length && outsider.every(Boolean)) {
      out.push(finding(data, c, "recruiting.outsider_application", "high", "high", outsider[0]!.why, true));
      continue;
    }
    // A second round's or a priority deadline (1.13.0): every observation must agree.
    const later =
      c.fieldKey === "cycle.deadline" && c.evidence.length
        ? c.evidence.map((e) => laterStepDeadlineInQuote(e.quote ?? "", v.sourceText ?? ""))
        : [];
    if (later.length && later.every(Boolean)) {
      out.push(finding(data, c, "recruiting.later_step_deadline", "high", "high", later[0]!.why, true));
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

  // "Apply" links that are forms for outsiders (a conference's scholarship, delegate or
  // contest form): judged by the link's label and path and the page it was found on.
  for (const c of data.claims) {
    if (c.status !== "active") continue;
    const v = c.value as { kind?: string; url?: string; label?: string } | string;
    const isAppLink =
      c.fieldKey === "cycle.application_url" ||
      (c.fieldKey === "club.link" &&
        typeof v === "object" &&
        (v.kind === "application_form" || v.kind === "application_page"));
    if (!isAppLink || !c.evidence.length) continue;
    const url = typeof v === "string" ? v : (v.url ?? "");
    const label = typeof v === "string" ? null : (v.label ?? null);
    const problems = c.evidence.map((e) => outsiderLinkProblem(label, url, e.quote, e.sourceUrl));
    if (problems.every(Boolean))
      out.push(finding(data, c, "recruiting.outsider_link", "high", "high", problems[0]!.why, true));
  }

  // An "apply" link whose own page is a later round's form ("… Second Round Application"):
  // only applicants who passed round one use it (1.13.0).
  const laterTitle = new Map<string, string>();
  for (const l of data.links)
    if ((l.kind === "application_form" || l.kind === "application_page") && l.pageTitle) {
      const p = laterStepDeadlineProblem(l.pageTitle);
      if (p) laterTitle.set(l.normalizedUrl, l.pageTitle);
    }
  if (laterTitle.size)
    for (const c of data.claims) {
      if (c.status !== "active") continue;
      const v = c.value as { kind?: string; url?: string } | string;
      const isAppLink =
        c.fieldKey === "cycle.application_url" ||
        (c.fieldKey === "club.link" &&
          typeof v === "object" &&
          (v.kind === "application_form" || v.kind === "application_page"));
      if (!isAppLink) continue;
      const url = normalizeUrl(typeof v === "string" ? v : (v.url ?? "")) ?? "";
      const title = laterTitle.get(url);
      if (title)
        out.push(
          finding(
            data,
            c,
            "recruiting.later_step_link",
            "high",
            "high",
            `the linked page is "${title.slice(0, 80)}": a later round's form, not where to apply`,
            true,
          ),
        );
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
