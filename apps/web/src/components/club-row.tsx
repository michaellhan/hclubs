import Link from "next/link";
import {
  matchesFirstYears,
  matchesNoDues,
  matchesNoExperience,
  reasonText,
  type ClubFilters,
  type ListedClub,
  type MatchReason,
} from "@hci/db/local";
import type { RecruitingSeason } from "@hci/core/browser";
import { formatRange } from "@/lib/format";
import { JOINING_FILTERS } from "@/lib/joining";
import { JoiningPills } from "./club-bits";
import { RowRecruiting } from "./row-recruiting";
import { QuickLinks } from "./link-icons";
import { ClubLogo } from "./club-logo";
import { CompareToggle } from "./compare-tray";
import { SaveToggle } from "./save-toggle";
import { DemoPill, Pill } from "./ui";

/**
 * Dense directory row: what it is, how to join, whether it's recruiting, where to learn
 * more. Everything shown is resolved projection data. `why` lists what a text search
 * matched besides the name ("category Consulting", "mentions “software”"); `filters` adds
 * the pills that explain why the row matches an active filter (ADR 0041), so "No dues"
 * shows when you asked for it, not on every row.
 */
export function ClubRow({
  club,
  why,
  filters,
}: {
  club: ListedClub;
  why?: MatchReason[] | string[] | undefined;
  filters?: ClubFilters | undefined;
}) {
  // A plain name match is visible in the row already; say what else matched.
  const matched = (why ?? [])
    .map((r) => (typeof r === "string" ? r : r.kind === "name" ? null : reasonText(r)))
    .filter((r): r is string => r !== null)
    .slice(0, 2);
  const ended = club.activityStatus === "defunct";
  const members = formatRange(club.memberCount);
  const hours = formatRange(club.hoursPerWeek, "h/wk");
  return (
    <li className="group relative flex gap-3 px-3 py-3 hover:bg-stone-50 sm:px-4 dark:hover:bg-stone-900/60">
      <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {/* No viewport prefetch: a page of rows would fetch ~25 profiles (~500 KB) unasked. */}
          <Link
            href={`/clubs/${club.slug}`}
            prefetch={false}
            data-result=""
            className="font-semibold tracking-tight after:absolute after:inset-0 hover:underline"
          >
            {club.name}
          </Link>
          {club.acronym ? <span className="text-sm text-stone-500 dark:text-stone-400">{club.acronym}</span> : null}
          {club.isFixture ? <DemoPill /> : null}
        </div>
        {club.shortDescription ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-stone-600 sm:line-clamp-1 dark:text-stone-400">
            {club.shortDescription}
          </p>
        ) : null}
        {matched.length ? (
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
            <span className="sr-only">Matched: </span>
            {matched.join(" · ")}
          </p>
        ) : null}
        <div className="relative mt-1.5 flex flex-wrap items-center gap-1.5">
          {!ended && club.currentCycle ? (
            <RowRecruiting
              cycle={club.currentCycle}
              seasons={(club as { recruitingSeasons?: RecruitingSeason[] }).recruitingSeasons}
            />
          ) : null}
          {/* Shown only when a name search brings up a club hidden by default (ADR 0038). */}
          {ended ? (
            <Pill tone="amber" title="A source says this organization ended">
              No longer active
            </Pill>
          ) : club.activityStatus === "inactive" ? (
            <Pill tone="amber">Inactive</Pill>
          ) : null}
          {club.affiliationScope === "graduate_school" ? (
            <Pill title="A group at one of Harvard's graduate or professional schools">Graduate school</Pill>
          ) : null}
          {ended ? null : <JoiningPills joining={club.joining} max={2} />}
          {!ended && matchesFirstYears(club) ? (
            <Pill tone="blue" title={JOINING_FILTERS.freshmenEligible.help}>
              {JOINING_FILTERS.freshmenEligible.label}
            </Pill>
          ) : null}
          {!ended && filters?.noDues && matchesNoDues(club) ? (
            <Pill tone="green" title={JOINING_FILTERS.noDues.help}>
              {JOINING_FILTERS.noDues.label}
            </Pill>
          ) : null}
          {!ended && filters?.noExperience && matchesNoExperience(club) ? (
            <Pill tone="green" title={JOINING_FILTERS.noExperience.help}>
              {JOINING_FILTERS.noExperience.label}
            </Pill>
          ) : null}
          {club.categories.slice(0, 2).map((c) => (
            <span key={c.slug} className="text-xs text-stone-500 dark:text-stone-400">
              {c.name}
            </span>
          ))}
        </div>
      </div>
      {club.isFixture || !club.quickLinks ? null : <QuickLinks links={club.quickLinks} name={club.name} />}
      {members || hours ? (
        <dl className="hidden w-28 shrink-0 grid-cols-[auto_auto] justify-end whitespace-nowrap gap-x-2 gap-y-0.5 self-center text-right text-xs sm:grid">
          {members ? (
            <>
              <dt className="text-stone-500">Members</dt>
              <dd className="tabular font-medium text-stone-700 dark:text-stone-300">{members}</dd>
            </>
          ) : null}
          {hours ? (
            <>
              <dt className="text-stone-500">Time</dt>
              <dd className="tabular font-medium text-stone-700 dark:text-stone-300">{hours}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <div className="hidden w-28 shrink-0 sm:block" />
      )}
      {club.isFixture ? null : (
        <div className="flex shrink-0 flex-col items-center self-center sm:flex-row sm:gap-1">
          <SaveToggle slug={club.slug} name={club.name} />
          <CompareToggle slug={club.slug} />
        </div>
      )}
    </li>
  );
}
