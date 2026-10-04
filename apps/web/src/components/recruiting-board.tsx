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
import { SelectMenu } from "./select-menu";
import { ClubLogo } from "./club-logo";
import { Chevron, DemoPill, EmptyState, SectionHeading, ShowMoreSummary } from "./ui";

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
const SHOWN = 5;

const LIST = "hc-list";
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
    <li data-row="" className={ROW}>
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
            className="hc-btn-primary"
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
    <li data-row="" className={ROW}>
      <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} size="sm" />
      <div className="min-w-0 flex-1">
        <ClubName club={club} />
        <p className="mt-0.5 text-sm font-medium text-stone-800 dark:text-stone-200">{line}</p>
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

/** Dated rounds; `all` keeps every row visible (deadlines this week shouldn't hide behind a tap). */
function Rounds({ entries, now, all = false }: { entries: RecruitingEntry[]; now: Date; all?: boolean }) {
  const render = (e: RecruitingEntry) => <Row key={e.cycle.id} entry={e} now={now} />;
  return all ? <ul className={LIST}>{entries.map(render)}</ul> : <ShortList items={entries} render={render} />;
}

/** The first few rows, the rest one tap away. */
function ShortList<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  return (
    <>
      <ul className={LIST}>{items.slice(0, SHOWN).map(render)}</ul>
      {items.length > SHOWN ? (
        <details className="group">
          <ShowMoreSummary closed={`Show ${items.length - SHOWN} more`} />
          <ul className={LIST}>{items.slice(SHOWN).map(render)}</ul>
        </details>
      ) : null}
    </>
  );
}

function More({ href, label }: { href: string; label: string }) {
  return (
    <p className="text-sm">
      <Link href={href} className="hc-chip-text">
        {label} <span aria-hidden>→</span>
      </Link>
    </p>
  );
}

function nextChanceLine(c: NextChance, now: Date): string {
  if (c.reason === "rolling") return "Recruits on a rolling basis";
  const when = `${c.nextYear ? "next " : ""}${RECRUITING_SEASON_LABEL[c.next].toLowerCase()}`;
  // Late in the term with no round on record: the pattern, and where it points next.
  if (!c.closed && isLatePattern(c, now))
    return `Usually recruits in ${seasonList(c.club.recruitingSeasons ?? [])} · ${c.nextYear ? `again ${when}` : `next likely in ${when}`}`;
  const next = `Next round: usually ${when}`;
  return c.closed?.deadline ? `${next} · this term's round closed ${formatDateValue(c.closed.deadline, now)}` : next;
}

/** A next chance only because this term's usual round has most likely passed (no round on record). */
function isLatePattern(c: NextChance, now: Date): boolean {
  return (
    c.reason === "next_term" && !c.closed && (c.club.recruitingSeasons ?? []).includes(recruitingSeasonForDate(now))
  );
}

const seasonList = (seasons: readonly RecruitingSeason[]) =>
  seasons.map((s) => RECRUITING_SEASON_LABEL[s].toLowerCase()).join(" and ");

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
  const select = (active: boolean) =>
    `h-11 rounded-full border px-3 text-base hover:border-stone-400 sm:h-8 sm:text-sm ${
      active
        ? "border-accent bg-accent-soft text-accent"
        : "border-stone-200 text-stone-700 dark:border-stone-700 dark:text-stone-300"
    }`;
  const go = (patch: Record<string, string | null>) => router.replace(hrefWith(patch), { scroll: false });

  const filters = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filters">
      <SelectMenu
        label="Process"
        value={join ?? ""}
        options={[
          { value: "", label: "Any process" },
          ...JOIN_OPTIONS.map((j) => ({ value: j, label: JOIN_MODE_LABEL[j] })),
        ]}
        onChange={(v) => go({ join: v || null })}
        className={select(Boolean(join))}
      />
      <SelectMenu
        label="Class year"
        value={classYear ?? ""}
        options={[
          { value: "", label: "Any class" },
          ...CLASS_OPTIONS.map((c) => ({ value: c, label: CLASS_YEAR_LABEL[c] })),
        ]}
        onChange={(v) => go({ class: v || null })}
        className={select(Boolean(classYear))}
      />
      <SelectMenu
        label="Category"
        value={category ?? ""}
        options={[
          { value: "", label: "All categories" },
          ...categories.map((c) => ({ value: c.slug, label: c.name, nested: Boolean(c.parentSlug) })),
        ]}
        onChange={(v) => go({ category: v || null })}
        className={select(Boolean(category))}
      />
      <SelectMenu
        label="Deadline"
        value={within ? String(within) : ""}
        options={WINDOWS.map(([v, label]) => ({
          value: v,
          label: v ? `Due in the ${label.toLowerCase()}` : "Any deadline",
        }))}
        onChange={(v) => go({ within: v || null })}
        className={select(Boolean(within))}
      />
      {join || classYear || category || within ? (
        <Link href="/recruiting" className="ml-1 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
          Clear
        </Link>
      ) : null}
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

  return (
    <div className="space-y-8">
      {filters}

      {nothingDated ? (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          No deadlines ahead that we know of{join || category || classYear ? " for these filters" : ""}.
          {anytime.length || chances.length ? " You can still join the clubs below or catch their next round." : ""}
        </p>
      ) : null}

      {dueSoon.length ? (
        <Section id="due-soon" title="Due in the next 7 days" count={dueSoon.length}>
          <Rounds entries={dueSoon} now={now} all />
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
          note="No end date found; they may already be closed."
        >
          <Rounds entries={started} now={now} />
        </Section>
      ) : null}

      {anytime.length ? (
        <Section id="join-anytime" title="Join anytime" count={anytime.length}>
          <ShortList
            items={anytime}
            render={(c) => (
              <ClubLine
                key={c.id}
                club={c}
                line={matchesFirstYears(c) ? "Open membership · first-years welcome" : "Open membership"}
              />
            )}
          />
          <More href={openHref} label="All open-membership clubs" />
        </Section>
      ) : null}

      {chances.length ? (
        <Section
          id="next-chance"
          title={
            chances.some((c) => c.closed || isLatePattern(c, now))
              ? `Missed ${seasonName} recruiting?`
              : "Rolling and next-term recruiting"
          }
          count={chances.length}
          note={
            chances.some((c) => isLatePattern(c, now))
              ? `"Next likely" is a pattern from past years, not an announced date.`
              : undefined
          }
        >
          <ShortList
            items={chances}
            render={(c) => (
              <ClubLine key={c.club.id} club={c.club} line={nextChanceLine(c, now)} modes={c.club.joinModes} />
            )}
          />
        </Section>
      ) : null}

      {usually.length && !within ? (
        <Section
          id="usually"
          title="Usually recruits this term"
          count={usually.length}
          note="No date for this round yet; check the club's own page."
        >
          <ShortList items={usually} render={(c) => <UsuallyLine key={c.id} club={c} />} />
        </Section>
      ) : null}

      {board.recentlyClosed.length ? (
        <details id="closed" className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
            <span className="hc-eyebrow inline-flex items-center gap-1">
              Closed in the last 30 days
              <Chevron className="group-open:rotate-180" />
            </span>
            <span className="tabular text-xs text-stone-500">{board.recentlyClosed.length}</span>
          </summary>
          <div className="mt-3">
            <Rounds entries={board.recentlyClosed} now={now} all />
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
