import { and, asc, count, desc, eq, inArray, max, ne, sql } from "drizzle-orm";
import {
  SELECTIVITY_RULESET_VERSION,
  compareTermKeys,
  computeAcceptanceRate,
  computeCycleStatus,
  deriveSelectivityLabel,
  UNKNOWN_JOINING,
  type ActivityStatus,
  type Joining,
  type AffiliationScope,
  type DateValue,
  type JoinMode,
  type LinkKind,
  type OrgType,
  type RecognitionStatus,
  type ResolvedValue,
  type SourceType,
  type StageKind,
  cleanDescriptionText,
  isArticleUrl,
  isFormUrl,
  isLegalPageUrl,
  termNamedInText,
} from "@hci/core";
import type { Queryable } from "../client";
import { pickCurrentCycle } from "../local/cycles";
import { pickQuickLinks, type RankableLink } from "../local/links";
import { withWorkingHost, type StoredField } from "../resolve/project";
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
  JoiningSummary,
  ProfileLookup,
  SelectivityDisplay,
} from "./types";

type ClubRow = typeof club.$inferSelect;
type CycleRow = typeof recruitingCycle.$inferSelect;

/**
 * A cycle date as listed: the instant, its precision and the club's label. The text the date
 * was read from and the parser's confidence are extraction internals (quotes stay internal,
 * ADR 0040), and the summary ships in the public static index.
 */
export function listedDate(v: DateValue | null | undefined): DateValue | null {
  if (!v) return null;
  return v.label ? { at: v.at, precision: v.precision, label: v.label } : { at: v.at, precision: v.precision };
}

/**
 * When a club or official page last stated this cycle's facts. A cycle whose facts were all
 * rejected states nothing (its `fields` are empty), whatever its rejected claims' pages saw:
 * otherwise an emptied row would read as a round the club announced (`announcedLaterRound`).
 */
function cycleVerifiedAt(row: CycleRow): string | null {
  const fields = row.fields as Record<string, unknown> | null | undefined;
  if (fields && typeof fields === "object" && Object.keys(fields).length === 0) return null;
  return row.lastVerifiedAt?.toISOString() ?? null;
}

