import { and, asc, count, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import {
  SELECTIVITY_RULESET_VERSION,
  compareTermKeys,
  computeAcceptanceRate,
  computeCycleStatus,
  deriveSelectivityLabel,
  termForDate,
  termKey,
  type ActivityStatus,
  type AffiliationScope,
  type DateValue,
  type JoinMode,
  type LinkKind,
  type OrgType,
  type RecognitionStatus,
  type ResolvedValue,
  type SourceType,
  type StageKind,
} from "@hci/core";
import type { Queryable } from "../client";
import type { StoredField } from "../resolve/project";
import {
  category,
  claim,
  claimEvidence,
  club,
  clubAlias,
  clubCategory,
  clubLink,
  clubSlugHistory,
  membershipEstimate,
  recruitingCycle,
  recruitingStage,
  source,
} from "../schema";
import {
  PostgresSearchProvider,
  recruitingNowPredicate,
  type ClubFilters,
  type SearchProvider,
  type SortKey,
} from "../search/provider";
import type {
  CategoryRef,
  ClubProfile,
  ClubSummary,
  CycleDetail,
  CycleSummary,
  ProfileLookup,
  SelectivityDisplay,
} from "./types";

type ClubRow = typeof club.$inferSelect;
type CycleRow = typeof recruitingCycle.$inferSelect;

function toCycleSummary(row: CycleRow, now: Date): CycleSummary {
  const opens = (row.opensValue as DateValue | null) ?? null;
  const deadline = (row.deadlineValue as DateValue | null) ?? null;
  const statedStatus = row.statedStatus === "open" || row.statedStatus === "closed" ? row.statedStatus : null;
  return {
    id: row.id,
    termKey: row.termKey,
    track: row.track,
    status: computeCycleStatus({ opensAt: opens, deadline, statedStatus }, now),
    opens,
    deadline,
    processTypes: row.processTypes as JoinMode[],
    applicationUrl: row.applicationUrl,
  };
}

const STATUS_PRIORITY: Record<CycleSummary["status"], number> = {
  open: 0,
  deadline_ahead: 1,
  upcoming: 2,
  closed: 3,
  unknown: 4,
};

/**
 * The cycle to feature: an open/upcoming one (soonest deadline first); otherwise the most
 * recent cycle in the current or a past term. Cycles with no dates at all are shown only
 * if nothing better exists.
 */
export function pickCurrentCycle<T extends CycleSummary>(cycles: readonly T[], now: Date): T | null {
  if (cycles.length === 0) return null;
  const currentTerm = termKey(termForDate(now));
  const sorted = [...cycles].sort((a, b) => {
    const p = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (p !== 0) return p;
    if (a.status === "closed" || a.status === "unknown") return compareTermKeys(b.termKey, a.termKey);
    const da = a.deadline?.at ?? "9999";
    const db = b.deadline?.at ?? "9999";
    return da < db ? -1 : da > db ? 1 : 0;
  });
  const best = sorted[0] ?? null;
  // A closed cycle from an old term isn't "current" information.
  if (best && best.status === "closed" && compareTermKeys(best.termKey, currentTerm) < 0) {
    const [bestYear] = best.termKey.split("-");
    const [curYear] = currentTerm.split("-");
    if (Number(curYear) - Number(bestYear) > 1) return null;
  }
  return best;
}

async function loadCategories(db: Queryable, clubIds: readonly string[]): Promise<Map<string, CategoryRef[]>> {
  const out = new Map<string, CategoryRef[]>();
  if (clubIds.length === 0) return out;
  const rows = await db
    .select({
      clubId: clubCategory.clubId,
      slug: category.slug,
      name: category.name,
      isPrimary: clubCategory.isPrimary,
    })
    .from(clubCategory)
    .innerJoin(category, eq(category.id, clubCategory.categoryId))
    .where(inArray(clubCategory.clubId, [...clubIds]))
    .orderBy(desc(clubCategory.isPrimary), asc(category.sortOrder), asc(category.name));
  for (const r of rows) {
    const list = out.get(r.clubId) ?? [];
    list.push({ slug: r.slug, name: r.name });
    out.set(r.clubId, list);
  }
  return out;
}

async function loadCycles(db: Queryable, clubIds: readonly string[]): Promise<Map<string, CycleRow[]>> {
  const out = new Map<string, CycleRow[]>();
  if (clubIds.length === 0) return out;
  const rows = await db
    .select()
    .from(recruitingCycle)
    .where(inArray(recruitingCycle.clubId, [...clubIds]));
  for (const r of rows) {
    const list = out.get(r.clubId) ?? [];
    list.push(r);
    out.set(r.clubId, list);
  }
  return out;
}

function toSummary(row: ClubRow, categories: CategoryRef[], cycles: CycleRow[], now: Date): ClubSummary {
  const summaries = cycles.map((c) => toCycleSummary(c, now));
  return {
    id: row.id,
    slug: row.slug,
    name: row.canonicalName,
    acronym: row.acronym,
    shortDescription: row.shortDescription,
    orgType: row.orgType as OrgType | null,
    recognitionStatus: row.recognitionStatus as RecognitionStatus,
    activityStatus: row.activityStatus as ActivityStatus,
    joinModes: row.joinModes as JoinMode[],
    freshmenEligible: row.freshmenEligible,
    categories,
    memberCount:
      row.memberCountMin !== null || row.memberCountMax !== null
        ? { min: row.memberCountMin, max: row.memberCountMax }
        : null,
    hoursPerWeek:
      row.hoursPerWeekMin !== null || row.hoursPerWeekMax !== null
        ? { min: row.hoursPerWeekMin, max: row.hoursPerWeekMax }
        : null,
    currentCycle: pickCurrentCycle(summaries, now),
    isFixture: row.dataOrigin === "fixture",
    completeness: row.completeness,
    sourceCount: row.sourceCount,
    lastObservedAt: row.lastObservedAt?.toISOString() ?? null,
  };
}

/** Load summaries for ids, preserving the given order. */
export async function getClubSummaries(db: Queryable, ids: readonly string[], now: Date): Promise<ClubSummary[]> {
  if (ids.length === 0) return [];
  const [rows, cats, cycles] = await Promise.all([
    db
      .select()
      .from(club)
      .where(inArray(club.id, [...ids])),
    loadCategories(db, ids),
    loadCycles(db, ids),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is ClubRow => r !== undefined)
    .map((r) => toSummary(r, cats.get(r.id) ?? [], cycles.get(r.id) ?? [], now));
}

export interface DirectoryQuery {
  text: string | null;
  filters: ClubFilters;
  sort: SortKey;
  page: number;
  pageSize: number;
  now: Date;
}

export async function listClubs(
  db: Queryable,
  query: DirectoryQuery,
  provider: SearchProvider = new PostgresSearchProvider(db),
): Promise<{ clubs: ClubSummary[]; total: number; page: number; pageCount: number }> {
  const page = Math.max(1, query.page);
  const result = await provider.searchClubs({
    text: query.text,
    filters: query.filters,
    sort: query.sort,
    limit: query.pageSize,
    offset: (page - 1) * query.pageSize,
    now: query.now,
  });
  const clubs = await getClubSummaries(db, result.ids, query.now);
  return { clubs, total: result.total, page, pageCount: Math.max(1, Math.ceil(result.total / query.pageSize)) };
}

function selectivityFor(cycles: CycleDetail[]): SelectivityDisplay | null {
  const sorted = [...cycles].sort((a, b) => compareTermKeys(b.termKey, a.termKey));
  for (const c of sorted) {
    const a = c.fields["cycle.applicants"];
    const m = c.fields["cycle.admits"];
    if (a?.kind !== "single" || m?.kind !== "single") continue;
    const applicants = a.current as ResolvedValue<number>;
    const admits = m.current as ResolvedValue<number>;
    const rate = computeAcceptanceRate(applicants.value, admits.value);
    if (rate === null) continue;
    return {
      termKey: c.termKey,
      applicants,
      admits,
      acceptanceRate: rate,
      label: deriveSelectivityLabel(applicants.value, admits.value),
      rulesetVersion: SELECTIVITY_RULESET_VERSION,
    };
  }
  return null;
}

export async function getClubProfile(db: Queryable, slug: string, now: Date): Promise<ProfileLookup> {
  let [row] = await db.select().from(club).where(eq(club.slug, slug));
  if (!row) {
    const [hist] = await db
      .select({ slug: club.slug })
      .from(clubSlugHistory)
      .innerJoin(club, eq(club.id, clubSlugHistory.clubId))
      .where(eq(clubSlugHistory.slug, slug));
    return hist ? { kind: "redirect", slug: hist.slug } : { kind: "not_found" };
  }
  if (row.recordState === "merged" && row.mergedIntoClubId) {
    const [target] = await db.select({ slug: club.slug }).from(club).where(eq(club.id, row.mergedIntoClubId));
    return target ? { kind: "redirect", slug: target.slug } : { kind: "not_found" };
  }
  if (row.recordState === "hidden") return { kind: "not_found" };
  row = row as ClubRow;

  const [cats, cycleMap, aliases, links, stages, members, sources] = await Promise.all([
    loadCategories(db, [row.id]),
    loadCycles(db, [row.id]),
    db
      .select({ alias: clubAlias.alias, kind: clubAlias.kind })
      .from(clubAlias)
      .where(and(eq(clubAlias.clubId, row.id), ne(clubAlias.kind, "acronym")))
      .orderBy(asc(clubAlias.alias)),
    db
      .select()
      .from(clubLink)
      .where(and(eq(clubLink.clubId, row.id), ne(clubLink.status, "rejected")))
      .orderBy(asc(clubLink.kind)),
    db
      .select({
        cycleId: recruitingStage.cycleId,
        ordinal: recruitingStage.ordinal,
        kind: recruitingStage.kind,
        label: recruitingStage.label,
        startsValue: recruitingStage.startsValue,
        endsValue: recruitingStage.endsValue,
      })
      .from(recruitingStage)
      .innerJoin(recruitingCycle, eq(recruitingCycle.id, recruitingStage.cycleId))
      .where(eq(recruitingCycle.clubId, row.id))
      .orderBy(asc(recruitingStage.ordinal)),
    db
      .select()
      .from(membershipEstimate)
      .where(eq(membershipEstimate.clubId, row.id))
      .orderBy(sql`${membershipEstimate.asOf} desc nulls last`),
    db
      .select({
        id: source.id,
        url: source.url,
        title: source.title,
        sourceType: source.sourceType,
        trustTier: source.trustTier,
        publisher: source.publisher,
        isFixture: source.isFixture,
        claimCount: count(sql`distinct ${claim.id}`).mapWith(Number),
        lastObservedAt: max(claimEvidence.observedAt),
      })
      .from(claimEvidence)
      .innerJoin(claim, eq(claim.id, claimEvidence.claimId))
      .innerJoin(source, eq(source.id, claimEvidence.sourceId))
      .where(and(eq(claim.clubId, row.id), eq(claim.status, "active")))
      .groupBy(source.id)
      .orderBy(asc(source.trustTier), desc(max(claimEvidence.observedAt))),
  ]);

  const cycleRows = cycleMap.get(row.id) ?? [];
  const cycles: CycleDetail[] = cycleRows
    .map((c) => ({
      ...toCycleSummary(c, now),
      stages: stages
        .filter((s) => s.cycleId === c.id)
        .map((s) => ({
          ordinal: s.ordinal,
          kind: s.kind as StageKind,
          label: s.label,
          startsAt: (s.startsValue as DateValue | null) ?? null,
          endsAt: (s.endsValue as DateValue | null) ?? null,
        })),
      applicants: c.applicants,
      admits: c.admits,
      fields: c.fields as Record<string, StoredField>,
    }))
    .sort((a, b) => compareTermKeys(b.termKey, a.termKey));

  const summary = toSummary(row, cats.get(row.id) ?? [], cycleRows, now);
  const currentCycle = summary.currentCycle ? (cycles.find((c) => c.id === summary.currentCycle?.id) ?? null) : null;

  const profile: ClubProfile = {
    ...summary,
    currentCycle,
    longDescription: row.longDescription,
    affiliationScope: row.affiliationScope as AffiliationScope,
    aliases,
    links: links.map((l) => ({
      kind: l.kind as LinkKind,
      url: l.url,
      handle: l.handle,
      label: l.label,
      status: l.status === "verified" ? "verified" : "candidate",
      lastObservedAt: l.lastObservedAt?.toISOString() ?? null,
    })),
    cycles,
    membership: members.map((m) => ({
      kind: m.kind === "range" ? "range" : "exact",
      count: m.count,
      min: m.min,
      max: m.max,
      asOf: m.asOf?.toISOString() ?? null,
      termKey: m.termKey,
      badge: m.badge,
      isCurrent: m.isCurrent,
    })),
    selectivity: selectivityFor(cycles),
    sources: sources.map((s) => ({
      ...s,
      sourceType: s.sourceType as SourceType,
      lastObservedAt: (s.lastObservedAt ?? new Date(0)).toISOString(),
    })),
    fields: row.fields as Record<string, StoredField>,
    conflictFields: row.conflictFields,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
  return { kind: "found", profile };
}

/** Profiles for the compare page, in the requested order; unknown slugs are skipped. */
export async function getClubsForCompare(db: Queryable, slugs: readonly string[], now: Date): Promise<ClubProfile[]> {
  const out: ClubProfile[] = [];
  for (const slug of slugs.slice(0, 4)) {
    const r = await getClubProfile(db, slug, now);
    if (r.kind === "found") out.push(r.profile);
  }
  return out;
}

export interface CategoryWithCount extends CategoryRef {
  id: string;
  parentSlug: string | null;
  description: string | null;
  clubCount: number;
}

/** Categories with the number of visible clubs (including children for parents). */
export async function getCategories(db: Queryable): Promise<CategoryWithCount[]> {
  const cats = await db.select().from(category).orderBy(asc(category.sortOrder), asc(category.name));
  const counts = await db
    .select({ categoryId: clubCategory.categoryId, clubId: clubCategory.clubId })
    .from(clubCategory)
    .innerJoin(club, eq(club.id, clubCategory.clubId))
    .where(and(eq(club.recordState, "active"), sql`${club.activityStatus} not in ('inactive', 'defunct')`));
  const bySlug = new Map(cats.map((c) => [c.id, c]));
  const clubsPerCategory = new Map<string, Set<string>>();
  for (const { categoryId, clubId } of counts) {
    for (let id: string | null = categoryId; id; id = bySlug.get(id)?.parentId ?? null) {
      const set = clubsPerCategory.get(id) ?? new Set<string>();
      set.add(clubId);
      clubsPerCategory.set(id, set);
    }
  }
  return cats.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    parentSlug: c.parentId ? (bySlug.get(c.parentId)?.slug ?? null) : null,
    clubCount: clubsPerCategory.get(c.id)?.size ?? 0,
  }));
}

