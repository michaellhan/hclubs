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
import { ClubLogo } from "./club-logo";
import { SaveToggle } from "./save-toggle";
import { DemoPill, Pill } from "./ui";

/**
 * Minimal directory row: what it is, how to join, whether it's recruiting, time if known,
 * and Save. Links, size and Compare live on the profile. Everything shown is resolved projection data. `why` lists what a text search
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
  const hours = formatRange(club.hoursPerWeek, "h/wk");
  return (
    <li
      data-row=""
      className="group relative flex gap-3 px-3 py-3 hover:bg-stone-50 sm:px-4 dark:hover:bg-stone-900/60"
    >
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
          {hours ? <span className="tabular text-xs text-stone-500 dark:text-stone-400">{hours}</span> : null}
          {club.categories[0] ? (
            <span className="text-xs text-stone-500 dark:text-stone-400">{club.categories[0].name}</span>
          ) : null}
        </div>
      </div>
      {club.isFixture ? null : (
        <div className="shrink-0 self-center">
          <SaveToggle slug={club.slug} name={club.name} />
        </div>
      )}
    </li>
  );
}
