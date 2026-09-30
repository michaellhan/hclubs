import { eq, inArray, sql } from "drizzle-orm";
import { RecruitingSeasonsValue, normalizeName, type RecruitingSeason } from "@hci/core";
import type { Queryable } from "../client";
import type { IndexClub, StaticIndex } from "../local/types";
import { club, clubSearchDocument, recruitingCycle } from "../schema";
import { getCategories, getClubSummaries, toCycleSummary } from "./clubs";

/**
 * Build the static site's data file from projections (never from claims). `now` only
 * seeds the build-time cycle statuses; the browser recomputes them.
 */
export async function getStaticIndex(db: Queryable, now: Date): Promise<StaticIndex> {
  const ids = (await db.select({ id: club.id }).from(club).where(eq(club.recordState, "active"))).map((r) => r.id);
  const [summaries, categories, docs, cycleRows, seasonRows] = await Promise.all([
    getClubSummaries(db, ids, now),
    getCategories(db),
    ids.length
      ? db
          .select({
            clubId: clubSearchDocument.clubId,
            names: clubSearchDocument.names,
            acronyms: clubSearchDocument.acronyms,
          })
          .from(clubSearchDocument)
          .where(inArray(clubSearchDocument.clubId, ids))
      : [],
    ids.length ? db.select().from(recruitingCycle).where(inArray(recruitingCycle.clubId, ids)) : [],
    // Only the resolved recruiting pattern, not the whole provenance payload.
    ids.length
      ? db
          .select({ clubId: club.id, stored: sql<unknown>`${club.fields} -> 'club.recruiting_seasons'` })
          .from(club)
          .where(inArray(club.id, ids))
      : [],
  ]);
  const seasonsBy = new Map(seasonRows.map((r) => [r.clubId, recruitingSeasonsOf(r.stored)]));
  const docBy = new Map(docs.map((d) => [d.clubId, d]));
  const parentOf = new Map(categories.map((c) => [c.slug, c.parentSlug]));
  const cyclesBy = new Map<string, IndexClub["cycles"]>();
  for (const row of cycleRows) {
    // A bare cycle row with no date or stated status isn't recruiting information.
    if (!row.deadlineValue && !row.opensValue && !row.statedStatus) continue;
    const list = cyclesBy.get(row.clubId) ?? [];
    list.push(toCycleSummary(row, now));
    cyclesBy.set(row.clubId, list);
  }

  const clubs: IndexClub[] = summaries.map((s) => {
    const doc = docBy.get(s.id);
    const slugs = new Set<string>();
    for (const c of s.categories) {
      for (let slug: string | null | undefined = c.slug; slug; slug = parentOf.get(slug)) slugs.add(slug);
    }
    return {
      ...s,
      cycles: cyclesBy.get(s.id) ?? [],
      searchNames: doc?.names ?? normalizeName(s.name),
      searchAcronyms: doc?.acronyms ?? [],
      searchText: normalizeName([...s.categories.map((c) => c.name), s.shortDescription ?? ""].join(" ")),
      categorySlugs: [...slugs],
      recruitingSeasons: seasonsBy.get(s.id) ?? [],
    };
  });
  return { version: 1, generatedAt: now.toISOString(), categories, clubs };
}

/** The displayed value of a stored `club.recruiting_seasons` field; [] when absent/invalid. */
export function recruitingSeasonsOf(stored: unknown): RecruitingSeason[] {
  if (!stored || typeof stored !== "object" || !("kind" in stored) || stored.kind !== "single") return [];
  const current = "current" in stored ? (stored.current as { value?: unknown } | null) : null;
  const parsed = RecruitingSeasonsValue.safeParse(current?.value);
  return parsed.success ? parsed.data : [];
}
