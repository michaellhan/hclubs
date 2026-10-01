import { computeConfidence, normalizeUrl, type ExtractionMethod, type SourceType } from "@hci/core";
import { hostOf } from "../text";
import type { AuditClaim, AuditData, AuditFinding } from "../types";

/**
 * Source-consistency checks. PURE. Claims must rest on evidence that exists, came from a
 * snapshot taken before it was observed, carries the confidence its method implies, and
 * doesn't come only from a website that was rejected for the club. The projection must not
 * show claims that are no longer active.
 */

const DAY = 86_400_000;
const NO_SNAPSHOT_METHODS = new Set(["manual", "fixture", "user_submission"]);
/** Source types that stand for a club's own site; Harvard directories and news are independent of it. */
const OWN_SITE_TYPES = new Set(["club_website", "club_recruiting_material", "club_publication", "public_web"]);
/** Fields that are about the source, not the club's own pages (a news story stays valid). */
const NOT_FROM_SITE = new Set(["club.press_mention", "club.name"]);

const urlKey = (u: string) => (normalizeUrl(u) ?? u).toLowerCase().replace(/\/+$/, "");

function f(
  data: AuditData,
  claim: AuditClaim | null,
  clubId: string | null,
  check: string,
  severity: AuditFinding["severity"],
  confidence: AuditFinding["confidence"],
  detail: string,
  fix: AuditFinding["fix"],
  subject?: string,
): AuditFinding {
  const club = clubId ? data.clubs.get(clubId) : undefined;
  return {
    check,
    area: "consistency",
    severity,
    confidence,
    clubId,
    slug: club?.slug ?? null,
    subject: subject ?? (claim ? `${claim.fieldKey} ${claim.id}` : ""),
    detail,
    displayed: claim ? Boolean(club?.displayedClaimIds.has(claim.id)) : true,
    fix,
  };
}

export function checkConsistency(data: AuditData): AuditFinding[] {
  const out: AuditFinding[] = [];
  const later = data.now.getTime() + DAY;

  // Websites rejected for a club, and the ones still active (a rejected deep page of a
  // site the club still uses says nothing about the rest of that site).
  const rejectedSites = new Map<string, string[]>();
  for (const c of data.rejectedLinkClaims) {
    const v = c.value as { kind?: string; url?: string };
    if (v.kind === "website" && v.url)
      rejectedSites.set(c.clubId, [...(rejectedSites.get(c.clubId) ?? []), urlKey(v.url)]);
  }
  const activeSiteHosts = new Map<string, Set<string>>();
  for (const l of data.links)
    if (l.kind === "website") {
      const s = activeSiteHosts.get(l.clubId) ?? new Set<string>();
      s.add(hostOf(l.url));
      activeSiteHosts.set(l.clubId, s);
    }
  const fromRejectedSite = (clubId: string, sourceUrl: string, sourceType: string): boolean => {
    if (!OWN_SITE_TYPES.has(sourceType)) return false;
    const src = urlKey(sourceUrl);
    const host = hostOf(sourceUrl);
    if (activeSiteHosts.get(clubId)?.has(host)) return false;
    return (rejectedSites.get(clubId) ?? []).some((r) => {
      const root = !/^https?:\/\/[^/]+\/./.test(r);
      return root ? hostOf(r) === host : src === r || src.startsWith(`${r}/`);
    });
  };

  const active = new Set(data.claims.map((c) => c.id));
  for (const claim of data.claims) {
    if (claim.evidence.length === 0) {
      out.push(
        f(data, claim, claim.clubId, "consistency.no_evidence", "critical", "high", "active claim with no evidence", {
          kind: "reject_claims",
          claimIds: [claim.id],
          reason: "audit consistency.no_evidence: active claim with no evidence",
        }),
      );
      continue;
    }
    if (claim.firstObservedAt.getTime() > claim.lastObservedAt.getTime() + 1000)
      out.push(
        f(
          data,
          claim,
          claim.clubId,
          "consistency.observed_order",
          "medium",
          "high",
          "first observed after last observed",
          null,
        ),
      );
    if (claim.lastObservedAt.getTime() > later || claim.evidence.some((e) => e.observedAt.getTime() > later))
      out.push(
        f(data, claim, claim.clubId, "consistency.future_timestamp", "high", "high", "observed in the future", null),
      );
    for (const e of claim.evidence) {
      if (!e.snapshotId && !NO_SNAPSHOT_METHODS.has(e.method) && e.extractor !== "site-identity")
        out.push(
          f(
            data,
            claim,
            claim.clubId,
            "consistency.missing_snapshot",
            "medium",
            "high",
            `${e.extractor} evidence without a snapshot`,
            null,
          ),
        );
      if (e.snapshotId && e.snapshotSourceId && e.snapshotSourceId !== e.sourceId)
        out.push(
          f(
            data,
            claim,
            claim.clubId,
            "consistency.snapshot_of_other_source",
            "high",
            "high",
            "evidence snapshot belongs to a different source",
            null,
          ),
        );
      if (e.snapshotFetchedAt && e.observedAt.getTime() < e.snapshotFetchedAt.getTime() - 60_000)
        out.push(
          f(
            data,
            claim,
            claim.clubId,
            "consistency.observed_before_fetch",
            "medium",
            "high",
            "observed before its snapshot was fetched",
            null,
          ),
        );
      const expected = computeConfidence({
        sourceType: e.sourceType as SourceType,
        trustTier: e.tier,
        extractionMethod: e.method as ExtractionMethod,
        isDirect: e.isDirect,
      });
      // Extractors may down-weight (a medium-confidence date parse); they may never overstate.
      if (e.confidence > expected + 0.02 && claim.assertionKind !== "editorial")
        out.push(
          f(
            data,
            claim,
            claim.clubId,
            "consistency.confidence_overstated",
            "medium",
            "high",
            `confidence ${e.confidence} exceeds the ${expected} that tier ${e.tier} + ${e.method} allows`,
            null,
          ),
        );
    }
    if (
      !NOT_FROM_SITE.has(claim.fieldKey) &&
      claim.evidence.every((e) => fromRejectedSite(claim.clubId, e.sourceUrl, e.sourceType))
    )
      out.push(
        f(
          data,
          claim,
          claim.clubId,
          "consistency.evidence_from_rejected_site",
          "high",
          "high",
          `only evidence is ${hostOf(claim.evidence[0]?.sourceUrl ?? "")}, a website rejected for this club`,
          {
            kind: "reject_claims",
            claimIds: [claim.id],
            reason:
              "audit consistency.evidence_from_rejected_site: its only source is a website rejected for this club",
          },
        ),
      );
  }

  // The projection shows only active claims.
  for (const club of data.clubs.values())
    for (const id of club.displayedClaimIds)
      if (!active.has(id)) {
        out.push(
          f(
            data,
            null,
            club.id,
            "consistency.displays_inactive_claim",
            "critical",
            "high",
            `projection shows claim ${id}, which is not active`,
            { kind: "re_resolve" },
            id,
          ),
        );
        break;
      }
  for (const l of data.links)
    if (l.claimIds.length === 0)
      out.push(
        f(
          data,
          null,
          l.clubId,
          "consistency.link_without_active_claim",
          "critical",
          "high",
          `${l.kind} link shown with no active claim`,
          { kind: "re_resolve" },
          l.url,
        ),
      );
  return out;
}
