import { and, arrayOverlaps, asc, desc, eq, inArray, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { ClubFilters, SortKey } from "../local/filters";
import { normalizeAcronym, normalizeName, termForDate, termKey } from "@hci/core";
import type { Queryable } from "../client";
import { category, club, clubCategory, clubLink, clubSearchDocument, recruitingCycle } from "../schema";

/**
 * Search abstraction. CLAUDE.md §13. The web app depends on `SearchProvider`, not on
 * Postgres specifics, so Typesense/Meilisearch could replace it if ever measured necessary.
 */

export { ClubFilters, SORT_KEYS, isSortKey, type SortKey } from "../local/filters";

export interface SearchRequest {
  text: string | null;
  filters: ClubFilters;
  sort: SortKey;
  limit: number;
  offset: number;
  now: Date;
}

export interface SearchResult {
  ids: string[];
  total: number;
}

export interface SearchProvider {
  searchClubs(request: SearchRequest): Promise<SearchResult>;
}

const MAX_QUERY_LENGTH = 100;

/** Build a safe prefix tsquery string ("harv:* & cons:*") from free text. */
export function toPrefixTsQuery(text: string): string | null {
  const tokens = normalizeName(text)
    .split(" ")
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .slice(0, 8);
  return tokens.length > 0 ? tokens.map((t) => `${t}:*`).join(" & ") : null;
}

/** Sortable number for a term key "YYYY-season", ordered like core `compareTermKeys`. */
function termOrder(key: SQL): SQL {
  return sql`(substring(${key}, 1, 4)::int * 10 + case substring(${key}, 6) when 'winter' then 0 when 'spring' then 1 when 'summer' then 2 else 3 end)`;
}

/** SQL predicate: the cycle is open or has a known future deadline (mirrors core computeCycleStatus). */
export function recruitingNowPredicate(now: Date): SQL {
  const n = now.toISOString();
  const currentTerm = termKey(termForDate(now));
  return sql`exists (
    select 1 from ${recruitingCycle} rc
    where rc.club_id = ${club.id}
      and (
        (rc.deadline_at > ${n}::timestamptz
          and (rc.opens_at is null or rc.opens_at <= ${n}::timestamptz)
          and coalesce(rc.stated_status, '') <> 'closed')
        or (rc.deadline_at is null and rc.stated_status = 'open'
          and (rc.opens_at is null or rc.opens_at <= ${n}::timestamptz)
          -- "open" stated in an earlier term isn't open now (ADR 0031)
          and ${termOrder(sql`rc.term_key`)} >= ${termOrder(sql`${currentTerm}::text`)})
      )
  )`;
}

export class PostgresSearchProvider implements SearchProvider {
  constructor(private readonly db: Queryable) {}

  async searchClubs(request: SearchRequest): Promise<SearchResult> {
    const { filters } = request;
    const conditions: SQL[] = [eq(club.recordState, "active")];

    if (!filters.includeInactive) {
      conditions.push(notInArray(club.activityStatus, ["inactive", "defunct"]));
    }
    if (filters.categories.length > 0) {
      const parents = this.db
        .select({ id: category.id })
        .from(category)
        .where(inArray(category.slug, filters.categories));
      const matching = this.db
        .select({ clubId: clubCategory.clubId })
        .from(clubCategory)
        .innerJoin(category, eq(category.id, clubCategory.categoryId))
        .where(or(inArray(category.slug, filters.categories), inArray(category.parentId, parents)));
      conditions.push(inArray(club.id, matching));
    }
    if (filters.joinModes.length > 0) {
      conditions.push(arrayOverlaps(club.joinModes, filters.joinModes));
    }
    if (filters.recognition.length > 0) conditions.push(inArray(club.recognitionStatus, filters.recognition));
    if (filters.orgTypes.length > 0) conditions.push(inArray(club.orgType, filters.orgTypes));
    if (filters.freshmenEligible) conditions.push(eq(club.freshmenEligible, true));
    if (!filters.includeGraduate) conditions.push(ne(club.affiliationScope, "graduate_school"));
    if (filters.classYear) {
      conditions.push(
        filters.classYear === "first_year"
          ? (or(eq(club.freshmenEligible, true), sql`${"first_year"} = any(${club.eligibleClasses})`) as SQL)
          : sql`${filters.classYear} = any(${club.eligibleClasses})`,
      );
    }
    if (filters.recruitingSeasons.length > 0) {
      // Same rule as @hci/db/local: the club's usual recruiting terms include any selected one.
      conditions.push(
        sql`(${club.fields}->'club.recruiting_seasons'->'current'->'value') ?| ${sql.raw(
          `array[${filters.recruitingSeasons.map((s) => `'${s.replace(/[^a-z]/g, "")}'`).join(",")}]`,
        )}`,
      );
    }
    if (filters.recruitingNow) conditions.push(recruitingNowPredicate(request.now));
    if (filters.hideSparse) {
      // Same rule as isSparseClub: keep clubs with a short description or a website/Instagram link.
      conditions.push(sql`(coalesce(btrim(${club.shortDescription}), '') <> '' or exists (
        select 1 from ${clubLink} cl
        where cl.club_id = ${club.id} and cl.kind in ('website', 'instagram') and cl.status <> 'rejected'
      ))`);
    }

    const text = request.text?.trim().slice(0, MAX_QUERY_LENGTH) ?? "";
    let score: SQL = sql`0`;
    if (text) {
      const qNorm = normalizeName(text);
      const qAcr = text.length <= 12 && !/\s/.test(text.trim()) ? normalizeAcronym(text) : "";
      const prefix = toPrefixTsQuery(text);
      const tsq = prefix
        ? sql`(to_tsquery('simple', ${prefix}) || plainto_tsquery('english', ${text}))`
        : sql`plainto_tsquery('english', ${text})`;
      const docMatch = sql`${clubSearchDocument.document} @@ ${tsq}`;
      const acrMatch = qAcr.length >= 2 ? sql`${qAcr} = any(${clubSearchDocument.acronyms})` : sql`false`;
      const exactName = sql`(' | ' || ${clubSearchDocument.names} || ' | ') like ${`% | ${qNorm} | %`}`;
      const namePrefix = sql`(' | ' || ${clubSearchDocument.names}) like ${`% | ${qNorm}%`}`;
      const wordSim = sql`word_similarity(${qNorm}, ${clubSearchDocument.names})`;
      conditions.push(
        sql`(${docMatch} or ${acrMatch} or ${wordSim} >= 0.45 or ${clubSearchDocument.names} like ${`%${qNorm}%`})`,
      );
      score = sql`(
        (case when ${acrMatch} then 10 else 0 end)
        + (case when ${exactName} then 8 else 0 end)
        + (case when ${namePrefix} then 3 else 0 end)
        + coalesce(ts_rank_cd(${clubSearchDocument.document}, ${tsq}), 0) * 2
        + ${wordSim} * 2
      )`;
    }

    const nextDeadline = sql`(select min(rc.deadline_at) from ${recruitingCycle} rc
      where rc.club_id = ${club.id} and rc.deadline_at > ${request.now.toISOString()}::timestamptz)`;

    const sort = request.sort === "relevance" && !text ? "name" : request.sort;
    const orderBy: SQL[] = (() => {
      switch (sort) {
        case "relevance":
          return [desc(score), asc(club.canonicalName)];
        case "deadline":
          return [sql`${nextDeadline} asc nulls last`, asc(club.canonicalName)];
        case "updated":
          return [sql`${club.lastObservedAt} desc nulls last`, asc(club.canonicalName)];
        case "completeness":
          return [desc(club.completeness), asc(club.canonicalName)];
        case "name":
          return [sql`lower(${club.canonicalName}) asc`];
      }
    })();

    const where = and(...conditions);
    const rows = await this.db
      .select({ id: club.id, total: sql<number>`count(*) over ()`.mapWith(Number) })
      .from(club)
      .leftJoin(clubSearchDocument, eq(clubSearchDocument.clubId, club.id))
      .where(where)
      .orderBy(...orderBy, asc(club.id))
      .limit(request.limit)
      .offset(request.offset);

    if (rows.length === 0 && request.offset > 0) {
      const [countRow] = await this.db
        .select({ total: sql<number>`count(*)`.mapWith(Number) })
        .from(club)
        .leftJoin(clubSearchDocument, eq(clubSearchDocument.clubId, club.id))
        .where(where);
      return { ids: [], total: countRow?.total ?? 0 };
    }
    return { ids: rows.map((r) => r.id), total: rows[0]?.total ?? 0 };
  }
}
