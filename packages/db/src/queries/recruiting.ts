import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { computeCycleStatus, type CycleStatus, type DateValue, type JoinMode } from "@hci/core";
import type { Queryable } from "../client";
import { category, club, clubCategory, recruitingCycle } from "../schema";
import { getClubSummaries } from "./clubs";
import type { CycleSummary, ListedClub } from "./types";

/**
 * Current recruiting model (M2 §17). Cycle status is computed at read time; "recently
 * closed" covers the last 30 days. Only cycles with at least one date or an explicit
 * stated status are recruiting information — a bare cycle row is not.
 */
export interface RecruitingEntry {
  club: ListedClub;
  cycle: CycleSummary;
}

export interface RecruitingQuery {
  now: Date;
  categories?: string[];
  joinModes?: JoinMode[];
  classYear?: "first_year" | "sophomore" | "junior" | "senior" | null;
  /** Only deadlines within N days from now (open/deadline-ahead groups). */
  withinDays?: number | null;
  includeFixtures?: boolean;
}

export interface RecruitingBoard {
  open: RecruitingEntry[];
  upcoming: RecruitingEntry[];
  recentlyClosed: RecruitingEntry[];
}

const DAY = 86_400_000;

export async function getRecruitingBoard(db: Queryable, q: RecruitingQuery): Promise<RecruitingBoard> {
  const conds: SQL[] = [
    eq(club.recordState, "active"),
    sql`(${recruitingCycle.deadlineAt} is not null or ${recruitingCycle.opensAt} is not null or ${recruitingCycle.statedStatus} is not null)`,
    // Nothing older than 30 days past its deadline, nothing without any recent date.
    sql`(${recruitingCycle.deadlineAt} is null or ${recruitingCycle.deadlineAt} > ${new Date(q.now.getTime() - 30 * DAY).toISOString()}::timestamptz)`,
  ];
  if (!q.includeFixtures) {
    // Fixtures are still shown in dev when present; callers opt out explicitly in production.
  }
  if (q.categories?.length) {
    const parents = db.select({ id: category.id }).from(category).where(inArray(category.slug, q.categories));
    const ids = db
      .select({ clubId: clubCategory.clubId })
      .from(clubCategory)
      .innerJoin(category, eq(category.id, clubCategory.categoryId))
      .where(or(inArray(category.slug, q.categories), inArray(category.parentId, parents)));
    conds.push(inArray(club.id, ids));
  }
  if (q.joinModes?.length) {
    conds.push(
      sql`(${club.joinModes} && ${sql.param(q.joinModes)}::text[] or ${recruitingCycle.processTypes} && ${sql.param(q.joinModes)}::text[])`,
    );
  }
  if (q.classYear) {
    conds.push(
      q.classYear === "first_year"
        ? sql`(${club.freshmenEligible} = true or 'first_year' = any(${club.eligibleClasses}) or 'first_year' = any(${recruitingCycle.eligibleClasses}))`
        : sql`(${q.classYear} = any(${club.eligibleClasses}) or ${q.classYear} = any(${recruitingCycle.eligibleClasses}))`,
    );
  }
  const rows = await db
    .select({ cycle: recruitingCycle, clubId: club.id })
    .from(recruitingCycle)
    .innerJoin(club, eq(club.id, recruitingCycle.clubId))
    .where(and(...conds, ...(q.includeFixtures === false ? [ne(club.dataOrigin, "fixture")] : [])));

  const summaries = new Map(
    (await getClubSummaries(db, [...new Set(rows.map((r) => r.clubId))], q.now)).map((s) => [s.id, s]),
  );
  const board: RecruitingBoard = { open: [], upcoming: [], recentlyClosed: [] };
  for (const { cycle: row, clubId } of rows) {
    const summary = summaries.get(clubId);
    if (!summary) continue;
    const opens = (row.opensValue as DateValue | null) ?? null;
    const deadline = (row.deadlineValue as DateValue | null) ?? null;
    const statedStatus = row.statedStatus === "open" || row.statedStatus === "closed" ? row.statedStatus : null;
    const status: CycleStatus = computeCycleStatus(
      { opensAt: opens, deadline, statedStatus, termKey: row.termKey },
      q.now,
    );
    const cycle: CycleSummary = {
      id: row.id,
      termKey: row.termKey,
      track: row.track,
      status,
      statedStatus,
      opens,
      deadline,
      processTypes: row.processTypes as JoinMode[],
      applicationUrl: row.applicationUrl,
      eligibleClasses: row.eligibleClasses,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    };
    const entry = { club: summary, cycle };
    const due = row.deadlineAt?.getTime() ?? null;
    if (status === "open" || status === "deadline_ahead") {
      if (q.withinDays && (due === null || due - q.now.getTime() > q.withinDays * DAY)) continue;
      board.open.push(entry);
    } else if (status === "upcoming") board.upcoming.push(entry);
    else if (status === "closed") board.recentlyClosed.push(entry);
  }
  const byDeadline = (a: RecruitingEntry, b: RecruitingEntry) =>
    (a.cycle.deadline?.at ?? "9999").localeCompare(b.cycle.deadline?.at ?? "9999");
  board.open.sort(byDeadline);
  board.upcoming.sort((a, b) => (a.cycle.opens?.at ?? "9999").localeCompare(b.cycle.opens?.at ?? "9999"));
  board.recentlyClosed.sort((a, b) => byDeadline(b, a));
  return board;
}
