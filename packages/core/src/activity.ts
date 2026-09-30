import type { ActivityStatus } from "./enums";

/**
 * Conservative activity heuristic. CLAUDE.md §17.
 *
 * DERIVED, never a fact: output carries confidence and the signals used. An old website
 * alone never makes a club inactive; "inactive" requires a stated source.
 */
export const ACTIVITY_RULES_VERSION = "activity-v1";

export interface ActivitySignals {
  /** Stated status from a source (wins if present and fresh). */
  stated: { status: ActivityStatus; observedAt: Date; tier: number } | null;
  /** Latest observation on a current official listing (tier ≤ 2 directory). */
  officialListingObservedAt: Date | null;
  /** Latest recruiting-cycle date (opens/deadline) we know of. */
  latestRecruitingDate: Date | null;
  /** Most recent year explicitly mentioned on the club's own website pages (e.g. "Fall 2026"). */
  latestYearOnWebsite: number | null;
  /** When we last successfully fetched the club's own website. */
  websiteFetchedAt: Date | null;
}

export interface ActivityAssessment {
  status: ActivityStatus;
  confidence: number;
  reasons: string[];
  rulesVersion: string;
}

const DAY = 86_400_000;

export function assessActivity(s: ActivitySignals, now: Date): ActivityAssessment {
  const reasons: string[] = [];
  const age = (d: Date | null) => (d ? (now.getTime() - d.getTime()) / DAY : Infinity);

  if (s.stated && age(s.stated.observedAt) < 400) {
    reasons.push(`source states "${s.stated.status}" (tier ${s.stated.tier})`);
    return {
      status: s.stated.status,
      confidence: s.stated.tier <= 2 ? 0.9 : 0.7,
      reasons,
      rulesVersion: ACTIVITY_RULES_VERSION,
    };
  }

  let score = 0;
  if (age(s.latestRecruitingDate) < 240) {
    score += 2;
    reasons.push("recruiting within the last ~8 months or upcoming");
  }
  if (age(s.officialListingObservedAt) < 120) {
    score += 1;
    reasons.push("listed on a current official directory");
  }
  const year = new Date(now).getUTCFullYear();
  if (s.latestYearOnWebsite !== null && s.latestYearOnWebsite >= year - 1 && age(s.websiteFetchedAt) < 60) {
    score += 1;
    reasons.push(`own website mentions ${s.latestYearOnWebsite}`);
  }

  if (score >= 2)
    return {
      status: "active",
      confidence: Math.min(0.85, 0.6 + score * 0.1),
      reasons,
      rulesVersion: ACTIVITY_RULES_VERSION,
    };
  if (score === 1) return { status: "likely_active", confidence: 0.55, reasons, rulesVersion: ACTIVITY_RULES_VERSION };

  if (s.latestYearOnWebsite !== null && s.latestYearOnWebsite <= year - 3 && s.officialListingObservedAt === null) {
    reasons.push(`own website's latest year mentioned is ${s.latestYearOnWebsite}; no current official listing`);
    return { status: "possibly_dormant", confidence: 0.35, reasons, rulesVersion: ACTIVITY_RULES_VERSION };
  }
  reasons.push("no recent activity signals");
  return { status: "unknown", confidence: 0, reasons, rulesVersion: ACTIVITY_RULES_VERSION };
}
