"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import {
  CLASS_YEAR_LABEL,
  dateValueEnd,
  JOIN_MODES,
  JOIN_MODE_LABEL,
  RECRUITING_SEASON_LABEL,
  nextStepText,
  type ClassYear,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core/browser";
import {
  buildBoardSections,
  matchesFirstYears,
  recruitingSeasonForDate,
  type CategoryWithCount,
  type IndexClub,
  type NextChance,
  type RecruitingEntry,
} from "@hci/db/local";
import { calendarDaysUntil, formatDateValue, relativeDateValue } from "@/lib/format";
import { useIndex } from "@/lib/use-index";
import { useNow } from "@/lib/use-now";
import { JoinModePills } from "./club-bits";
import { ListSkeleton } from "./recruiting-now";
import { SaveToggle } from "./save-toggle";
import { ClubLogo } from "./club-logo";
import { DemoPill, EmptyState, SectionHeading } from "./ui";

const first = (v: string | null) => v ?? undefined;
const DAY = 86_400_000;
const WINDOWS = [
  ["", "Any time"],
  ["7", "Next 7 days"],
  ["14", "Next 2 weeks"],
  ["30", "Next 30 days"],
] as const;
const CLASS_OPTIONS: ClassYear[] = ["first_year", "sophomore", "junior", "senior"];
const JOIN_OPTIONS: JoinMode[] = ["application", "comp", "audition", "tryout"];
const JOIN_ANYTIME_SHOWN = 8;
const NEXT_SHOWN = 12;
const USUALLY_SHOWN = 5;

const LIST =
  "divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800";
const ROW = "relative flex gap-3 px-3 py-3 hover:bg-stone-50 sm:px-4 dark:hover:bg-stone-900/60";

/** Club name line shared by every board row (the whole row links to the profile). */
/** A board club: dated rounds carry the listed fields; patterns come from the index row. */
type BoardClub = RecruitingEntry["club"] & { recruitingSeasons?: RecruitingSeason[] };

function ClubName({ club }: { club: BoardClub }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <Link href={`/clubs/${club.slug}`} className="font-semibold after:absolute after:inset-0 hover:underline">
        {club.name}
      </Link>
      {club.acronym ? <span className="text-sm text-stone-500">{club.acronym}</span> : null}
      {club.isFixture ? <DemoPill /> : null}
    </div>
  );
}

/** Process, class-year and category context under the next step. */
function Context({ club, modes, classes }: { club: BoardClub; modes: JoinMode[]; classes?: string[] | null }) {
  return (
    <div className="relative mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      <JoinModePills modes={modes} />
      {classes?.length ? (
        <span className="text-stone-500">
          Open to {classes.map((c) => CLASS_YEAR_LABEL[c as ClassYear]).join(", ")}
        </span>
      ) : matchesFirstYears(club) ? (
        <span className="text-stone-500">First-years eligible</span>
      ) : null}
      {club.categories[0] ? <span className="text-stone-500">{club.categories[0].name}</span> : null}
    </div>
  );
}

function nextRoundText(club: BoardClub, now: Date): string | null {
  const season = recruitingSeasonForDate(now);
  const seasons = club.recruitingSeasons ?? [];
  const others = seasons.filter((s) => s !== season);
  if (seasons.includes("rolling")) return "Also recruits on a rolling basis";
  return others.length ? `Usually recruits again in ${others.map((s) => RECRUITING_SEASON_LABEL[s]).join(", ")}` : null;
}