/** Clubs recruiting now, soonest deadline first. */
export async function getRecruitingNow(db: Queryable, now: Date, limit = 8): Promise<ClubSummary[]> {
  const rows = await db
    .select({ id: club.id })
    .from(club)
    .where(and(eq(club.recordState, "active"), recruitingNowPredicate(now)))
    .orderBy(
      sql`(select min(rc.deadline_at) from ${recruitingCycle} rc where rc.club_id = ${club.id} and rc.deadline_at > ${now.toISOString()}::timestamptz) asc nulls last`,
      asc(club.canonicalName),
    )
    .limit(limit);
  return getClubSummaries(
    db,
    rows.map((r) => r.id),
    now,
  );
}

export async function getIndexStats(db: Queryable): Promise<{
  clubs: number;
  sources: number;
  fixtureClubs: number;
  lastObservedAt: string | null;
}> {
  const [c] = await db
    .select({
      clubs: count().mapWith(Number),
      fixtureClubs: sql<number>`count(*) filter (where ${club.dataOrigin} = 'fixture')`.mapWith(Number),
      lastObservedAt: max(club.lastObservedAt),
    })
    .from(club)
    .where(eq(club.recordState, "active"));
  const [s] = await db.select({ sources: count().mapWith(Number) }).from(source);
  return {
    clubs: c?.clubs ?? 0,
    fixtureClubs: c?.fixtureClubs ?? 0,
    sources: s?.sources ?? 0,
    lastObservedAt: c?.lastObservedAt?.toISOString() ?? null,
  };
}

/** Lightweight list for the compare picker. */
export async function getClubOptions(db: Queryable): Promise<{ slug: string; name: string; acronym: string | null }[]> {
  return db
    .select({ slug: club.slug, name: club.canonicalName, acronym: club.acronym })
    .from(club)
    .where(eq(club.recordState, "active"))
    .orderBy(sql`lower(${club.canonicalName})`);
}
