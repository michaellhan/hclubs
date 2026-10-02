"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  JOIN_MODE_HELP,
  JOIN_MODE_LABEL,
  RECOGNITION_STATUS_LABEL,
  RECRUITING_SEASON_LABEL,
  type JoinMode,
  type RecognitionStatus,
  type RecruitingSeason,
} from "@hci/core/browser";
import type { CategoryWithCount, FacetCounts } from "@hci/db/local";
import type { DirectoryParams } from "@/lib/params";
import { JOINING_FILTERS, PROCESS_MODES } from "@/lib/joining";
import { FilterForm } from "./filter-form";

const SEASON_OPTIONS: RecruitingSeason[] = ["fall", "spring"];

/** "60 confirmed · 2 say no · 627 don't say": what a yes/no filter's count leaves out. */
function knownText(k: { yes: number; no: number; unknown: number } | undefined): string | undefined {
  if (!k) return undefined;
  const parts = [`${k.yes} confirmed`];
  if (k.no) parts.push(`${k.no} say no`);
  if (k.unknown) parts.push(`${k.unknown} don't say`);
  return parts.join(" · ");
}

/** For a confirmed-only fact with no "no" side: "43 confirmed · 644 don't say". */
function dontSayText(k: { yes: number; unknown: number } | undefined): string | undefined {
  if (!k) return undefined;
  return k.unknown ? `${k.yes} confirmed · ${k.unknown} don't say` : `${k.yes} confirmed`;
}

/**
 * One filter option. Uncontrolled (the form reads it on change and navigates), but kept in
 * sync with the URL so Back/Forward and removing a chip never leave a stale checkmark.
 */
function Checkbox({
  name,
  value,
  checked,
  children,
  count,
  help,
  detail,
}: {
  name: string;
  value: string;
  checked: boolean;
  children: React.ReactNode;
  /** Results with this option on; omitted while loading. */
  count?: number | undefined;
  help?: string | undefined;
  /** For a yes/no filter: how many say yes, no, or don't say ("60 confirmed · 627 don't say"). */
  detail?: string | undefined;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.checked = checked;
  }, [checked]);
  const empty = count === 0 && !checked;
  return (
    <label
      title={[help, detail].filter(Boolean).join(" — ") || undefined}
      className={`flex cursor-pointer items-center gap-2.5 py-1.5 text-sm lg:gap-2 lg:py-0.5 ${empty ? "text-stone-500 dark:text-stone-400" : "text-stone-700 hover:text-stone-950 dark:text-stone-300 dark:hover:text-white"}`}
    >
      <input
        ref={ref}
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        className="size-4 rounded border-stone-300 accent-brand lg:size-3.5"
      />
      <span className="flex-1">
        {children}
        {help ? <span className="sr-only">. {help}</span> : null}
        {detail ? <span className="sr-only"> ({detail})</span> : null}
      </span>
      {count !== undefined ? (
        <>
          <span className="tabular text-xs text-stone-500 dark:text-stone-400" aria-hidden>
            {count}
          </span>
          <span className="sr-only">{count} clubs</span>
        </>
      ) : null}
    </label>
  );
}

function FilterGroup({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <fieldset className="border-t border-stone-100 py-3 first:border-t-0 first:pt-0 dark:border-stone-800">
      <legend className="mb-1.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">{title}</legend>
      {children}
      {note ? <p className="mt-1 text-[11px] leading-4 text-stone-500 dark:text-stone-400">{note}</p> : null}
    </fieldset>
  );
}