/** One dated round: what to do next (the process's own verb and date), then context. */
function Row({ entry, now }: { entry: RecruitingEntry; now: Date }) {
  const { club, cycle } = entry;
  const modes = cycle.processTypes.length ? cycle.processTypes : club.joinModes;
  const live = cycle.status === "open" || cycle.status === "deadline_ahead";
  const due = cycle.deadline ? dateValueEnd(cycle.deadline).getTime() - now.getTime() : null;
  // Same days the label counts ("in 3 days"), so the colour never disagrees with the words.
  const urgent =
    live && due !== null && due >= 0 && cycle.deadline !== null && calendarDaysUntil(cycle.deadline, now) <= 3;
  const step = nextStepText(cycle, club.joinModes, (d) => formatDateValue(d, now) ?? "");
  const upcomingDate = cycle.status === "upcoming" ? (cycle.opens ?? cycle.deadline) : null;
  const when =
    live && cycle.deadline
      ? relativeDateValue(cycle.deadline, now)
      : upcomingDate
        ? relativeDateValue(upcomingDate, now)
        : null;
  const again = cycle.status === "closed" ? nextRoundText(club, now) : null;
  return (
    <li className={ROW}>
      <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} size="sm" />
      <div className="min-w-0 flex-1">
        <ClubName club={club} />
        <p
          className={`mt-0.5 text-sm ${
            cycle.status === "closed"
              ? "text-stone-500 dark:text-stone-400"
              : urgent
                ? "font-medium text-amber-800 dark:text-amber-300"
                : "font-medium text-stone-800 dark:text-stone-200"
          }`}
        >
          {step}
          {when ? <span className="font-normal text-stone-500 dark:text-stone-400"> · {when}</span> : null}
          {again ? <span className="text-stone-500 dark:text-stone-400"> · {again}</span> : null}
        </p>
        {cycle.status === "closed" ? null : <Context club={club} modes={modes} classes={cycle.eligibleClasses} />}
      </div>
      {cycle.applicationUrl && !club.isFixture && live ? (
        <div className="relative shrink-0 self-center">
          <a
            href={cycle.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center rounded-full bg-brand px-3.5 text-sm font-medium text-on-brand hover:bg-brand-hover"
            aria-label={`Apply to ${club.name} (opens the club's form)`}
          >
            Apply
          </a>
        </div>
      ) : null}
      <div className="relative shrink-0 self-center">
        <SaveToggle slug={club.slug} name={club.name} />
      </div>
    </li>
  );
}

/** A club with no dated round: the row says what's known (anyone can join, rolling, next term). */
function ClubLine({ club, line, modes }: { club: IndexClub; line: ReactNode; modes?: JoinMode[] }) {
  return (
    <li className={ROW}>
      <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} size="sm" />
      <div className="min-w-0 flex-1">
        <ClubName club={club} />
        <p className="mt-0.5 text-sm font-medium text-stone-800 dark:text-stone-200">{line}</p>
        {club.shortDescription ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-stone-500 dark:text-stone-400">{club.shortDescription}</p>
        ) : null}
        {modes ? <Context club={club} modes={modes} /> : null}
      </div>
      <div className="relative shrink-0 self-center">
        <SaveToggle slug={club.slug} name={club.name} />
      </div>
    </li>
  );
}

function UsuallyLine({ club }: { club: IndexClub & { recruitingSeasons: RecruitingSeason[] } }) {
  return (
    <ClubLine
      club={club}
      line={`Usually recruits in ${club.recruitingSeasons.map((s) => RECRUITING_SEASON_LABEL[s]).join(", ")}`}
      modes={club.joinModes}
    />
  );
}

function Section({
  id,
  title,
  count,
  note,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <SectionHeading
        id={id}
        aside={count !== undefined ? <span className="tabular text-xs text-stone-500">{count}</span> : null}
      >
        {title}
      </SectionHeading>
      {note ? <p className="-mt-1 mb-3 max-w-2xl text-xs text-stone-500 dark:text-stone-400">{note}</p> : null}
      {children}
    </section>
  );
}

function Rounds({ entries, now }: { entries: RecruitingEntry[]; now: Date }) {
  return (
    <ul className={LIST}>
      {entries.map((e) => (
        <Row key={e.cycle.id} entry={e} now={now} />
      ))}
    </ul>
  );
}

function More({ shown, total, href, label }: { shown: number; total: number; href: string; label: string }) {
  if (total <= shown) return null;
  return (
    <p className="mt-2 text-xs text-stone-500">
      Showing {shown} of {total}.{" "}
      <Link href={href} className="hc-link">
        {label}
      </Link>
    </p>
  );
}

