import { and, eq, isNotNull, ne } from "drizzle-orm";
import { MATCHER_VERSION, matchOrganization, type KnownOrg, type MatchResult } from "@hci/core";
import { createClub, schema, type Queryable } from "@hci/db";
import type { DiscoveredOrganization } from "../types";

const { club, clubAlias, clubLink, entityMention, mergeCandidate } = schema;

/**
 * Load the identity index used for matching. Fixture clubs are excluded so demo data
 * can never absorb real organizations.
 */
export async function loadKnownOrgs(db: Queryable): Promise<KnownOrg[]> {
  const clubs = await db
    .select({ id: club.id, name: club.canonicalName, acronym: club.acronym })
    .from(club)
    .where(and(eq(club.recordState, "active"), ne(club.dataOrigin, "fixture")));
  const byId = new Map<
    string,
    KnownOrg & { names: string[]; acronyms: string[]; urls: string[]; externalIds: { system: string; id: string }[] }
  >();
  for (const c of clubs) {
    byId.set(c.id, {
      clubId: c.id,
      names: [c.name],
      acronyms: c.acronym ? [c.acronym] : [],
      urls: [],
      externalIds: [],
    });
  }
  for (const a of await db
    .select({ clubId: clubAlias.clubId, alias: clubAlias.alias, kind: clubAlias.kind })
    .from(clubAlias)) {
    const k = byId.get(a.clubId);
    if (!k) continue;
    if (a.kind === "acronym") k.acronyms.push(a.alias);
    else k.names.push(a.alias);
  }
  for (const l of await db
    .select({ clubId: clubLink.clubId, url: clubLink.normalizedUrl })
    .from(clubLink)
    .where(eq(clubLink.status, "verified"))) {
    byId.get(l.clubId)?.urls.push(l.url);
  }
  for (const m of await db
    .select({ clubId: entityMention.resolvedClubId, payload: entityMention.payload })
    .from(entityMention)
    .where(isNotNull(entityMention.resolvedClubId))) {
    const ids = (m.payload as { externalIds?: { system: string; id: string }[] }).externalIds ?? [];
    if (m.clubId) byId.get(m.clubId)?.externalIds.push(...ids);
  }
  return [...byId.values()];
}

export interface MentionResolution {
  clubId: string;
  decision: MatchResult["decision"] | "existing_mention";
  mergeCandidateClubId: string | null;
}

/**
 * Resolve a discovered organization to a club (CLAUDE.md §12):
 *   - a mention seen before keeps its club (stable across runs ⇒ idempotent)
 *   - definite match ⇒ attach to that club
 *   - probable match ⇒ create a new club AND a merge candidate for human review
 *     (never auto-merge on weak evidence)
 *   - no match ⇒ create a new club
 * `known` is updated in place so later mentions in the same run can match new clubs.
 */
export async function resolveMention(
  db: Queryable,
  input: {
    sourceId: string;
    snapshotId: string | null;
    runId: string | null;
    org: DiscoveredOrganization;
    known: KnownOrg[];
  },
): Promise<MentionResolution> {
  const { org } = input;
  const payload = { externalIds: org.identity.externalIds, urls: org.identity.urls };

  const [existing] = await db
    .select({ id: entityMention.id, clubId: entityMention.resolvedClubId })
    .from(entityMention)
    .where(and(eq(entityMention.sourceId, input.sourceId), eq(entityMention.externalKey, org.externalKey)));
  if (existing?.clubId) {
    await db
      .update(entityMention)
      .set({ snapshotId: input.snapshotId, ingestionRunId: input.runId, rawName: org.name, payload })
      .where(eq(entityMention.id, existing.id));
    return { clubId: existing.clubId, decision: "existing_mention", mergeCandidateClubId: null };
  }

  const match = matchOrganization(
    {
      names: [org.name],
      acronyms: org.acronym ? [org.acronym] : [],
      urls: org.identity.urls,
      externalIds: org.identity.externalIds,
    },
    input.known,
  );

  let clubId: string;
  let mergeWith: string | null = null;
  if (match.decision === "definite" && match.clubId) {
    clubId = match.clubId;
  } else {
    clubId = (await createClub(db, { name: org.name })).id;
    if (match.decision === "probable" && match.clubId) {
      mergeWith = match.clubId;
      const [a, b] = clubId < match.clubId ? [clubId, match.clubId] : [match.clubId, clubId];
      await db
        .insert(mergeCandidate)
        .values({
          clubAId: a,
          clubBId: b,
          score: match.score,
          signals: match.candidates[0]?.signals ?? [],
          matcherVersion: MATCHER_VERSION,
        })
        .onConflictDoNothing();
    }
    input.known.push({
      clubId,
      names: [org.name],
      acronyms: org.acronym ? [org.acronym] : [],
      urls: [],
      externalIds: org.identity.externalIds,
    });
  }

  const values = {
    snapshotId: input.snapshotId,
    ingestionRunId: input.runId,
    sourceId: input.sourceId,
    externalKey: org.externalKey,
    rawName: org.name,
    rawAcronym: org.acronym ?? null,
    payload,
    resolution: match.decision,
    resolvedClubId: clubId,
    matchScore: match.score,
    matchSignals: match.candidates.slice(0, 3),
    matcherVersion: MATCHER_VERSION,
  };
  if (existing) await db.update(entityMention).set(values).where(eq(entityMention.id, existing.id));
  else await db.insert(entityMention).values(values);
  return { clubId, decision: match.decision, mergeCandidateClubId: mergeWith };
}