export function toCycleSummary(row: CycleRow, now: Date): CycleSummary {
  const opens = listedDate(row.opensValue as DateValue | null);
  const deadline = listedDate(row.deadlineValue as DateValue | null);
  const statedStatus = row.statedStatus === "open" || row.statedStatus === "closed" ? row.statedStatus : null;
  return {
    id: row.id,
    termKey: row.termKey,
    track: row.track,
    status: computeCycleStatus(
      {
        opensAt: opens,
        deadline,
        statedStatus,
        termKey: row.termKey,
        lastVerifiedAt: cycleVerifiedAt(row),
      },
      now,
    ),
    statedStatus,
    opens,
    deadline,
    processTypes: row.processTypes as JoinMode[],
    applicationUrl: row.applicationUrl,
    eligibleClasses: row.eligibleClasses,
    lastVerifiedAt: cycleVerifiedAt(row),
  };
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

type LinkRow = typeof clubLink.$inferSelect;

function linkStatus(status: string): RankableLink["status"] {
  return status === "verified" ? "verified" : status === "probable" ? "probable" : "unverified";
}

function toRankable(l: LinkRow): RankableLink {
  return {
    kind: l.kind as LinkKind,
    url: l.url,
    handle: l.handle,
    label: l.label,
    status: linkStatus(l.status),
    confidence: l.confidence,
  };
}

/**
 * The term each application link's own words name: its label, or the title of the page or
 * form as last fetched ("The Harvard Independent Fall 2026 Comp Interest Form" behind "Fill
 * out the interest form here"). Keyed by normalized URL; only the term key leaves here, never
 * the title (ADR 0051 amendment).
 */
async function applicationLinkTerms(
  db: Queryable,
  links: readonly Pick<LinkRow, "kind" | "label" | "url" | "normalizedUrl">[],
): Promise<Map<string, string>> {
  // Hosted forms only: a form is made for one round, while a club's comp or join page ("Fall
  // Comp 2026 | The Harvard Crimson") is updated in place and stays the place to check.
  const apps = links.filter(
    (l) => (l.kind === "application_form" || l.kind === "application_page") && isFormUrl(l.url),
  );
  const out = new Map<string, string>();
  if (apps.length === 0) return out;
  const rows = await db
    .select({ normalizedUrl: source.normalizedUrl, title: source.title })
    .from(source)
    .where(
      and(
        inArray(
          source.normalizedUrl,
          apps.map((l) => l.normalizedUrl),
        ),
        // Only a title the page itself gave (it was fetched), not a guess from link text.
        sql`exists (select 1 from source_snapshot ss where ss.source_id = ${source.id})`,
      ),
    );
  const titles = new Map(rows.map((r) => [r.normalizedUrl, r.title]));
  for (const l of apps) {
    const term = termNamedInText(`${l.label ?? ""} | ${titles.get(l.normalizedUrl) ?? ""}`);
    if (term) out.set(l.normalizedUrl, term);
  }
  return out;
}

/** Website + Instagram links (every non-rejected status) for directory rows. */
async function loadQuickLinks(db: Queryable, clubIds: readonly string[]): Promise<Map<string, RankableLink[]>> {
  const out = new Map<string, RankableLink[]>();
  if (clubIds.length === 0) return out;
  const rows = await db
    .select()
    .from(clubLink)
    .where(
      and(
        inArray(clubLink.clubId, [...clubIds]),
        inArray(clubLink.kind, ["website", "instagram"]),
        ne(clubLink.status, "rejected"),
      ),
    );
  for (const r of rows) {
    const list = out.get(r.clubId) ?? [];
    list.push(toRankable(r));
    out.set(r.clubId, list);
  }
  return out;
}

function toSummary(
  row: ClubRow,
  categories: CategoryRef[],
  cycles: CycleRow[],
  links: readonly RankableLink[],
  now: Date,
): ClubSummary {
  const summaries = cycles.map((c) => toCycleSummary(c, now));
  return {
    id: row.id,
    slug: row.slug,
    name: row.canonicalName,
    acronym: row.acronym,
    shortDescription: cleanDescriptionText(row.shortDescription),
    orgType: row.orgType as OrgType | null,
    recognitionStatus: row.recognitionStatus as RecognitionStatus,
    activityStatus: row.activityStatus as ActivityStatus,
    joinModes: row.joinModes as JoinMode[],
    freshmenEligible: row.freshmenEligible,
    joining: joiningSummary(storedJoining(row.joining)),
    categories,
    memberCount:
      row.memberCountMin !== null || row.memberCountMax !== null
        ? { min: row.memberCountMin, max: row.memberCountMax }
        : null,
    instagramFollowers: row.instagramFollowers,
    hoursPerWeek:
      row.hoursPerWeekMin !== null || row.hoursPerWeekMax !== null
        ? { min: row.hoursPerWeekMin, max: row.hoursPerWeekMax }
        : null,
    currentCycle: pickCurrentCycle(summaries, now),
    isFixture: row.dataOrigin === "fixture",
    completeness: row.completeness,
    sourceCount: row.sourceCount,
    lastObservedAt: row.lastObservedAt?.toISOString() ?? null,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    eligibleClasses: row.eligibleClasses,
    affiliationScope: row.affiliationScope as AffiliationScope,
    activityConfidence: row.activityConfidence,
    activityReasons: row.activityReasons,
    quickLinks: pickQuickLinks(links),
    logo: logoOf(row.fields),
    pressCount: pressCountOf(row.fields),
  };
}

/** The resolver's joining facts; a club not re-resolved since ADR 0041 has none (all unknown). */
export function storedJoining(raw: unknown): Joining {
  return raw && typeof raw === "object" && (raw as { version?: unknown }).version === UNKNOWN_JOINING.version
    ? (raw as Joining)
    : UNKNOWN_JOINING;
}

/** Joining facts without their basis: what lists, filters and the static index need. */
export function joiningSummary(j: Joining): JoiningSummary {
  const { basis: _b, version: _v, ...rest } = j;
  return rest;
}

/** How many news articles name the club (`club.press_mention` values). */
export function pressCountOf(fields: unknown): number {
  const stored = (fields as Record<string, { kind?: string; values?: unknown[] } | undefined> | null)?.[
    "club.press_mention"
  ];
  return stored?.kind === "multi" && Array.isArray(stored.values) ? stored.values.length : 0;
}

/** The resolved `club.logo` URL from the projection's fields, if any. */
export function logoOf(fields: unknown): string | null {
  const stored = (fields as Record<string, { current?: { value?: unknown } | null } | undefined> | null)?.["club.logo"];
  const v = stored?.current?.value;
  return typeof v === "string" && /^https?:\/\//.test(v) ? v : null;
}

/** Load summaries for ids, preserving the given order. */
export async function getClubSummaries(db: Queryable, ids: readonly string[], now: Date): Promise<ClubSummary[]> {
  if (ids.length === 0) return [];
  const [rows, cats, cycles, links] = await Promise.all([
    db
      .select()
      .from(club)
      .where(inArray(club.id, [...ids])),
    loadCategories(db, ids),
    loadCycles(db, ids),
    loadQuickLinks(db, ids),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is ClubRow => r !== undefined)
    .map((r) => toSummary(r, cats.get(r.id) ?? [], cycles.get(r.id) ?? [], links.get(r.id) ?? [], now));
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
      .orderBy(
        sql`case ${clubLink.status} when 'verified' then 0 when 'probable' then 1 else 2 end`,
        desc(clubLink.confidence),
        asc(clubLink.kind),
        asc(clubLink.url),
      ),
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
        fieldKeys: sql<string[]>`array_agg(distinct ${claim.fieldKey})`,
        // Another club's own page (the Harvard Independent's article about a show): not this club's channel.
        otherClubsPage: sql<boolean>`(${source.ownerClubId} is not null and ${source.ownerClubId} <> ${row.id}
          and not exists (select 1 from club oc where oc.id = ${source.ownerClubId} and oc.merged_into_club_id = ${row.id}))`,
        // Every observation from this page is a link-graph reference (it only points at the club's site).
        linkGraphOnly: sql<boolean>`bool_and(${claimEvidence.extractorName} = 'link-graph')`,
        // Where the page last answered: shown instead of a scheme or host it doesn't answer on.
        workingUrl: sql<string | null>`(select ss.final_url from source_snapshot ss
          where ss.source_id = ${source.id} and ss.http_status = 200 order by ss.fetched_at desc limit 1)`,
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

  const summary = toSummary(row, cats.get(row.id) ?? [], cycleRows, links.map(toRankable), now);
  const currentCycle = summary.currentCycle ? (cycles.find((c) => c.id === summary.currentCycle?.id) ?? null) : null;
  const terms = await applicationLinkTerms(db, links);

  const profile: ClubProfile = {
    ...summary,
    currentCycle,
    longDescription: cleanDescriptionText(row.longDescription),
    joiningBasis: storedJoining(row.joining).basis,
    aliases,
    links: links.map((l) => ({
      ...toRankable(l),
      term: terms.get(l.normalizedUrl) ?? null,
      signals: l.signals,
      discoveredVia: l.discoveredVia,
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
    sources: listedSources(sources).map(({ fieldKeys: _fields, workingUrl, otherClubsPage, linkGraphOnly: _lg, ...s }) => ({
      ...s,
      url: workingUrl ? withWorkingHost(s.url, workingUrl) : s.url,
      sourceType: sourceTypeForClub(s.sourceType as SourceType, otherClubsPage),
      lastObservedAt: (s.lastObservedAt ?? new Date(0)).toISOString(),
    })),
    fields: row.fields as Record<string, StoredField>,
    conflictFields: row.conflictFields,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
  return { kind: "found", profile };
}

/**
 * The pages a profile lists as its sources. A privacy or permissions page is never one,
 * and a news post that only repeats the site's own social links isn't either (a newspaper
 * club's every article does): their facts are already backed by the club's other pages. PURE.
 */
export function listedSources<
  T extends { url: string; fieldKeys: readonly string[] | null; linkGraphOnly?: boolean; otherClubsPage?: boolean },
>(rows: readonly T[]): T[] {
  const kept = rows.filter(
    (r) =>
      // A page that only corroborates the club's website through the link graph (another club's
      // page, or one whose only claim is the website reference) is not a source a student can use.
      !(r.linkGraphOnly && (r.otherClubsPage || (r.fieldKeys ?? []).every((k) => k === "club.link"))) &&
      !isLegalPageUrl(r.url) &&
      !isSearchResultsUrl(r.url) &&
      !(isArticleUrl(r.url) && (r.fieldKeys ?? []).every((k) => k === "club.link")),
  );
  // Pages of one paginated listing ("pbha.org/programs?offset=1734301560265", round 3) are one
  // source: the first page when it is listed, else the first of them.
  const byListing = new Map<string, T>();
  for (const r of kept) {
    const key = unpaginated(r.url);
    const seen = byListing.get(key);
    if (!seen || (seen.url !== key && r.url === key)) byListing.set(key, r);
  }
  return kept.filter((r) => byListing.get(unpaginated(r.url)) === r);
}

/** The URL without pagination parameters (`offset`, `page`, `p`). PURE. */
function unpaginated(url: string): string {
  try {
    const u = new URL(url);
    // Only numeric values: "?page=about" routes to a different page on some sites.
    for (const k of ["offset", "page", "p"]) if (/^\d+$/.test(u.searchParams.get(k) ?? "")) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

const CLUB_CHANNELS = new Set<SourceType>([
  "club_website",
  "club_social",
  "club_recruiting_material",
  "club_publication",
]);

/**
 * How a profile labels a source: another club's own channel (a student paper's article about
 * this club) is a Harvard-related publication here, never "Club website". PURE.
 */
export function sourceTypeForClub(type: SourceType, otherClubsPage: boolean): SourceType {
  return otherClubsPage && CLUB_CHANNELS.has(type) ? "harvard_related_other" : type;
}

/** A search engine's results page: how we found a page, not a source a student can read. */
function isSearchResultsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return (
      host === "search.brave.com" ||
      host === "api.search.brave.com" ||
      host === "duckduckgo.com" ||
      (/^google\.[a-z.]+$/.test(host) && u.pathname.startsWith("/search")) ||
      (host === "bing.com" && u.pathname.startsWith("/search"))
    );
  } catch {
    return false;
  }
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

/** Every URL slug the static site must build: live profiles, and retired/merged slugs (redirects). */
export async function getClubSlugs(db: Queryable): Promise<{ live: string[]; retired: string[] }> {
  const rows = await db.select({ slug: club.slug, state: club.recordState }).from(club);
  const history = await db.select({ slug: clubSlugHistory.slug }).from(clubSlugHistory);
  const live = rows.filter((r) => r.state === "active").map((r) => r.slug);
  const taken = new Set(live);
  const retired = [
    ...new Set([...rows.filter((r) => r.state === "merged").map((r) => r.slug), ...history.map((h) => h.slug)]),
  ].filter((s) => !taken.has(s));
  return { live, retired };
}
