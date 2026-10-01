"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CLASS_YEAR_LABEL,
  dateValueEnd,
  JOIN_MODES,
  JOIN_MODE_LABEL,
  RECRUITING_SEASON_LABEL,
  formatTerm,
  type ClassYear,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core/browser";
import {
  ClubFilters,
  buildRecruitingBoard,
  buildStartedNoDeadline,
  buildUsuallyRecruiting,
  isSparseClub,
  matchesFirstYears,
  matchesOpenJoin,
  passesFilters,
  recruitingSeasonForDate,
  type CategoryWithCount,
  type IndexClub,
  type RecruitingEntry,
} from "@hci/db/local";
import { formatDay, relativeDateValue } from "@/lib/format";
import { useIndex } from "@/lib/use-index";
import { useNow } from "@/lib/use-now";
import { CycleStatusPill, JoinModePills } from "./club-bits";
import { ListSkeleton } from "./recruiting-now";
import { ClubLogo } from "./club-logo";
import { DemoPill, EmptyState, Pill, SectionHeading } from "./ui";

const first = (v: string | null) => v ?? undefined;
const WINDOWS = [
  ["", "Any time"],
  ["7", "Next 7 days"],
  ["14", "Next 2 weeks"],
  ["30", "Next 30 days"],
] as const;
const CLASS_OPTIONS: ClassYear[] = ["first_year", "sophomore", "junior", "senior"];
const JOIN_OPTIONS: JoinMode[] = ["application", "comp", "audition", "tryout"];

function Row({ entry, now }: { entry: RecruitingEntry; now: Date }) {
  const { club, cycle } = entry;
  return (
    <li className="relative flex gap-3 px-3 py-3 hover:bg-stone-50 sm:px-4 dark:hover:bg-stone-900/60">
      <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={`/clubs/${club.slug}`} className="font-semibold after:absolute after:inset-0 hover:underline">
            {club.name}
          </Link>
          {club.acronym ? <span className="text-sm text-stone-500">{club.acronym}</span> : null}
          {club.isFixture ? <DemoPill /> : null}
        </div>
        <div className="relative mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          {cycle.status === "unknown" ? (
            <Pill tone="muted" title="An opening date is on record, but no deadline">
              Opened {formatDay(cycle.opens, now)} · no deadline listed
            </Pill>
          ) : (
            <CycleStatusPill cycle={cycle} />
          )}
          <JoinModePills modes={cycle.processTypes.length ? cycle.processTypes : club.joinModes} />
          {cycle.eligibleClasses?.length ? (
            <span className="text-stone-500">
              Open to {cycle.eligibleClasses.map((c) => CLASS_YEAR_LABEL[c as ClassYear]).join(", ")}
            </span>
          ) : matchesFirstYears(club) ? (
            <span className="text-stone-500">Takes first-years</span>
          ) : null}
          {club.categories[0] ? <span className="text-stone-500">{club.categories[0].name}</span> : null}
        </div>
      </div>
      <div className="hidden shrink-0 text-right text-xs sm:block">
        {cycle.deadline ? (
          <>
            <div className="tabular font-medium">{formatDay(cycle.deadline, now)}</div>
            <div className="text-stone-500">{relativeDateValue(cycle.deadline, now)}</div>
          </>
        ) : cycle.opens ? (
          <>
            <div className="tabular font-medium">
              {cycle.status === "upcoming" ? "Opens" : "Opened"} {formatDay(cycle.opens, now)}
            </div>
            <div className="text-stone-500">{formatTerm(cycle.termKey)}</div>
          </>
        ) : (
          <div className="text-stone-500">{formatTerm(cycle.termKey)}</div>
        )}
        {cycle.applicationUrl && !club.isFixture && (cycle.status === "open" || cycle.status === "deadline_ahead") ? (
          <a
            href={cycle.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="relative underline decoration-stone-300 underline-offset-2"
          >
            Apply
          </a>
        ) : null}
      </div>
    </li>
  );
}

