"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CLASS_YEAR_LABEL,
  JOIN_MODE_LABEL,
  JoinMode,
  RECRUITING_SEASON_LABEL,
  formatTerm,
  type ClassYear,
  type RecruitingSeason,
} from "@hci/core";
import {
  buildRecruitingBoard,
  buildUsuallyRecruiting,
  recruitingSeasonForDate,
  type CategoryWithCount,
  type IndexClub,
  type RecruitingEntry,
} from "@hci/db/local";
import { formatDateValue } from "@/lib/format";
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
    <li className="relative flex gap-3 px-3 py-3 hover:bg-zinc-50 sm:px-4 dark:hover:bg-zinc-900/60">
      <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={`/clubs/${club.slug}`} className="font-semibold after:absolute after:inset-0 hover:underline">
            {club.name}
          </Link>
          {club.acronym ? <span className="text-sm text-zinc-500">{club.acronym}</span> : null}
          {club.isFixture ? <DemoPill /> : null}
        </div>
        <div className="relative mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <CycleStatusPill cycle={cycle} />
          <JoinModePills modes={cycle.processTypes.length ? cycle.processTypes : club.joinModes} />
          {cycle.eligibleClasses?.length ? (
            <span className="text-zinc-500">
              Open to {cycle.eligibleClasses.map((c) => CLASS_YEAR_LABEL[c as ClassYear]).join(", ")}
            </span>
          ) : club.freshmenEligible ? (
            <span className="text-zinc-500">First-years eligible</span>
          ) : null}
          {club.categories[0] ? <span className="text-zinc-400">{club.categories[0].name}</span> : null}
        </div>
      </div>
      <div className="hidden shrink-0 text-right text-xs sm:block">
        <div className="tabular font-medium">{cycle.deadline ? formatDateValue(cycle.deadline, now) : "—"}</div>
        <div className="text-zinc-400">{formatTerm(cycle.termKey)}</div>
        {cycle.applicationUrl && !club.isFixture ? (
          <a
            href={cycle.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="relative underline decoration-zinc-300 underline-offset-2"
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
}: {
  title: string;
  entries: RecruitingEntry[];
  now: Date;
  empty: string;
}) {
  return (
    <section>
      <SectionHeading aside={<span className="tabular text-xs text-zinc-400">{entries.length}</span>}>
        {title}
      </SectionHeading>
      {entries.length ? (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {entries.map((e) => (
            <Row key={e.cycle.id} entry={e} now={now} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">{empty}</p>
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
      <SectionHeading aside={<span className="tabular text-xs text-zinc-400">{clubs.length}</span>}>
        Usually recruits this term
      </SectionHeading>
      <p className="mb-3 max-w-2xl text-xs text-zinc-500 dark:text-zinc-400">
        These clubs have recruited in the {RECRUITING_SEASON_LABEL[season].toLowerCase()} before, but we have no current
        date for them. This is a pattern from past recruiting, not a deadline — check the club&apos;s own page or
        channels.
      </p>
      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {shown.map((club) => (
          <li
            key={club.id}
            className="relative flex gap-3 px-3 py-2.5 hover:bg-zinc-50 sm:px-4 dark:hover:bg-zinc-900/60"
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
                {club.acronym ? <span className="text-sm text-zinc-500">{club.acronym}</span> : null}
                {club.isFixture ? <DemoPill /> : null}
              </div>
              <div className="relative mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                <Pill tone="muted" title="Pattern from past recruiting — not a current deadline">
                  Usually {club.recruitingSeasons.map((s) => RECRUITING_SEASON_LABEL[s]).join(", ")}
                </Pill>
                <JoinModePills modes={club.joinModes} />
                {club.categories[0] ? <span className="text-zinc-400">{club.categories[0].name}</span> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {clubs.length > shown.length ? (
        <p className="mt-2 text-xs text-zinc-500">
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
  const join = JoinMode.safeParse(first(sp.get("join"))).data ?? null;
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
        })
      : [];
  const season = liveNow ? recruitingSeasonForDate(liveNow) : null;
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
    `rounded-full border px-3 py-1.5 text-sm sm:px-2.5 sm:py-1 sm:text-xs ${active ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400"}`;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recruiting</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500">
          Applications, comps, auditions and tryouts with a known date. Always confirm on the club&apos;s own page
          before a deadline.
        </p>
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
          <span className="mx-1 hidden w-px bg-zinc-200 sm:block dark:bg-zinc-800" />
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
          <span className="text-zinc-500 dark:text-zinc-400">Category</span>
          <select
            value={category ?? ""}
            onChange={(e) => router.replace(hrefWith({ category: e.target.value || null }), { scroll: false })}
            className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-base sm:h-8 sm:flex-none sm:text-xs dark:border-zinc-700 dark:bg-zinc-900"
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
      ) : board.open.length + board.upcoming.length + board.recentlyClosed.length === 0 ? (
        <>
          <EmptyState title="No recruiting dates match">
            Clubs appear here once we find a dated application, comp, audition or tryout on an official page.
          </EmptyState>
          {season ? <UsuallyRecruiting clubs={usually} season={season} /> : null}
        </>
      ) : (
        <>
          <Group title="Open now / deadline ahead" entries={board.open} now={now} empty="Nothing open that matches." />
          <Group title="Opening soon" entries={board.upcoming} now={now} empty="No announced openings." />
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
