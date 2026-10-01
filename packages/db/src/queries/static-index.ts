import { eq, inArray, sql } from "drizzle-orm";
import { RecruitingSeasonsValue, normalizeName, type RecruitingSeason } from "@hci/core";
import type { Queryable } from "../client";
import type { IndexClub, StaticIndex } from "../local/types";
import { wordSet } from "../local/words";
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
    // Only the resolved values needed here, not the whole provenance payload.
    ids.length
      ? db
          .select({
            clubId: club.id,
            stored: sql<unknown>`${club.fields} -> 'club.recruiting_seasons'`,
            tags: sql<unknown>`${club.fields} -> 'club.tag'`,
            activities: sql<unknown>`${club.fields} -> 'club.activity'`,
          })
          .from(club)
          .where(inArray(club.id, ids))
      : [],
  ]);
  const seasonsBy = new Map(seasonRows.map((r) => [r.clubId, recruitingSeasonsOf(r.stored)]));
  const textBy = new Map(
    seasonRows.map((r) => [r.clubId, { tags: multiValues(r.tags), activities: multiValues(r.activities) }]),
  );
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

  const clubs: IndexClub[] = summaries.map(
    ({ activityReasons: _r, activityConfidence: _c, lastVerifiedAt: _v, sourceCount: _n, ...s }) => {
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
        searchTopics: wordSet([
          ...(textBy.get(s.id)?.tags ?? []).filter((t) => !SOCO_FLAGS.has(t.toLowerCase())),
          ...(textBy.get(s.id)?.activities ?? []),
        ]),
        ...((textBy.get(s.id)?.tags ?? []).some((t) => /^no comping requirement$/i.test(t))
          ? { noComp: true as const }
          : {}),
        categorySlugs: [...slugs],
        recruitingSeasons: seasonsBy.get(s.id) ?? [],
      };
    },
  );
  return { version: 1, generatedAt: now.toISOString(), categories, clubs };
}

/** SOCO listing flags that are tags but say nothing about what a club does. */
const SOCO_FLAGS = new Set([
  "no comping requirement",
  "domestic travel",
  "international travel",
  "department sponsored student organization",
  "student club/group",
]);

/** The displayed values of a stored multi field (tags, activities); [] when absent. */
function multiValues(stored: unknown): string[] {
  if (!stored || typeof stored !== "object" || !("values" in stored) || !Array.isArray(stored.values)) return [];
  return stored.values.map((v: { value?: unknown }) => v.value).filter((v): v is string => typeof v === "string");
}

/** The displayed value of a stored `club.recruiting_seasons` field; [] when absent/invalid. */
export function recruitingSeasonsOf(stored: unknown): RecruitingSeason[] {
  if (!stored || typeof stored !== "object" || !("kind" in stored) || stored.kind !== "single") return [];
  const current = "current" in stored ? (stored.current as { value?: unknown } | null) : null;
  const parsed = RecruitingSeasonsValue.safeParse(current?.value);
  return parsed.success ? parsed.data : [];
}
