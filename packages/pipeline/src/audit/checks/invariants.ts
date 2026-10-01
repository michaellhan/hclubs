import { dateValueEnd, dateValueStart } from "@hci/core";
import type { AuditClaim, AuditData, AuditFinding, Confidence, Severity } from "../types";

/**
 * Structural invariants: values that cannot all be true at once, whatever the source says —
 * a cycle that opens after its deadline, more admits than applicants, a link that isn't a
 * web address, an implausible number. Most are flagged for review rather than fixed: the
 * check knows the pair is impossible, not which half is wrong. PURE.
 */

/** Query parameters that only track clicks; URL normalization should have removed them. */
const TRACKING = /[?&](utm_[a-z]+|fbclid|gclid|igshid|igsh|mc_cid|mc_eid|si)=/i;
/** Above these a number is far more likely a misread (a year, a follower count) than a fact. */
const MAX_MEMBERS = 3000;
const MAX_HOURS = 40;

function finding(
  data: AuditData,
  clubId: string,
  check: string,
  severity: Severity,
  confidence: Confidence,
  subject: string,
  detail: string,
  rejectIds: string[] = [],
): AuditFinding {
  return {
    check,
    area: check.startsWith("link.") ? "links" : check.startsWith("recruiting.") ? "recruiting" : "facts",
    severity,
    confidence,
    clubId,
    slug: data.clubs.get(clubId)?.slug ?? null,
    subject,
    detail,
    displayed: rejectIds.some((id) => data.clubs.get(clubId)?.displayedClaimIds.has(id)) || rejectIds.length === 0,
    fix:
      rejectIds.length && confidence === "high"
        ? { kind: "reject_claims", claimIds: rejectIds, reason: `audit ${check}: ${detail}` }
        : null,
  };
}

const num = (v: unknown, key: string): number | null => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && key in v) {
    const x = (v as Record<string, unknown>)[key];
    return typeof x === "number" ? x : null;
  }
  return null;
};

export function checkInvariants(data: AuditData): AuditFinding[] {
  const out: AuditFinding[] = [];

  // A cycle cannot open after it closes. Usually the "opening" is an event date (a
  // conference, a show) read as an application opening.
  for (const cy of data.cycles) {
    if (!cy.opens || !cy.deadline) continue;
    if (dateValueStart(cy.opens).getTime() > dateValueEnd(cy.deadline).getTime())
      out.push(
        finding(
          data,
          cy.clubId,
          "recruiting.opens_after_deadline",
          "medium",
          "high",
          `${cy.termKey}: opens ${cy.opens.at}, deadline ${cy.deadline.at}`,
          "the cycle's opening date is after its deadline; one of the two is probably an event date",
        ),
      );
  }

  // Applicant and admit counts of one cycle.
  const counts = new Map<string, { applicants?: AuditClaim; admits?: AuditClaim }>();
  for (const c of data.claims) {
    if (c.fieldKey !== "cycle.applicants" && c.fieldKey !== "cycle.admits") continue;
    const key = `${c.clubId}|${c.termKey ?? ""}`;
    const entry = counts.get(key) ?? {};
    entry[c.fieldKey === "cycle.applicants" ? "applicants" : "admits"] = c;
    counts.set(key, entry);
  }
  for (const [key, { applicants, admits }] of counts) {
    if (!applicants || !admits) continue;
    const a = num(applicants.value, "count");
    const b = num(admits.value, "count");
    if (a !== null && b !== null && b > a)
      out.push(
        finding(
          data,
          applicants.clubId,
          "facts.admits_exceed_applicants",
          "high",
          "medium",
          `${key.split("|")[1]}: ${a} applicants, ${b} admits`,
          "more admits than applicants; the numbers may describe different groups (e.g. total members)",
        ),
      );
  }

  for (const c of data.claims) {
    if (c.fieldKey === "club.member_count") {
      const n = num(c.value, "count") ?? num(c.value, "max") ?? num(c.value, "min");
      if (n !== null && n > MAX_MEMBERS)
        out.push(
          finding(
            data,
            c.clubId,
            "facts.implausible_member_count",
            "medium",
            "medium",
            `${n} members`,
            `more than ${MAX_MEMBERS} members is implausible for a student club; check the source`,
          ),
        );
    }
    if (c.fieldKey === "club.hours_per_week") {
      const n = num(c.value, "max") ?? num(c.value, "min");
      if (n !== null && n > MAX_HOURS)
        out.push(
          finding(
            data,
            c.clubId,
            "facts.implausible_hours",
            "medium",
            "medium",
            `${n} h/week`,
            `more than ${MAX_HOURS} hours a week is implausible; check the source`,
          ),
        );
    }
    if (typeof c.value === "string" && c.value.trim() === "")
      out.push(
        finding(
          data,
          c.clubId,
          "facts.empty_value",
          "medium",
          "high",
          c.fieldKey,
          "an empty text value is not a fact",
          [c.id],
        ),
      );
  }

  for (const l of data.links) {
    let protocol: string | null = null;
    try {
      protocol = new URL(l.url).protocol;
    } catch {
      protocol = null;
    }
    const ok = protocol === "https:" || protocol === "http:" || (l.kind === "email" && protocol === "mailto:");
    if (!ok)
      out.push(
        finding(
          data,
          l.clubId,
          "link.bad_protocol",
          "high",
          "high",
          l.url,
          `not a web address (${protocol ?? "unparseable"})`,
          l.claimIds,
        ),
      );
    else if (TRACKING.test(l.url))
      out.push(
        finding(
          data,
          l.clubId,
          "link.tracking_params",
          "low",
          "medium",
          l.url,
          "carries click-tracking parameters that URL normalization should strip",
        ),
      );
  }
  return out;
}
