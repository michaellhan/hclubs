import { eq, inArray, sql } from "drizzle-orm";
import {
  RecruitingSeasonsValue,
  compareTermKeys,
  normalizeName,
  type DateValue,
  type RecruitingSeason,
} from "@hci/core";
import type { Queryable } from "../client";
import type { IndexClub, StaticIndex } from "../local/types";
import { announcedLaterRound, roundEvidenced, type PastRound } from "../local/cycles";
import { paceWords, wordSet } from "../local/words";
import { club, clubAlias, clubSearchDocument, recruitingCycle, recruitingStage } from "../schema";
import { getCategories, getClubSummaries, toCycleSummary } from "./clubs";

/**
 * Build the static site's data file from projections (never from claims). `now` only
 * seeds the build-time cycle statuses; the browser recomputes them.
 */
export async function getStaticIndex(db: Queryable, now: Date): Promise<StaticIndex> {
  const ids = (await db.select({ id: club.id }).from(club).where(eq(club.recordState, "active"))).map((r) => r.id);
  const [summaries, categories, docs, cycleRows, seasonRows, aliasRows, stageRows] = await Promise.all([
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
            longDescription: club.longDescription,
          })
          .from(club)
          .where(inArray(club.id, ids))
      : [],
    ids.length
      ? db
          .select({ clubId: clubAlias.clubId, alias: clubAlias.alias, kind: clubAlias.kind })
          .from(clubAlias)
          .where(inArray(clubAlias.clubId, ids))
      : [],
    // Stage labels and dates: an undated round a stage names by its term ("Spring 2026 Comp").
    ids.length
      ? db
          .select({
            cycleId: recruitingStage.cycleId,
            kind: recruitingStage.kind,
            label: recruitingStage.label,
            startsValue: recruitingStage.startsValue,
            endsValue: recruitingStage.endsValue,
          })
          .from(recruitingStage)
          .innerJoin(recruitingCycle, eq(recruitingCycle.id, recruitingStage.cycleId))
          .where(inArray(recruitingCycle.clubId, ids))
      : [],
  ]);
  // Written-out alternate names only: acronyms already ship as searchAcronyms.
  const aliasesBy = new Map<string, string[]>();
  for (const a of aliasRows) {
    if (a.kind === "acronym" || a.kind === "abbreviation") continue;
    const list = aliasesBy.get(a.clubId) ?? [];
    if (!list.includes(a.alias)) list.push(a.alias);
    aliasesBy.set(a.clubId, list);
  }
  const seasonsBy = new Map(seasonRows.map((r) => [r.clubId, recruitingSeasonsOf(r.stored)]));
  const textBy = new Map(
    seasonRows.map((r) => [
      r.clubId,
      { tags: multiValues(r.tags), activities: multiValues(r.activities), long: r.longDescription },
    ]),
  );
  const docBy = new Map(docs.map((d) => [d.clubId, d]));
  const parentOf = new Map(categories.map((c) => [c.slug, c.parentSlug]));
  const stagesBy = new Map<
    string,
    { kind: string; label: string | null; startsAt: DateValue | null; endsAt: DateValue | null }[]
  >();
  for (const s of stageRows) {
    const list = stagesBy.get(s.cycleId) ?? [];
    list.push({
      kind: s.kind,
      label: s.label,
      startsAt: (s.startsValue as DateValue | null) ?? null,
      endsAt: (s.endsValue as DateValue | null) ?? null,
    });
    stagesBy.set(s.cycleId, list);
  }
  const cyclesBy = new Map<string, IndexClub["cycles"]>();
  const lastRoundBy = new Map<string, PastRound>();
  for (const row of cycleRows) {
    // A bare cycle row with no date or stated status isn't recruiting information, unless the
    // club's own pages announce it for a later term ("next audition cycle will begin in the
    // Fall of 2027"): that outranks its usual-season pattern (`announcedLaterRound`).
    const summary = toCycleSummary(row, now);
    if (!row.deadlineValue && !row.opensValue && !row.statedStatus && !announcedLaterRound([summary], now)) {
      // An undated round a stage names by its term ("Spring 2026 Comp") still says when the
      // club last recruited: kept as `lastRound` (the newest one), never as a cycle.
      const round = { ...summary, stages: stagesBy.get(row.id) ?? [] };
      const prev = lastRoundBy.get(row.clubId);
      if (roundEvidenced(round) && (!prev || compareTermKeys(row.termKey, prev.termKey) > 0))
        lastRoundBy.set(row.clubId, { termKey: row.termKey, processTypes: summary.processTypes });
      continue;
    }
    const list = cyclesBy.get(row.clubId) ?? [];
    list.push(summary);
    cyclesBy.set(row.clubId, list);
  }

  const clubs: IndexClub[] = summaries.map(
    ({ activityReasons: _r, activityConfidence: _c, lastVerifiedAt: _v, sourceCount: _n, ...s }) => {
      const doc = docBy.get(s.id);
      const lastRound = lastRoundBy.get(s.id);
      const slugs = new Set<string>();
      for (const c of s.categories) {
        for (let slug: string | null | undefined = c.slug; slug; slug = parentOf.get(slug)) slugs.add(slug);
      }
      const aliases = (aliasesBy.get(s.id) ?? []).filter((a) => normalizeName(a) !== normalizeName(s.name));
      // Rows show the specific categories: "Consulting", not also "Business & Pre-professional".
      // The broad one stays searchable through categorySlugs and searchTopics.
      const listed = new Set(s.categories.map((c) => c.slug));
      const broad = s.categories.filter((c) => [...listed].some((o) => parentOf.get(o) === c.slug));
      const text = textBy.get(s.id);
      const pace = paceWords([s.shortDescription ?? "", text?.long ?? "", ...(text?.activities ?? [])]);
      return {
        ...s,
        categories: s.categories.filter((c) => !broad.includes(c)),
        ...(aliases.length ? { aliases } : {}),
        cycles: cyclesBy.get(s.id) ?? [],
        ...(lastRound ? { lastRound } : {}),
        searchNames: doc?.names ?? normalizeName(s.name),
        searchAcronyms: doc?.acronyms ?? [],
        searchTopics: wordSet([
          ...broad.map((c) => c.name),
          ...(textBy.get(s.id)?.tags ?? []).filter((t) => !SOCO_FLAGS.has(t.toLowerCase())),
          ...(textBy.get(s.id)?.activities ?? []),
        ]),
        categorySlugs: [...slugs],
        recruitingSeasons: seasonsBy.get(s.id) ?? [],
        ...(pace.length ? { pace } : {}),
      };
    },
  );
  // A stable order (not the database's row order), so builds diff cleanly.
  clubs.sort((a, b) => a.slug.localeCompare(b.slug));
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
