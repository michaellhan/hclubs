"use client";

import Link from "next/link";
import { RECRUITING_SEASON_LABEL, nextStepText, type DateValue } from "@hci/core/browser";
import {
  ClubFilters,
  buildBoardSections,
  matchesFirstYears,
  recruitingSeasonForDate,
  searchLocal,
  type IndexClub,
} from "@hci/db/local";
import { formatDay } from "@/lib/format";
import { useIndex } from "@/lib/use-index";
import { useNow } from "@/lib/use-now";
import { ClubRow } from "./club-row";
import { EmptyState } from "./ui";

/**
 * "Recruiting now" (home page, category pages): computed in the browser so it's right on
 * the day you visit. With `category`, only that category; with `quiet`, nothing at all
 * when no club is recruiting.
 */
export function RecruitingNow({
  limit = 6,
  category,
  quiet = false,
  heading,
}: {
  limit?: number;
  category?: string;
  quiet?: boolean;
  /** Shown above the list, and only when there is a list (for `quiet` sections). */
  heading?: React.ReactNode;
}) {
  const { data, error } = useIndex();
  const now = useNow();
  if (error)
    return quiet ? null : <EmptyState title="Couldn't load recruiting data">Try reloading the page.</EmptyState>;
  if (!data || !now) return quiet ? null : <ListSkeleton rows={3} />;
  const filters = ClubFilters.parse({ recruitingNow: true, ...(category ? { categories: [category] } : {}) });
  const { clubs } = searchLocal(data.clubs, { text: null, filters, sort: "deadline", offset: 0, limit, now });
  if (quiet && clubs.length === 0) return null;
  return clubs.length > 0 ? (
    <section>
      {heading}
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {clubs.map((c) => (
          <ClubRow key={c.id} club={c} />
        ))}
      </ul>
    </section>
  ) : (
    <OffSeason clubs={data.clubs} now={now} category={category} />
  );
}

/** `flush`: the directory's borderless list (rules only) instead of a bordered card. */
export function ListSkeleton({ rows = 6, flush = false }: { rows?: number; flush?: boolean }) {
  return (
    <ul
      aria-busy="true"
      aria-label="Loading"
      className={
        flush
          ? "-mx-3 divide-y divide-stone-100 border-y border-stone-100 sm:-mx-4 dark:divide-stone-800 dark:border-stone-800"
          : "divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800"
      }
    >
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex gap-3 px-4 py-3">
          <div className="size-10 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 w-1/3 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-stone-100 dark:bg-stone-800" />
          </div>
        </li>
      ))}
    </ul>
  );
}

const OFF_SEASON_SHOWN = 3;

/** One compact off-season group: a label, up to three clubs with a short line each, and "see all". */
function OffSeasonGroup({
  title,
  href,
  total,
  rows,
}: {
  title: string;
  href: string;
  total: number;
  rows: { id: string; slug: string; name: string; line: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="px-3 py-2.5 sm:px-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold text-stone-500 dark:text-stone-400">{title}</h3>
        <Link href={href} className="hc-link-muted shrink-0 text-xs">
          {total > rows.length ? `See all ${total}` : "See on the board"}
        </Link>
      </div>
      <ul className="mt-1 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex min-w-0 flex-col text-sm sm:flex-row sm:items-baseline sm:gap-2">
            <Link href={`/clubs/${r.slug}`} className="truncate font-medium hover:underline">
              {r.name}
            </Link>
            <span className="truncate text-xs text-stone-500 dark:text-stone-400">{r.line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Between recruiting rounds the box still says what a student can do today: rounds that
 * started with no deadline listed, clubs anyone can join, and rounds that just closed (with
 * the club's usual next term when its own past recruiting says so; a pattern, never a date).
 * The empty message shows only when all three are empty.
 */
function OffSeason({
  clubs,
  now,
  category,
}: {
  clubs: readonly IndexClub[];
  now: Date;
  category?: string | undefined;
}) {
  const q = { now, ...(category ? { category } : {}) };
  const { board, started, anytime } = buildBoardSections(clubs, q);
  const closed = board.recentlyClosed;
  const season = recruitingSeasonForDate(now);
  const fmt = (d: DateValue) => formatDay(d, now) ?? "";
  const upcoming = board.upcoming.length;
  if (!started.length && !anytime.length && !closed.length)
    return (
      <EmptyState title="No open applications we know of right now">
        Deadlines appear here as soon as a club&apos;s page states one.{" "}
        {upcoming ? (
          <Link href="/recruiting" className="underline underline-offset-2">
            See {upcoming} opening soon on the recruiting board
          </Link>
        ) : null}
      </EmptyState>
    );
  const seasonsOf = (id: string) => clubs.find((c) => c.id === id)?.recruitingSeasons ?? [];
  return (
    <div className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
      <p className="px-3 py-2.5 text-sm text-stone-600 sm:px-4 dark:text-stone-400">
        No deadlines ahead that we know of{upcoming ? ` (${upcoming} opening soon)` : ""}. Here&apos;s what you can
        still do.
      </p>
      <OffSeasonGroup
        title="Started, no deadline listed"
        href="/recruiting#started"
        total={started.length}
        rows={started.slice(0, OFF_SEASON_SHOWN).map((e) => ({
          id: e.cycle.id,
          slug: e.club.slug,
          name: e.club.name,
          line: nextStepText(e.cycle, e.club.joinModes, fmt).replace(" · no deadline listed", ""),
        }))}
      />
      <OffSeasonGroup
        title="Join anytime"
        href={`/clubs?open=1${category ? `&category=${category}` : ""}`}
        total={anytime.length}
        rows={anytime.slice(0, OFF_SEASON_SHOWN).map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          line: matchesFirstYears(c) ? "Open membership · first-years welcome" : "Open membership",
        }))}
      />
      <OffSeasonGroup
        title="Just closed"
        href="/recruiting#closed"
        total={closed.length}
        rows={closed.slice(0, OFF_SEASON_SHOWN).map((e) => {
          const seasons = seasonsOf(e.club.id);
          const again = seasons.filter((s) => s === "fall" || s === "spring").filter((s) => s !== season);
          return {
            id: e.cycle.id,
            slug: e.club.slug,
            name: e.club.name,
            line: [
              nextStepText(e.cycle, e.club.joinModes, fmt),
              seasons.includes("rolling")
                ? "also recruits on a rolling basis"
                : again.length
                  ? `usually also ${again.map((s) => RECRUITING_SEASON_LABEL[s]).join(", ")}`
                  : null,
            ]
              .filter(Boolean)
              .join(" · "),
          };
        })}
      />
    </div>
  );
}
