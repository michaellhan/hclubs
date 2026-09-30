import { and, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import type { Queryable } from "../client";
import { claim, claimEvidence, club, clubLink, entityMention, ingestionRun, mergeCandidate, source } from "../schema";

/**
 * Internal review data (M2 §15). Development-only UI consumes this; nothing here is
 * exposed publicly.
 */
export async function getReviewQueue(db: Queryable) {
  const candidates = await db
    .select()
    .from(mergeCandidate)
    .where(eq(mergeCandidate.status, "proposed"))
    .orderBy(desc(mergeCandidate.score))
    .limit(200);
  const recentMerges = await db
    .select()
    .from(mergeCandidate)
    .where(eq(mergeCandidate.status, "confirmed"))
    .orderBy(desc(mergeCandidate.decidedAt))
    .limit(50);
  const ids = [...new Set([...candidates, ...recentMerges].flatMap((c) => [c.clubAId, c.clubBId]))];
  const clubs = ids.length
    ? await db
        .select({
          id: club.id,
          slug: club.slug,
          name: club.canonicalName,
          desc: club.shortDescription,
          state: club.recordState,
          sources: club.sourceCount,
        })
        .from(club)
        .where(inArray(club.id, ids))
    : [];
  const clubById = new Map(clubs.map((c) => [c.id, c]));

  const unresolved = await db
    .select({
      id: entityMention.id,
      rawName: entityMention.rawName,
      resolution: entityMention.resolution,
      explanation: entityMention.matchExplanation,
      score: entityMention.matchScore,
      clubSlug: club.slug,
      source: source.adapter,
    })
    .from(entityMention)
    .leftJoin(club, eq(club.id, entityMention.resolvedClubId))
    .innerJoin(source, eq(source.id, entityMention.sourceId))
    .where(
      or(
        eq(entityMention.resolution, "probable"),
        eq(entityMention.resolution, "ambiguous"),
        eq(entityMention.resolution, "pending"),
      ),
    )
    .orderBy(desc(entityMention.matchScore))
    .limit(200);

  const suspiciousLinks = await db
    .select({
      clubSlug: club.slug,
      clubName: club.canonicalName,
      kind: clubLink.kind,
      url: clubLink.url,
      status: clubLink.status,
      confidence: clubLink.confidence,
      via: clubLink.discoveredVia,
      signals: clubLink.signals,
    })
    .from(clubLink)
    .innerJoin(club, eq(club.id, clubLink.clubId))
    .where(and(inArray(clubLink.status, ["probable", "unverified"]), ne(club.dataOrigin, "fixture")))
    .orderBy(clubLink.confidence)
    .limit(200);

  const lowConfidence = await db
    .select({
      clubSlug: club.slug,
      field: claim.fieldKey,
      value: claim.value,
      confidence: claimEvidence.confidence,
      method: claimEvidence.extractionMethod,
      quote: claimEvidence.evidenceQuote,
      url: source.url,
    })
    .from(claimEvidence)
    .innerJoin(claim, eq(claim.id, claimEvidence.claimId))
    .innerJoin(club, eq(club.id, claim.clubId))
    .innerJoin(source, eq(source.id, claimEvidence.sourceId))
    .where(and(lt(claimEvidence.confidence, 0.5), eq(claim.status, "active"), ne(club.dataOrigin, "fixture")))
    .orderBy(claimEvidence.confidence)
    .limit(150);

  const conflicts = await db
    .select({ slug: club.slug, name: club.canonicalName, fields: club.conflictFields })
    .from(club)
    .where(and(eq(club.recordState, "active"), sql`cardinality(${club.conflictFields}) > 0`))
    .limit(150);

  const runs = await db.select().from(ingestionRun).orderBy(desc(ingestionRun.startedAt)).limit(25);

  return {
    candidates: candidates
      // A pair involving an already-merged club is moot.
      .map((c) => ({
        ...c,
        a: clubById.get(c.clubAId) ?? null,
        b: clubById.get(c.clubBId) ?? null,
      }))
      .filter((c) => c.a?.state === "active" && c.b?.state === "active"),
    recentMerges: recentMerges.map((c) => ({
      ...c,
      a: clubById.get(c.clubAId) ?? null,
      b: clubById.get(c.clubBId) ?? null,
    })),
    unresolved,
    suspiciousLinks,
    lowConfidence,
    conflicts,
    runs,
  };
}