/** Rarely-used filters, folded away unless one is on. Inputs inside stay in the form either way. */
function MoreFilters({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <details open={open || undefined} className="group border-t border-stone-100 pt-3 dark:border-stone-800">
      <summary className="flex min-h-8 cursor-pointer items-center justify-between text-xs font-semibold tracking-wide text-stone-500 uppercase">
        More filters
        <span aria-hidden className="group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/** Hide an option no club in the current view has, unless it's selected. */
const shown = (count: number | undefined, checked: boolean) => checked || count === undefined || count > 0;

export function Filters({
  params,
  categories,
  facets,
}: {
  params: DirectoryParams;
  categories: CategoryWithCount[];
  facets: FacetCounts | null;
}) {
  const f = params.filters;
  const parents = categories.filter((c) => !c.parentSlug);
  // Open and attendance-based membership are "Open membership" above; a URL may still ask for them.
  const join = [...PROCESS_MODES, ...f.joinModes.filter((m) => !PROCESS_MODES.includes(m))].filter(
    (m) => !facets || shown(facets.joinModes[m] ?? 0, f.joinModes.includes(m)),
  );
  const seasons = SEASON_OPTIONS.filter(
    (s) => !facets || shown(facets.recruitingSeasons[s] ?? 0, f.recruitingSeasons.includes(s)),
  );
  const visibleParents = parents.filter((p) =>
    [p, ...categories.filter((c) => c.parentSlug === p.slug)].some((c) =>
      shown(facets ? (facets.categories[c.slug] ?? 0) : c.clubCount, f.categories.includes(c.slug)),
    ),
  );
  const moreActive =
    f.noDues ||
    f.noExperience ||
    f.joinModes.length > 0 ||
    f.recruitingSeasons.length > 0 ||
    f.recognition.length > 0 ||
    f.includeGraduate ||
    f.includeInactive;
  return (
    <FilterForm>
      {params.q ? <input type="hidden" name="q" value={params.q} /> : null}
      {params.showAll ? <input type="hidden" name="all" value="1" /> : null}
      {f.intent ? <input type="hidden" name="do" value={f.intent} /> : null}
      {params.sort !== (params.q ? "relevance" : "name") ? (
        <input type="hidden" name="sort" value={params.sort} />
      ) : null}
      {/* The quick chips above the results own these four; keep them through this form's navigations. */}
      {f.recruitingNow ? <input type="hidden" name="recruiting" value="1" /> : null}
      {f.freshmenEligible ? <input type="hidden" name="freshmen" value="1" /> : null}
      {f.openJoin ? <input type="hidden" name="open" value="1" /> : null}
      {f.noComp ? <input type="hidden" name="nocomp" value="1" /> : null}
      {/* Org type has no control here, only the URL; keep it rather than silently dropping it. */}
      {f.orgTypes.map((t) => (
        <input key={t} type="hidden" name="type" value={t} />
      ))}
      {visibleParents.length ? (
        <FilterGroup title="Category">
          {visibleParents.map((p) => {
            const children = categories.filter((c) => c.parentSlug === p.slug);
            const pc = facets ? (facets.categories[p.slug] ?? 0) : p.clubCount;
            if (!shown(pc, f.categories.includes(p.slug))) return null;
            return (
              <div key={p.slug}>
                <Checkbox name="category" value={p.slug} checked={f.categories.includes(p.slug)} count={pc}>
                  {p.name}
                </Checkbox>
                {children.length > 0 ? (
                  <div className="ml-5">
                    {children.map((c) => {
                      const cc = facets ? (facets.categories[c.slug] ?? 0) : c.clubCount;
                      if (!shown(cc, f.categories.includes(c.slug))) return null;
                      return (
                        <Checkbox
                          key={c.slug}
                          name="category"
                          value={c.slug}
                          checked={f.categories.includes(c.slug)}
                          count={cc}
                        >
                          {c.name}
                        </Checkbox>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </FilterGroup>
      ) : null}
      <MoreFilters open={moreActive}>
        {join.length ? (
          <FilterGroup
            title="Selection process"
            note={
              <>
                What a source names for general members (any selected). A process only for a board or a competition team
                doesn&apos;t count.{" "}
                <Link href="/about/glossary/" className="underline underline-offset-2">
                  What these mean
                </Link>
              </>
            }
          >
            {join.map((m: JoinMode) => (
              <Checkbox
                key={m}
                name="join"
                value={m}
                checked={f.joinModes.includes(m)}
                count={facets?.joinModes[m] ?? (facets ? 0 : undefined)}
                help={JOIN_MODE_HELP[m]}
              >
                {JOIN_MODE_LABEL[m]}
              </Checkbox>
            ))}
          </FilterGroup>
        ) : null}
        {seasons.length ? (
          <FilterGroup title="Usually recruits in" note="From past recruiting, not a current deadline.">
            {seasons.map((season) => (
              <Checkbox
                key={season}
                name="season"
                value={season}
                checked={f.recruitingSeasons.includes(season)}
                count={facets?.recruitingSeasons[season] ?? (facets ? 0 : undefined)}
              >
                {RECRUITING_SEASON_LABEL[season]}
              </Checkbox>
            ))}
          </FilterGroup>
        ) : null}
        <FilterGroup title="Experience">
          <Checkbox
            name="noexp"
            value="1"
            checked={f.noExperience}
            count={facets?.noExperience}
            help={JOINING_FILTERS.noExperience.help}
            detail={dontSayText(facets?.known.noExperience)}
          >
            {JOINING_FILTERS.noExperience.label}
          </Checkbox>
        </FilterGroup>
        <FilterGroup title="Cost">
          <Checkbox
            name="nodues"
            value="1"
            checked={f.noDues}
            count={facets?.noDues}
            help={JOINING_FILTERS.noDues.help}
            detail={knownText(facets?.known.noDues)}
          >
            {JOINING_FILTERS.noDues.label}
          </Checkbox>
        </FilterGroup>
        <FilterGroup title="Also">
          {/* "Not recognized" and "Formerly recognized" stay reachable by URL; few students look for them. */}
          {(["recognized", ...f.recognition.filter((r) => r !== "recognized")] as RecognitionStatus[])
            .filter((r) => shown(facets?.recognition[r] ?? (facets ? 0 : undefined), f.recognition.includes(r)))
            .map((r) => (
              <Checkbox
                key={r}
                name="recognition"
                value={r}
                checked={f.recognition.includes(r)}
                count={facets?.recognition[r] ?? (facets ? 0 : undefined)}
                help={r === "recognized" ? "Listed as a recognized organization by a Harvard office." : undefined}
              >
                {r === "recognized" ? "Recognized by Harvard" : RECOGNITION_STATUS_LABEL[r]}
              </Checkbox>
            ))}
          <Checkbox
            name="grad"
            value="1"
            checked={f.includeGraduate}
            count={facets && !f.includeGraduate ? facets.includeGraduate : undefined}
            help="Groups at Harvard's graduate and professional schools. Hidden by default because hclubs is for undergraduates."
          >
            Include graduate-school groups
          </Checkbox>
          <Checkbox
            name="inactive"
            value="1"
            checked={f.includeInactive}
            count={facets && !f.includeInactive ? facets.includeInactive : undefined}
            help="Clubs with evidence that they no longer run."
          >
            Include inactive
          </Checkbox>
        </FilterGroup>
      </MoreFilters>
    </FilterForm>
  );
}
