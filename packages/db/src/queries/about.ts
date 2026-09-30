import { and, count, eq, isNotNull, max, ne, sql } from "drizzle-orm";
import type { Queryable } from "../client";
import { club, source } from "../schema";

/** Adapter name the site crawler records on club-website sources. */
const SITE_CRAWLER = "site-crawler";

export interface SourceGroup {
  adapter: string;
  publisher: string;
  sourceType: string;
  trustTier: number;
  pages: number;
  lastFetchedAt: string | null;
}

/**
 * Discovery sources for the public "where the data comes from" section: one row per
 * publisher (directories we index). Crawled club websites are summarized as a count.
 */
export async function getSourceSummary(db: Queryable): Promise<{
  directories: SourceGroup[];
  clubSitePages: number;
  clubsWithOwnSite: number;
}> {
  const rows = await db
    .select({
      adapter: sql<string>`min(${source.adapter})`,
      publisher: sql<string>`coalesce(${source.publisher}, ${source.adapter})`,
      sourceType: sql<string>`min(${source.sourceType})`,
      trustTier: sql<number>`min(${source.trustTier})`.mapWith(Number),
      pages: count().mapWith(Number),
      lastFetchedAt: max(source.lastFetchedAt),
    })
    .from(source)
    .where(and(isNotNull(source.adapter), ne(source.adapter, SITE_CRAWLER), eq(source.isFixture, false)))
    .groupBy(sql`coalesce(${source.publisher}, ${source.adapter})`)
    .orderBy(sql`min(${source.trustTier})`, sql`coalesce(${source.publisher}, ${source.adapter})`);
  const [site] = await db
    .select({
      pages: count().mapWith(Number),
      clubs: sql<number>`count(distinct ${source.ownerClubId})`.mapWith(Number),
    })
    .from(source)
    .innerJoin(club, eq(club.id, source.ownerClubId))
    .where(and(eq(source.isFixture, false), eq(club.recordState, "active")));
  return {
    directories: rows.map((r) => ({ ...r, lastFetchedAt: r.lastFetchedAt?.toISOString() ?? null })),
    clubSitePages: site?.pages ?? 0,
    clubsWithOwnSite: site?.clubs ?? 0,
  };
}

/** Latest fetch time across all real sources (for "data last refreshed"). */
export async function getLastRefresh(db: Queryable): Promise<string | null> {
  const [r] = await db
    .select({ at: max(source.lastFetchedAt) })
    .from(source)
    .where(eq(source.isFixture, false));
  return r?.at?.toISOString() ?? null;
}