function Group({
  title,
  entries,
  now,
  empty,
  note,
}: {
  title: string;
  entries: RecruitingEntry[];
  now: Date;
  empty: string;
  note?: string;
}) {
  return (
    <section>
      <SectionHeading aside={<span className="tabular text-xs text-stone-500">{entries.length}</span>}>
        {title}
      </SectionHeading>
      {note ? <p className="-mt-1 mb-3 max-w-2xl text-xs text-stone-500 dark:text-stone-400">{note}</p> : null}
      {entries.length ? (
        <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
          {entries.map((e) => (
            <Row key={e.cycle.id} entry={e} now={now} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone-500">{empty}</p>
      )}
    </section>
  );
}

const USUALLY_SHOWN = 30;

/** Clubs that usually recruit this season — a pattern, with no dated cycle on record. */
function UsuallyRecruiting({ clubs, season }: { clubs: IndexClub[]; season: RecruitingSeason }) {
  if (clubs.length === 0) return null;
  const shown = clubs.slice(0, USUALLY_SHOWN);
  return (
    <section>
      <SectionHeading aside={<span className="tabular text-xs text-stone-500">{clubs.length}</span>}>
        Usually recruits this term
      </SectionHeading>
      <p className="mb-3 max-w-2xl text-xs text-stone-500 dark:text-stone-400">
        These clubs have recruited in the {RECRUITING_SEASON_LABEL[season].toLowerCase()} before, but we have no current
        date for them. This is a pattern from past recruiting, not a deadline — check the club&apos;s own page or
        channels.
      </p>
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {shown.map((club) => (
          <li
            key={club.id}
            className="relative flex gap-3 px-3 py-2.5 hover:bg-stone-50 sm:px-4 dark:hover:bg-stone-900/60"
          >
            <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/clubs/${club.slug}`}
                  className="font-semibold after:absolute after:inset-0 hover:underline"
                >
                  {club.name}
                </Link>
                {club.acronym ? <span className="text-sm text-stone-500">{club.acronym}</span> : null}
                {club.isFixture ? <DemoPill /> : null}
              </div>
              <div className="relative mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                <Pill tone="muted" title="Pattern from past recruiting — not a current deadline">
                  Usually {club.recruitingSeasons.map((s) => RECRUITING_SEASON_LABEL[s]).join(", ")}
                </Pill>
                <JoinModePills modes={club.joinModes} />
                {club.categories[0] ? <span className="text-stone-500">{club.categories[0].name}</span> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {clubs.length > shown.length ? (
        <p className="mt-2 text-xs text-stone-500">
          Showing {shown.length} of {clubs.length}.{" "}
          <Link href={`/clubs?season=${season}`} className="underline">
            See all in the directory
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/** Recruiting board, computed in the browser so open/closed is right on the day you visit. */
export function RecruitingBoardView({ categories }: { categories: CategoryWithCount[] }) {
  const sp = useSearchParams();
  const router = useRouter();
  const { data, error } = useIndex();
  const liveNow = useNow();
  const category = first(sp.get("category"))?.match(/^[a-z0-9-]+$/)?.[0] ?? null;
  const joinRaw = first(sp.get("join")) ?? "";
  const join = (JOIN_MODES as readonly string[]).includes(joinRaw) ? (joinRaw as JoinMode) : null;
  const classRaw = first(sp.get("class")) ?? "";
  const classYear = (CLASS_OPTIONS as string[]).includes(classRaw) ? (classRaw as ClassYear) : null;
  const within = Number(first(sp.get("within"))) || null;
  const board =
    data && liveNow
      ? buildRecruitingBoard(data.clubs, {
          now: liveNow,
          category,
          joinMode: join,
          classYear: classYear === "graduate" ? null : classYear,
          // Graduate-school groups only when a graduate student asks for them (ADR 0038).
          includeGraduate: classYear === "graduate",
          withinDays: within,
        })
      : null;
  const usually =
    data && liveNow
      ? buildUsuallyRecruiting(data.clubs, {
          now: liveNow,
          category,
          joinMode: join,
          classYear: classYear === "graduate" ? null : classYear,
          // Graduate-school groups only when a graduate student asks for them (ADR 0038).
          includeGraduate: classYear === "graduate",
        })
      : [];
  const started =
    data && liveNow
      ? buildStartedNoDeadline(data.clubs, {
          now: liveNow,
          category,
          joinMode: join,
          classYear: classYear === "graduate" ? null : classYear,
          // Graduate-school groups only when a graduate student asks for them (ADR 0038).
          includeGraduate: classYear === "graduate",
        })
      : [];
  const openToAll =
    data && !join
      ? data.clubs.filter(
          (c) =>
            matchesOpenJoin(c) &&
            !isSparseClub(c) &&
            passesFilters(
              c,
              ClubFilters.parse({
                ...(category ? { categories: [category] } : {}),
                ...(classYear === "first_year" ? { freshmenEligible: true } : {}),
              }),
            ),
        ).length
      : 0;
  const openHref = `/clubs?open=1${category ? `&category=${category}` : ""}${classYear === "first_year" ? "&freshmen=1" : ""}`;
  const season = liveNow ? recruitingSeasonForDate(liveNow) : null;
  // The week ahead first: the deadlines a student can still act on today.
  const soonCutoff = (liveNow ?? new Date()).getTime() + 7 * 86_400_000;
  const dueSoon = board
    ? board.open.filter((e) => e.cycle.deadline && dateValueEnd(e.cycle.deadline).getTime() <= soonCutoff)
    : [];
  const dueLater = board ? board.open.filter((e) => !dueSoon.includes(e)) : [];
  const now = liveNow ?? new Date();
  const hrefWith = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string | null> = {
      category,
      join,
      class: classYear,
      within: within ? String(within) : null,
      ...patch,
    };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    return p.size ? `/recruiting?${p}` : "/recruiting";
  };
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm sm:px-2.5 sm:py-1 sm:text-xs ${active ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900" : "border-stone-200 text-stone-600 hover:border-stone-400 dark:border-stone-800 dark:text-stone-400"}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recruiting</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-500">
          Applications, comps, auditions and tryouts with a known date. Always confirm on the club&apos;s own page
          before a deadline.
        </p>
        {openToAll > 0 ? (
          <p className="mt-2 text-sm">
            <Link href={openHref} className="font-medium text-accent underline-offset-2 hover:underline">
              {openToAll} clubs need no comp
            </Link>
            <span className="text-stone-500">
              {" "}
              — they say anyone can join, or the College directory lists no comping requirement (some may still ask for
              an application).
            </span>
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {WINDOWS.map(([v, label]) => (
            <Link key={label} href={hrefWith({ within: v || null })} className={chip(String(within ?? "") === v)}>
              {label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link href={hrefWith({ join: null })} className={chip(!join)}>
            Any process
          </Link>
          {JOIN_OPTIONS.map((j) => (
            <Link key={j} href={hrefWith({ join: j })} className={chip(join === j)}>
              {JOIN_MODE_LABEL[j]}
            </Link>
          ))}
          <span className="mx-1 hidden w-px bg-stone-200 sm:block dark:bg-stone-800" />
          <span className="basis-full sm:hidden" />
          <Link href={hrefWith({ class: null })} className={chip(!classYear)}>
            Any class
          </Link>
          {CLASS_OPTIONS.map((c) => (
            <Link key={c} href={hrefWith({ class: c })} className={chip(classYear === c)}>
              {CLASS_YEAR_LABEL[c]}
            </Link>
          ))}
        </div>
        <label className="flex items-center gap-2 pt-1 text-sm sm:text-xs">
          <span className="text-stone-500 dark:text-stone-400">Category</span>
          <select
            value={category ?? ""}
            onChange={(e) => router.replace(hrefWith({ category: e.target.value || null }), { scroll: false })}
            className="h-10 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 text-base sm:h-8 sm:flex-none sm:text-xs dark:border-stone-700 dark:bg-stone-900"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.parentSlug ? "— " : ""}
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <EmptyState title="Couldn't load recruiting data">Try reloading the page.</EmptyState>
      ) : !board ? (
        <ListSkeleton rows={4} />
      ) : board.open.length + board.upcoming.length + board.recentlyClosed.length + started.length === 0 ? (
        <>
          <EmptyState title="No recruiting dates match">
            Clubs appear here once we find a dated application, comp, audition or tryout on an official page.
          </EmptyState>
          {season ? <UsuallyRecruiting clubs={usually} season={season} /> : null}
        </>
      ) : (
        <>
          {dueSoon.length ? <Group title="Due in the next 7 days" entries={dueSoon} now={now} empty="" /> : null}
          <Group
            title={dueSoon.length ? "Open now, due later" : "Open now / deadline ahead"}
            entries={dueLater}
            now={now}
            empty={dueSoon.length ? "Nothing else open that matches." : "Nothing open that matches."}
          />
          <Group title="Opening soon" entries={board.upcoming} now={now} empty="No announced openings." />
          {started.length ? (
            <Group
              title="Started this term, no deadline listed"
              entries={started}
              now={now}
              empty=""
              note="These opened recently, but we haven't found a deadline. They may already be closed — check the club's page."
            />
          ) : null}
          <Group
            title="Recently closed (last 30 days)"
            entries={board.recentlyClosed}
            now={now}
            empty="Nothing closed recently."
          />
          {season ? <UsuallyRecruiting clubs={usually} season={season} /> : null}
        </>
      )}
    </div>
  );
}
