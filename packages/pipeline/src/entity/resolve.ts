import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { MATCHER_VERSION, matchOrganization, type KnownOrg, type MatchResult } from "@hci/core";
import { createClub, schema, type Queryable } from "@hci/db";
import type { DiscoveredOrganization } from "../types";

const { club, clubAlias, clubLink, entityMention, mergeCandidate } = schema;

/** Link kinds that identify an org (its own site/accounts). Directory pages and forms don't. */
const IDENTITY_LINK_KINDS = [
  "website",
  "instagram",
  "linkedin",
  "facebook",
  "x",
  "youtube",
  "tiktok",
  "github",
  "link_in_bio",
];

type MutableKnown = KnownOrg & {
  names: string[];
  acronyms: string[];
  urls: string[];
  externalIds: { system: string; id: string }[];
  descriptions: string[];
};

/**
 * Load the identity index used for matching. Fixture clubs are excluded so demo data can
 * never absorb real organizations; merged-away clubs contribute their names, links and
 * directory ids to the surviving club.
 */
export async function loadKnownOrgs(db: Queryable): Promise<KnownOrg[]> {
  const clubs = await db
    .select({ id: club.id, name: club.canonicalName, acronym: club.acronym, desc: club.shortDescription })
    .from(club)
    .where(and(eq(club.recordState, "active"), ne(club.dataOrigin, "fixture")));
  const merged = await db
    .select({ id: club.id, into: club.mergedIntoClubId, name: club.canonicalName })
    .from(club)
    .where(eq(club.recordState, "merged"));
  const mergedInto = new Map(merged.map((m) => [m.id, m.into]));
  const rootOf = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 20; i++) {
      const next = mergedInto.get(cur);
      if (!next) return cur;
      cur = next;
    }
    return cur;
  };

  const byId = new Map<string, MutableKnown>();
  for (const c of clubs) {
    byId.set(c.id, {
      clubId: c.id,
      names: [c.name],
      acronyms: c.acronym ? [c.acronym] : [],
      urls: [],
      externalIds: [],
      descriptions: c.desc ? [c.desc] : [],
    });
  }
  const target = (id: string) => byId.get(rootOf(id));
  for (const m of merged) target(m.id)?.names.push(m.name);
  for (const a of await db
    .select({ clubId: clubAlias.clubId, alias: clubAlias.alias, kind: clubAlias.kind })
    .from(clubAlias)) {
    const k = target(a.clubId);
    if (!k) continue;
    if (a.kind === "acronym") k.acronyms.push(a.alias);
    else k.names.push(a.alias);
  }
  // Only links established as the club's own (verified) are identity signals.
  for (const l of await db
    .select({ clubId: clubLink.clubId, url: clubLink.normalizedUrl })
    .from(clubLink)
    .where(and(eq(clubLink.status, "verified"), inArray(clubLink.kind, IDENTITY_LINK_KINDS)))) {
    target(l.clubId)?.urls.push(l.url);
  }
  for (const m of await db
    .select({ clubId: entityMention.resolvedClubId, payload: entityMention.payload })
    .from(entityMention)
    .where(isNotNull(entityMention.resolvedClubId))) {
    const p = m.payload as { externalIds?: { system: string; id: string }[] };
    if (m.clubId) target(m.clubId)?.externalIds.push(...(p.externalIds ?? []));
  }
  return [...byId.values()];
}

export interface MentionResolution {
  clubId: string;
  decision: MatchResult["decision"] | "existing_mention";
  mergeCandidates: number;
  explanation: string;
}

/** Follow merge pointers to the surviving club. */
async function survivor(db: Queryable, id: string): Promise<string> {
  let cur = id;
  for (let i = 0; i < 20; i++) {
    const [row] = await db.select({ into: club.mergedIntoClubId }).from(club).where(eq(club.id, cur));
    if (!row?.into) return cur;
    cur = row.into;
  }
  return cur;
}

