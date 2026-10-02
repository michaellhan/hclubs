import { isRecruitingNow, computeCycleStatus } from "@hci/core";
import type { AuditData, AuditFinding } from "../types";

/**
 * Joining inconsistencies the derived facts expose (ADR 0041). PURE, report-only: each one
 * is a disagreement between sources, and the fix is a person reading both (then
 * `reject-value` or `audit-dismiss`), never picking whichever value suits a filter.
 *  - general membership both open and selective ("mixed");
 *  - first-years said to be both eligible and not, equally specifically;
 *  - "no dues" beside a stated dues amount;
 *  - the College directory's no-comp flag beside a stated comp;
 *  - an inactive or ended club that shows recruiting now.
 */
export function checkJoining(data: AuditData): AuditFinding[] {
  const out: AuditFinding[] = [];
  const add = (clubId: string, check: string, severity: AuditFinding["severity"], detail: string) => {
    const club = data.clubs.get(clubId);
    out.push({
      check,
      area: "joining",
      severity,
      confidence: "medium",
      clubId,
      slug: club?.slug ?? null,
      subject: check,
      detail,
      displayed: true,
      fix: null,
    });
  };
  for (const club of data.clubs.values()) {
    const j = club.joining;
    if (!j) continue;
    if (j.conflicts.includes("access"))
      add(club.id, "joining.mixed_access", "medium", `sources say both open membership and ${j.general.filter((m) => m !== "open" && m !== "attendance_based").join("/")}`);
    if (j.conflicts.includes("firstYears"))
      add(club.id, "joining.first_years_conflict", "medium", "one source says first-years can join, another that they can't");
    if (j.conflicts.includes("dues")) add(club.id, "joining.dues_conflict", "low", "sources disagree about dues");
    if (j.conflicts.includes("comp"))
      add(club.id, "joining.comp_conflict", "medium", "the College directory lists no comp, but a source describes one");
  }
  for (const cy of data.cycles) {
    const club = data.clubs.get(cy.clubId);
    if (!club || !["inactive", "defunct"].includes(club.activityStatus)) continue;
    const status = computeCycleStatus(
      { opensAt: cy.opens, deadline: cy.deadline, statedStatus: cy.statedStatus, termKey: cy.termKey },
      data.now,
    );
    if (isRecruitingNow(status))
      add(club.id, "joining.inactive_recruiting", "high", `marked ${club.activityStatus} but ${cy.termKey} recruiting shows as open`);
  }
  return out;
}
