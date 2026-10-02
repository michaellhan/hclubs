import type { Joining } from "@hci/core";
/**
 * Data-quality audit (ADR 0033). Every check is a pure function over an in-memory picture of
 * the database (`AuditData`, loaded once by `load.ts`) that returns findings. A finding may
 * carry a fix; `run.ts` applies only fixes whose confidence is "high", and only by rejecting
 * claims (status → rejected with a reason, never deleted) or by a reversible merge.
 */

export type AuditArea =
  | "links"
  | "social"
  | "application"
  | "description"
  | "summary"
  | "category"
  | "duplicate"
  | "facts"
  | "recruiting"
  | "logo"
  | "press"
  | "consistency"
  | "joining";

/** How much harm the problem does if it is real and shown: wrong identity > wrong fact > cosmetic. */
export type Severity = "critical" | "high" | "medium" | "low";
/** How sure the check is that the problem is real. Only "high" findings are fixed automatically. */
export type Confidence = "high" | "medium" | "low";

export type AuditFix =
  | { kind: "reject_claims"; claimIds: string[]; reason: string }
  | { kind: "merge"; absorbedId: string; survivorId: string; reason: string }
  | { kind: "re_resolve" };

export interface AuditFinding {
  /** Stable check id, e.g. "link.dead". */
  check: string;
  area: AuditArea;
  severity: Severity;
  confidence: Confidence;
  clubId: string | null;
  slug: string | null;
  /** What the finding is about: a URL, a value, a pair of slugs. */
  subject: string;
  detail: string;
  /** Whether the flagged value is what the site currently shows. */
  displayed: boolean;
  fix: AuditFix | null;
}

// --- The loaded picture -----------------------------------------------------------------------------

export interface AuditEvidence {
  sourceId: string;
  sourceUrl: string;
  sourceType: string;
  tier: number;
  /** The club the source is established as belonging to, if any. */
  ownerClubId: string | null;
  method: string;
  extractor: string;
  quote: string | null;
  confidence: number;
  isDirect: boolean;
  observedAt: Date;
  snapshotId: string | null;
  snapshotSourceId: string | null;
  snapshotFetchedAt: Date | null;
}

export interface AuditClaim {
  id: string;
  clubId: string;
  fieldKey: string;
  value: unknown;
  status: string;
  assertionKind: string;
  /** Recruiting-cycle term for cycle claims. */
  termKey: string | null;
  firstObservedAt: Date;
  lastObservedAt: Date;
  createdAt: Date;
  evidence: AuditEvidence[];
}

export interface AuditClub {
  id: string;
  slug: string;
  name: string;
  acronym: string | null;
  /** Aliases from the projection plus other active names (club.name claims) it is listed under. */
  aliases: string[];
  /** Projection aliases only (resolver-accepted): the ones a merge decision may rest on. */
  projectedAliases: string[];
  /** A Harvard College (undergraduate) org by affiliation, SOCO listing, or name. */
  college: boolean;
  affiliation: string;
  /** Top-level category slugs (parents of subcategories included). */
  topCategories: string[];
  categories: string[];
  /** Claim ids the resolver currently displays for this club (from the projection). */
  displayedClaimIds: Set<string>;
  shortDescription: string | null;
  /** Derived joining facts from the projection (ADR 0041); null before re-resolution. */
  joining: Joining | null;
  activityStatus: string;
}

export interface AuditLink {
  clubId: string;
  kind: string;
  url: string;
  normalizedUrl: string;
  handle: string | null;
  label: string | null;
  status: string;
  discoveredVia: string[];
  /** Active club.link claims for this URL on this club (what a rejection targets). */
  claimIds: string[];
  /** Title of the fetched page, if this URL was ever fetched. */
  pageTitle: string | null;
  /** Latest fetch of this exact URL, if it was ever fetched. */
  lastFetch: {
    status: string;
    httpStatus: number | null;
    at: Date;
    error?: string | null;
    /** Failed attempts since the last success (or ever), and when that run of failures began. */
    failures?: number;
    failingSince?: Date | null;
  } | null;
  /** Latest snapshot of this URL: where it ended up and whether the page looks parked. */
  lastSnapshot: { finalUrl: string; parked: boolean; at: Date } | null;
  /** The latest snapshot of a form says it no longer accepts responses. */
  formClosed: boolean;
}

export interface AuditCycle {
  id: string;
  clubId: string;
  termKey: string;
  opens: { at: string; precision: "date" | "datetime"; sourceText?: string } | null;
  deadline: { at: string; precision: "date" | "datetime"; sourceText?: string } | null;
  statedStatus: "open" | "closed" | null;
}

export interface AuditData {
  now: Date;
  clubs: Map<string, AuditClub>;
  /** Active claims (all fields), plus rejected club.link claims under `rejectedLinkClaims`. */
  claims: AuditClaim[];
  rejectedLinkClaims: AuditClaim[];
  /** "clubId|termKey" → snapshots whose dates for that cycle were rejected (ADR 0039). */
  rejectedDatePages: Map<string, Set<string>>;
  links: AuditLink[];
  cycles: AuditCycle[];
  /** Merge-candidate pairs already decided by a person ("aId|bId", ordered). */
  decidedPairs: Set<string>;
  /** Extracted text of snapshots that summaries and active recruiting dates come from. */
  snapshotText: Map<string, string>;
  /** Category slug → top-level slug. */
  categoryTop: Map<string, string>;
  /** Full text of news articles whose stored quote was cut at 240 characters (by snapshot id). */
  articleText: Map<string, string>;
  /** Findings a person reviewed and kept: `${check}|${clubId}|${subject}` (subject "*" = any). */
  dismissed: Set<string>;
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const CONFIDENCE_RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

export function rankFindings(findings: AuditFinding[]): AuditFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
      Number(b.displayed) - Number(a.displayed) ||
      a.check.localeCompare(b.check) ||
      (a.slug ?? "").localeCompare(b.slug ?? "") ||
      a.subject.localeCompare(b.subject),
  );
}