/** A reviewer rejected (or undid) this pair: never re-propose or auto-merge it. */
async function rejectedPair(db: Queryable, a: string, b: string): Promise<boolean> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const [row] = await db
    .select({ status: mergeCandidate.status })
    .from(mergeCandidate)
    .where(and(eq(mergeCandidate.clubAId, lo), eq(mergeCandidate.clubBId, hi)));
  return row?.status === "rejected" || row?.status === "undone";
}

/**
 * Resolve a discovered organization (a candidate) to a canonical club (CLAUDE.md §12):
 *   - a mention seen before keeps its club (stable across runs ⇒ idempotent)
 *   - definite (high-confidence) ⇒ attach to that club
 *   - probable / ambiguous ⇒ create a new club AND merge candidates for review
 *   - new ⇒ create a club
 * The decision, score, signals and a human-readable explanation are persisted on the
 * mention. `known` is updated in place so later mentions in the same run can match.
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
    return {
      clubId: await survivor(db, existing.clubId),
      decision: "existing_mention",
      mergeCandidates: 0,
      explanation: "seen before in this source",
    };
  }

  const descriptions = org.claims
    .filter((c) => c.fieldKey === "club.short_description" || c.fieldKey === "club.long_description")
    .map((c) => String(c.value));
  const identity = {
    names: [org.name],
    acronyms: org.acronym ? [org.acronym] : [],
    urls: org.identity.urls,
    externalIds: org.identity.externalIds,
    descriptions,
  };
  const match = matchOrganization(identity, input.known);

  let clubId: string;
  let decision: MatchResult["decision"] = match.decision;
  let mergeCandidates = 0;
  if (match.decision === "definite" && match.clubId) {
    clubId = match.clubId;
    // Enrich the in-memory index so later mentions in this run see the new signals.
    const k = input.known.find((x) => x.clubId === clubId) as MutableKnown | undefined;
    if (k) {
      k.names.push(org.name);
      k.urls.push(...org.identity.urls);
      k.externalIds.push(...org.identity.externalIds);
      if (org.acronym) k.acronyms.push(org.acronym);
    }
  } else {
    clubId = (await createClub(db, { name: org.name })).id;
    if (match.decision === "probable" || match.decision === "ambiguous") {
      const proposals =
        match.decision === "ambiguous"
          ? match.candidates.filter((c) => c.score >= match.score - 0.05)
          : match.candidates.slice(0, 1);
      for (const cand of proposals) {
        if (await rejectedPair(db, clubId, cand.clubId)) continue;
        const [a, b] = clubId < cand.clubId ? [clubId, cand.clubId] : [cand.clubId, clubId];
        await db
          .insert(mergeCandidate)
          .values({
            clubAId: a,
            clubBId: b,
            score: cand.score,
            signals: cand.signals,
            reason: match.decision === "ambiguous" ? "ambiguous" : "likely_duplicate",
            explanation: match.explanation,
            matcherVersion: MATCHER_VERSION,
          })
          .onConflictDoNothing();
        mergeCandidates++;
      }
      if (mergeCandidates === 0) decision = "new";
    }
    const entry: MutableKnown = {
      clubId,
      ...identity,
      names: [...identity.names],
      acronyms: [...identity.acronyms],
      urls: [...identity.urls],
      externalIds: [...identity.externalIds],
      descriptions: [...descriptions],
    };
    input.known.push(entry);
  }

  const values = {
    snapshotId: input.snapshotId,
    ingestionRunId: input.runId,
    sourceId: input.sourceId,
    externalKey: org.externalKey,
    rawName: org.name,
    rawAcronym: org.acronym ?? null,
    payload,
    resolution: decision,
    resolvedClubId: clubId,
    matchScore: match.score,
    matchSignals: match.candidates.slice(0, 3),
    matchExplanation: match.explanation,
    matcherVersion: MATCHER_VERSION,
  };
  if (existing) await db.update(entityMention).set(values).where(eq(entityMention.id, existing.id));
  else await db.insert(entityMention).values(values);
  return { clubId, decision, mergeCandidates, explanation: match.explanation };
}