function nextChanceLine(c: NextChance, now: Date): string {
  if (c.reason === "rolling") return "Recruits on a rolling basis";
  const next = `Next round: usually ${RECRUITING_SEASON_LABEL[c.next].toLowerCase()}`;
  return c.closed?.deadline ? `${next} · this term's round closed ${formatDateValue(c.closed.deadline, now)}` : next;
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
  const classYear = (CLASS_OPTIONS as string[]).includes(classRaw)
    ? (classRaw as Exclude<ClassYear, "graduate">)
    : null;
  const within = Number(first(sp.get("within"))) || null;

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

  const filters = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Process">
        <Link href={hrefWith({ join: null })} className={chip(!join)}>
          Any process
        </Link>
        {JOIN_OPTIONS.map((j) => (
          <Link key={j} href={hrefWith({ join: j })} className={chip(join === j)}>
            {JOIN_MODE_LABEL[j]}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Class year">
        <Link href={hrefWith({ class: null })} className={chip(!classYear)}>
          Any class
        </Link>
        {CLASS_OPTIONS.map((c) => (
          <Link key={c} href={hrefWith({ class: c })} className={chip(classYear === c)}>
            {CLASS_YEAR_LABEL[c]}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm sm:flex-none sm:text-xs">
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
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm sm:flex-none sm:text-xs">
          <span className="text-stone-500 dark:text-stone-400">Deadline</span>
          <select
            value={within ? String(within) : ""}
            onChange={(e) => router.replace(hrefWith({ within: e.target.value || null }), { scroll: false })}
            className="h-10 min-w-0 flex-1 rounded-md border border-stone-300 bg-white px-2 text-base sm:h-8 sm:flex-none sm:text-xs dark:border-stone-700 dark:bg-stone-900"
          >
            {WINDOWS.map(([v, label]) => (
              <option key={label} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );

  if (error) return <EmptyState title="Couldn't load recruiting data">Try reloading the page.</EmptyState>;
  if (!data || !liveNow)
    return (
      <div className="space-y-6">
        {filters}
        <ListSkeleton rows={4} />
      </div>
    );

  const now = liveNow;
  const q = {
    now,
    category,
    joinMode: join,
    classYear,
    // Graduate-school groups never: the class chips are College years (ADR 0038).
    includeGraduate: false,
  };
  // One club per "what can I do" section, in priority order (shared with the home page box).
  const { board, started, anytime, usually, chances } = buildBoardSections(data.clubs, { ...q, withinDays: within });
  const season = recruitingSeasonForDate(now);

  // The week ahead first: the deadlines a student can still act on today.
  const soonCutoff = now.getTime() + 7 * DAY;
  const dueSoon = board.open.filter((e) => e.cycle.deadline && dateValueEnd(e.cycle.deadline).getTime() <= soonCutoff);
  const openLater = board.open.filter((e) => !dueSoon.includes(e));
  const upcoming = within ? [] : board.upcoming;
  // Started rounds have no date ahead, so they don't count as "deadlines ahead".
  const nothingDated = dueSoon.length + openLater.length + upcoming.length === 0;
  const openHref = `/clubs?open=1${category ? `&category=${category}` : ""}${classYear === "first_year" ? "&freshmen=1" : ""}`;
  const seasonName = RECRUITING_SEASON_LABEL[season].toLowerCase();

  const jump = [
    { id: "due-soon", label: "due this week", n: dueSoon.length },
    { id: "open-now", label: "open", n: openLater.length },
    { id: "opening-soon", label: "opening soon", n: upcoming.length },
    { id: "started", label: "started, no deadline", n: started.length },
    { id: "join-anytime", label: "join anytime", n: anytime.length },
    { id: "next-chance", label: "next chances", n: chances.length },
    { id: "usually", label: "usually recruit this term", n: within ? 0 : usually.length },
  ].filter((j) => j.n > 0);

  return (
    <div className="space-y-8">
      {filters}

      {jump.length ? (
        <nav aria-label="On this page" className="-mt-2 grid grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap">
          {jump.map((j) => (
            <a
              key={j.id}
              href={`#${j.id}`}
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-stone-200 px-3.5 text-stone-600 hover:border-stone-400 sm:min-h-0 sm:border-0 sm:px-0 dark:border-stone-800 dark:text-stone-400"
            >
              <span className="tabular font-medium text-stone-900 dark:text-stone-100">{j.n}</span> {j.label}
            </a>
          ))}
        </nav>
      ) : null}

      {nothingDated ? (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm dark:border-stone-800 dark:bg-stone-900/50">
          <p className="font-medium">
            No deadlines ahead that we know of{join || category || classYear ? " for these filters" : ""}.
          </p>
          <p className="mt-0.5 text-stone-600 dark:text-stone-400">
            {board.recentlyClosed.length
              ? `${board.recentlyClosed.length} ${board.recentlyClosed.length === 1 ? "round" : "rounds"} closed in the last 30 days. `
              : ""}
            {anytime.length || chances.length
              ? "You can still join the clubs below today, or catch the next round."
              : "Deadlines appear here as soon as a club's page states one."}
          </p>
        </div>
      ) : null}

      {dueSoon.length ? (
        <Section id="due-soon" title="Due in the next 7 days" count={dueSoon.length}>
          <Rounds entries={dueSoon} now={now} />
        </Section>
      ) : null}
      {openLater.length ? (
        <Section id="open-now" title={dueSoon.length ? "Open now, due later" : "Open now"} count={openLater.length}>
          <Rounds entries={openLater} now={now} />
        </Section>
      ) : null}
      {upcoming.length ? (
        <Section id="opening-soon" title="Opening soon" count={upcoming.length}>
          <Rounds entries={upcoming} now={now} />
        </Section>
      ) : null}
      {started.length ? (
        <Section
          id="started"
          title="Started, no deadline listed"
          count={started.length}
          note="These began recently, but we haven't found an end date. They may already be closed, so check the club's page."
        >
          <Rounds entries={started} now={now} />
        </Section>
      ) : null}

      {anytime.length ? (
        <Section
          id="join-anytime"
          title="Join anytime"
          count={anytime.length}
          note="A source says anyone can join: no application, comp or audition for general members."
        >
          <ul className={LIST}>
            {anytime.slice(0, JOIN_ANYTIME_SHOWN).map((c) => (
              <ClubLine
                key={c.id}
                club={c}
                line={matchesFirstYears(c) ? "Open membership · first-years welcome" : "Open membership"}
              />
            ))}
          </ul>
          <More
            shown={Math.min(JOIN_ANYTIME_SHOWN, anytime.length)}
            total={anytime.length}
            href={openHref}
            label="See all open-membership clubs"
          />
        </Section>
      ) : null}

      {chances.length ? (
        <Section
          id="next-chance"
          title={
            chances.some((c) => c.closed) ? `Missed ${seasonName} recruiting?` : "Rolling and next-term recruiting"
          }
          count={chances.length}
          note="Clubs that recruit on a rolling basis or usually hold another round next term, from their own past recruiting. A pattern, not a date."
        >
          <ul className={LIST}>
            {chances.slice(0, NEXT_SHOWN).map((c) => (
              <ClubLine key={c.club.id} club={c.club} line={nextChanceLine(c, now)} modes={c.club.joinModes} />
            ))}
          </ul>
          <More
            shown={Math.min(NEXT_SHOWN, chances.length)}
            total={chances.length}
            href={`/clubs?season=${chances.find((c) => c.reason === "next_term")?.next ?? "rolling"}`}
            label="See more in the directory"
          />
        </Section>
      ) : null}

      {usually.length && !within ? (
        <Section
          id="usually"
          title="Usually recruits this term"
          count={usually.length}
          note={`These clubs have recruited in the ${seasonName} before, but we have no date for this round. Check the club's own page or channels.`}
        >
          <ul className={LIST}>
            {usually.slice(0, USUALLY_SHOWN).map((c) => (
              <UsuallyLine key={c.id} club={c} />
            ))}
          </ul>
          {usually.length > USUALLY_SHOWN ? (
            <details className="group mt-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400">
                Show {usually.length - USUALLY_SHOWN} more{" "}
                <span aria-hidden className="ml-1 inline-block group-open:rotate-90">
                  ›
                </span>
              </summary>
              <ul className={`${LIST} mt-1`}>
                {usually.slice(USUALLY_SHOWN).map((c) => (
                  <UsuallyLine key={c.id} club={c} />
                ))}
              </ul>
            </details>
          ) : null}
          <p className="mt-2 text-xs text-stone-500">
            <Link href={`/clubs?season=${season}`} className="hc-link">
              See all in the directory
            </Link>
          </p>
        </Section>
      ) : null}

      {board.recentlyClosed.length ? (
        <details id="closed" className="group">
          <summary className="flex cursor-pointer items-baseline justify-between gap-4">
            <span className="hc-eyebrow">
              Closed in the last 30 days{" "}
              <span aria-hidden className="ml-1 inline-block group-open:rotate-90">
                ›
              </span>
            </span>
            <span className="tabular text-xs text-stone-500">{board.recentlyClosed.length}</span>
          </summary>
          <div className="mt-3">
            <Rounds entries={board.recentlyClosed} now={now} />
          </div>
        </details>
      ) : null}

      {nothingDated &&
      !started.length &&
      !anytime.length &&
      !chances.length &&
      !usually.length &&
      !board.recentlyClosed.length ? (
        <EmptyState title="Nothing matches these filters">
          <Link href="/recruiting" className="hc-link">
            Clear filters
          </Link>{" "}
          or{" "}
          <Link href={openHref} className="hc-link">
            browse open-membership clubs
          </Link>
          .
        </EmptyState>
      ) : null}
    </div>
  );
}
