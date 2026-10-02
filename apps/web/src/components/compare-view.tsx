"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ORG_TYPE_LABEL,
  RECRUITING_SEASON_LABEL,
  SELECTIVITY_LABEL,
  STAGE_KIND_LABEL,
  type RecruitingSeason,
} from "@hci/core/browser";
import {
  pickLinkBar,
  similarClubs,
  withLiveStatus,
  type ClubProfile,
  type IndexClub,
  type StaticIndex,
} from "@hci/db/local";
import { compareSummary, nextChanceText } from "@/lib/compare-summary";
import { accessText, rolesText } from "@/lib/joining";
import { formatDateValue, formatPercent, formatTerm } from "@/lib/format";
import { renderDues, renderHours, renderMembers } from "@/lib/render";
import { useNow } from "@/lib/use-now";
import { withBase } from "@/lib/site";
import { setCompare, useCompare } from "@/lib/use-compare";
import { useIndex } from "@/lib/use-index";
import { CycleStatusPill } from "./club-bits";
import { CopyLink } from "./copy-link";
import { ComparePicker, RemoveFromCompare } from "./compare-picker";
import { LinkBar } from "./link-icons";
import { DerivedFact, FieldValue } from "./provenance";
import { ListSkeleton } from "./recruiting-now";
import { ClubLogo } from "./club-logo";
import { DemoPill, EmptyState, Unknown } from "./ui";

type Ctx = { now: Date; parentOf: Map<string, string | null> };

/** Specific categories only: "Consulting", not also its parent "Business & Pre-professional". */
const specific = (c: ClubProfile, parentOf: Ctx["parentOf"]) =>
  c.categories.filter((x) => !c.categories.some((o) => o.slug !== x.slug && parentOf.get(o.slug) === x.slug));

const UNKNOWN = <Unknown>Unknown</Unknown>;
/** No comp per the College directory, with nothing else known about how members join. */
const noComp = (c: ClubProfile) => c.joining.access === null && c.joining.comp === false;
const seasonsOf = (c: ClubProfile): RecruitingSeason[] => {
  const f = c.fields["club.recruiting_seasons"];
  return f?.kind === "single" && Array.isArray(f.current.value) ? (f.current.value as RecruitingSeason[]) : [];
};
// The derived first-years fact (ADR 0041), the same one the directory filters on.
const firstYears = (c: ClubProfile): boolean | null => c.joining.firstYears;
const stable = (v: unknown) => JSON.stringify(v ?? null);
/** A profile's "next chance" inputs, with the cycle's status recomputed for `now`. */
const nextChanceInput = (c: ClubProfile, now: Date) => ({
  cycle: c.currentCycle ? withLiveStatus(c.currentCycle, now) : null,
  seasons: seasonsOf(c),
  openAccess: c.joining.access === "open",
});
/** The displayed value of a single field, without provenance (claim ids, dates, sources). */
const shown = (f: ClubProfile["fields"][string] | undefined) =>
  f?.kind === "single" ? stable(f.current.value) : f?.kind === "multi" ? stable(f.values.map((v) => v.value)) : null;

/**
 * Comparison rows. Each renders one club's cell from the resolved profile (never from raw
 * claims); `value` is what "differences only" compares (null = unknown).
 */
interface CompareRow {
  label: string;
  value: (c: ClubProfile) => string | null;
  render: (c: ClubProfile, ctx: Ctx) => ReactNode;
}

const ROWS: CompareRow[] = [
  {
    label: "What it does",
    value: (c) => c.shortDescription,
    render: (c) =>
      c.shortDescription ? <span className="text-stone-700 dark:text-stone-300">{c.shortDescription}</span> : UNKNOWN,
  },
  {
    label: "How to join",
    value: (c) => accessText(c.joining),
    render: (c) => {
      const text = accessText(c.joining);
      if (!text) return UNKNOWN;
      const roles = rolesText(c.joining);
      return (
        <div>
          <DerivedFact
            basis={c.joining.access ? c.joiningBasis.access : c.joiningBasis.comp}
            conflict={c.joining.access === "mixed"}
          >
            {text}
          </DerivedFact>
          {noComp(c) ? <span className="block text-xs text-stone-500">per the College directory</span> : null}
          {roles ? <span className="block text-xs text-stone-500">{roles}</span> : null}
        </div>
      );
    },
  },
  {
    label: "Recruiting",
    // What a reader sees (status, term, deadline), not the cycle row's id.
    value: (c) =>
      c.currentCycle && c.currentCycle.status !== "unknown"
        ? stable([c.currentCycle.status, c.currentCycle.termKey, c.currentCycle.deadline?.at ?? null])
        : null,
    render: (c) =>
      c.currentCycle && c.currentCycle.status !== "unknown" ? (
        <CycleStatusPill cycle={c.currentCycle} />
      ) : seasonsOf(c).length ? (
        <span className="text-stone-600 dark:text-stone-400">
          Usually{" "}
          {seasonsOf(c)
            .map((s) => RECRUITING_SEASON_LABEL[s].toLowerCase())
            .join(" & ")}
          ; no current dates
        </span>
      ) : (
        UNKNOWN
      ),
  },
  {
    label: "Next chance",
    // Recomputed on the reader's day (live status), like the recruiting board.
    value: (c) => nextChanceText(nextChanceInput(c, new Date()), new Date()),
    render: (c, { now }) => {
      const live = new Date();
      const text = nextChanceText(nextChanceInput(c, live), live, (d) => formatDateValue(d, now));
      return text ?? UNKNOWN;
    },
  },
  {
    label: "Deadline",
    value: (c) => (c.currentCycle?.deadline ? stable(c.currentCycle.deadline) : null),
    render: (c, { now }) =>
      c.currentCycle?.deadline ? (
        <span className="tabular">
          {formatDateValue(c.currentCycle.deadline, now)}
          <span className="block text-xs text-stone-500">{formatTerm(c.currentCycle.termKey)}</span>
        </span>
      ) : (
        UNKNOWN
      ),
  },
  {
    label: "Category",
    value: (c) => (c.categories.length ? c.categories.map((x) => x.slug).join(",") : null),
    render: (c, { parentOf }) =>
      c.categories.length
        ? specific(c, parentOf)
            .map((x) => x.name)
            .join(", ")
        : UNKNOWN,
  },
  {
    label: "Type",
    value: (c) => c.orgType,
    render: (c) => (c.orgType ? ORG_TYPE_LABEL[c.orgType] : UNKNOWN),
  },
  {
    label: "Stages",
    value: (c) => {
      const cycle = c.cycles.find((x) => x.id === c.currentCycle?.id);
      return cycle?.stages.length ? cycle.stages.map((s) => s.kind).join(",") : null;
    },
    render: (c) => {
      const cycle = c.cycles.find((x) => x.id === c.currentCycle?.id);
      return cycle && cycle.stages.length > 0 ? (
        <ol className="list-inside list-decimal text-xs">
          {cycle.stages.map((s) => (
            <li key={s.ordinal}>{s.label ?? STAGE_KIND_LABEL[s.kind]}</li>
          ))}
        </ol>
      ) : (
        UNKNOWN
      );
    },
  },
  {
    label: "Acceptance",
    value: (c) => (c.selectivity ? String(c.selectivity.acceptanceRate) : null),
    render: (c) =>
      c.selectivity ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="tabular">
            {c.selectivity.admits.value} of {c.selectivity.applicants.value} admitted (
            {formatPercent(c.selectivity.acceptanceRate)})
          </span>
          <span className="text-xs text-stone-500">{formatTerm(c.selectivity.termKey)}</span>
          {c.selectivity.label ? (
            <span className="text-xs text-stone-500">{SELECTIVITY_LABEL[c.selectivity.label]}</span>
          ) : null}
        </span>
      ) : (
        <Unknown>Not published</Unknown>
      ),
  },
  {
    label: "First-years",
    // Sources that disagree are a value of their own, so the row shows (and counts as differing).
    value: (c) =>
      c.joining.conflicts.includes("firstYears") ? "conflict" : firstYears(c) === null ? null : String(firstYears(c)),
    render: (c) =>
      firstYears(c) === null && !c.joining.conflicts.includes("firstYears") ? (
        UNKNOWN
      ) : (
        <DerivedFact basis={c.joiningBasis.firstYears} conflict={c.joining.conflicts.includes("firstYears")}>
          {firstYears(c) === true ? "Eligible" : firstYears(c) === false ? "Not eligible" : "Unclear"}
        </DerivedFact>
      ),
  },
  {
    label: "Eligibility",
    value: (c) => shown(c.fields["club.eligibility_note"]),
    render: (c) => <FieldValue field={c.fields["club.eligibility_note"]} render={(v) => String(v)} />,
  },
  {
    label: "Time",
    value: (c) => (c.hoursPerWeek ? stable(c.hoursPerWeek) : null),
    render: (c) => <FieldValue field={c.fields["club.hours_per_week"]} render={renderHours} />,
  },
  {
    label: "Members",
    value: (c) => (c.memberCount ? stable(c.memberCount) : null),
    render: (c) => <FieldValue field={c.fields["club.member_count"]} render={renderMembers} />,
  },
  {
    label: "Dues",
    value: (c) => shown(c.fields["club.dues"]),
    render: (c) => <FieldValue field={c.fields["club.dues"]} render={renderDues} />,
  },
  {
    label: "Links",
    value: (c) => (c.links.length ? c.slug : null),
    render: (c, { now }) => {
      if (!c.links.length) return UNKNOWN;
      const bar = pickLinkBar(c.links, c.currentCycle?.applicationUrl);
      // A closed round's application page is a dead end here; open clubs' sign-up stays as "Join".
      const closed = c.currentCycle ? withLiveStatus(c.currentCycle, now).status === "closed" : false;
      return (
        <LinkBar
          bar={closed && c.joining.access !== "open" ? { ...bar, apply: null } : bar}
          fixture={c.isFixture}
          // No "Apply" here: the cell can't tell whether applications are open.
          applyText={c.joining.access === "open" ? "Join" : "Application page"}
        />
      );
    },
  },
];

/** Whether the clubs' values for a row differ (unknown counts as its own value). */
function differs(row: CompareRow, clubs: ClubProfile[]): boolean {
  const vals = clubs.map(row.value);
  return vals.some((v) => v !== vals[0]);
}

const profileCache = new Map<string, Promise<ClubProfile | null>>();
/**
 * A club's profile JSON. A renamed or merged club's old slug serves `{ redirect }` to its
 * current slug, so old compare links keep working (launch audit); an unknown slug is null.
 */
function loadProfile(slug: string, hops = 0): Promise<ClubProfile | null> {
  let p = profileCache.get(slug);
  if (!p) {
    p = fetch(withBase(`/data/clubs/${slug}.json`))
      .then((r) => (r.ok ? (r.json() as Promise<ClubProfile | { redirect: string }>) : null))
      .then((d) => (d && "redirect" in d ? (hops < 3 ? loadProfile(d.redirect, hops + 1) : null) : d))
      .catch(() => null);
    profileCache.set(slug, p);
  }
  return p;
}

/**
 * Clubs like the ones being compared (ADR 0034): each compared club's similar clubs, merged
 * by best score, minus the clubs already in the table.
 */
function CompareSuggestions({ index, selected }: { index: StaticIndex; selected: string[] }) {
  const isLeaf = (s: string) => !index.categories.some((c) => c.parentSlug === s);
  const chosen = index.clubs.filter((c) => selected.includes(c.slug));
  const exclude = new Set(chosen.map((c) => c.id));
  const best = new Map<string, { club: IndexClub; score: number }>();
  for (const c of chosen)
    for (const s of similarClubs(c, index.clubs, { limit: 6, isLeaf, exclude }))
      if ((best.get(s.club.id)?.score ?? 0) < s.score) best.set(s.club.id, s);
  const list = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  if (!list.length) return null;
  return (
    <section aria-labelledby="compare-suggestions" className="space-y-2">
      <h2 id="compare-suggestions" className="text-sm font-medium text-stone-700 dark:text-stone-300">
        Similar clubs you may want to compare
      </h2>
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {list.map(({ club: c }) => (
          <li key={c.id} className="relative flex items-center gap-3 px-3 py-2.5">
            <ClubLogo name={c.name} src={c.logo} size="sm" />
            <div className="min-w-0 flex-1">
              <Link href={`/clubs/${c.slug}`} className="text-sm font-medium hover:underline">
                {c.name}
              </Link>
              {c.shortDescription ? (
                <p className="line-clamp-1 text-xs text-stone-600 dark:text-stone-400">{c.shortDescription}</p>
              ) : null}
            </div>
            <Link
              href={`/compare?clubs=${[...selected, c.slug].join(",")}`}
              scroll={false}
              aria-label={`Add ${c.name} to the comparison`}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-stone-500 ring-1 ring-stone-200 ring-inset hover:text-stone-900 hover:ring-stone-400 sm:size-8 dark:ring-stone-700 dark:hover:text-stone-100"
            >
              +
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-stone-500 dark:text-stone-400">
        Shared categories and similar descriptions; tap + to add one to the table.
      </p>
    </section>
  );
}

/** Side-by-side comparison, assembled in the browser from per-club JSON files. */
export function CompareView() {
  const raw = useSearchParams().getAll("clubs").join(",");
  const slugs = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9-]+$/.test(s)),
    ),
  ];
  const tooMany = slugs.length > 4;
  slugs.splice(4);
  const key = slugs.join(",");
  // A bare /compare (the header link) opens the clubs already picked in the tray.
  const router = useRouter();
  const picked = useCompare().slugs.join(",");
  useEffect(() => {
    if (!key && picked) router.replace(`/compare?clubs=${picked}`, { scroll: false });
  }, [key, picked, router]);
  const [diffOnly, setDiffOnly] = useState(false);
  const liveNow = useNow();
  const { data: index } = useIndex();
  const [loaded, setLoaded] = useState<{ key: string; clubs: ClubProfile[]; missing: number } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(key ? key.split(",").map((s) => loadProfile(s)) : []).then((ps) => {
      const found = ps.filter((p): p is ClubProfile => p !== null);
      // Two old slugs can lead to the same club.
      const clubs = found.filter((c, i) => found.findIndex((x) => x.slug === c.slug) === i);
      if (live) setLoaded({ key, clubs, missing: ps.length - found.length });
    });
    return () => {
      live = false;
    };
  }, [key]);
  const clubs = loaded?.key === key ? loaded.clubs : null;
  const missing = loaded?.key === key ? loaded.missing : 0;
  // `now` is used only to decide whether a date shows its year; statuses are live.
  const now = new Date();
  const selected = clubs ? clubs.map((c) => c.slug) : slugs;
  const options = (index?.clubs ?? []).map((c) => ({
    slug: c.slug,
    name: c.name,
    acronym: c.acronym,
    description: c.shortDescription,
  }));
  // The URL is the shareable source of truth; keep the "+ Compare" picks in step with it
  // (with current slugs once loaded, so a merged club's old slug isn't kept).
  const current = clubs ? clubs.map((c) => c.slug).join(",") : key;
  useEffect(() => {
    if (current) setCompare(current.split(","));
  }, [current]);
  const parentOf = new Map((index?.categories ?? []).map((c) => [c.slug, c.parentSlug]));
  const known = clubs ? ROWS.filter((r) => clubs.some((c) => r.value(c) !== null)) : [];
  const rows = clubs && diffOnly && clubs.length > 1 ? known.filter((r) => differs(r, clubs)) : known;
  const hiddenRows = clubs ? ROWS.length - known.length : 0;
  const summary =
    clubs && liveNow
      ? compareSummary(
          clubs.map((c) => ({
            name: c.acronym && c.name.length > 32 ? c.acronym : c.name,
            joinModes: c.joinModes,
            hours: c.hoursPerWeek,
            seasons: seasonsOf(c),
            cycle: c.currentCycle ? withLiveStatus(c.currentCycle, liveNow) : null,
            firstYears: firstYears(c),
            noComp: noComp(c),
            openAccess: c.joining.access === "open",
          })),
          liveNow,
        )
      : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compare clubs</h1>
          <p className="mt-1 text-sm text-stone-500">Up to four clubs, side by side.</p>
        </div>
        <ComparePicker options={options} selected={selected} />
      </div>
      {tooMany ? (
        <p role="status" className="text-sm text-stone-600 dark:text-stone-400">
          This link lists more than four clubs; only the first four are shown.
        </p>
      ) : null}
      {missing > 0 ? (
        <p role="status" className="text-sm text-stone-600 dark:text-stone-400">
          {missing === 1 ? "One club in this link wasn't found" : `${missing} clubs in this link weren't found`}; it may
          have been removed from the index.
        </p>
      ) : null}

      {clubs === null ? (
        <ListSkeleton rows={3} />
      ) : clubs.length === 0 ? (
        <EmptyState title="Pick clubs to compare">
          Search above, or tap <span className="font-medium text-stone-700 dark:text-stone-300">+</span> on any club in
          the{" "}
          <Link href="/clubs" className="underline underline-offset-2">
            directory
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          {summary.length ? (
            <section
              aria-label="Summary"
              className="max-w-3xl rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-700 dark:bg-stone-900 dark:text-stone-300"
            >
              <ul className="space-y-1 max-sm:hidden">
                {summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {/* Phones: the first sentence, the rest on request, so the clubs come first. */}
              <details className="group sm:hidden">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  {summary[0]}
                  {summary.length > 1 ? (
                    <span className="ml-1 text-xs font-medium whitespace-nowrap text-accent group-open:hidden">
                      +{summary.length - 1} more
                    </span>
                  ) : null}
                </summary>
                <ul className="mt-1 space-y-1">
                  {summary.slice(1).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
              <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                Built from the facts in the table below. Not a ranking.
              </p>
            </section>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {clubs.length > 1 ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
                <input
                  type="checkbox"
                  checked={diffOnly}
                  onChange={(e) => setDiffOnly(e.target.checked)}
                  className="size-4 rounded border-stone-300 accent-brand"
                />
                Only rows that differ
              </label>
            ) : null}
            <CopyLink label="Copy link to this comparison" />
          </div>
          {/* Phones: one block per row, the clubs' values stacked under it (two or three narrow
              columns can't fit beside a label); from sm up, the side-by-side table. */}
          <div className="sm:hidden">
            <ul aria-label="Clubs being compared" className="mb-1 space-y-1.5">
              {clubs.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <ClubLogo name={c.name} src={c.isFixture ? null : c.logo} size="sm" />
                  <Link
                    href={`/clubs/${c.slug}`}
                    className="min-w-0 flex-1 text-sm font-semibold break-words hover:underline"
                  >
                    {c.name}
                  </Link>
                  {c.isFixture ? <DemoPill /> : null}
                  <RemoveFromCompare slug={c.slug} selected={selected} />
                </li>
              ))}
            </ul>
            <dl>
              {rows.map((row) => (
                <div key={row.label} className="border-b border-stone-100 py-3 dark:border-stone-800">
                  <dt className="text-xs font-medium text-stone-500 dark:text-stone-400">{row.label}</dt>
                  {clubs.map((c) => (
                    <dd key={c.id} className="mt-1.5 flex gap-2 text-sm">
                      {clubs.length > 1 ? (
                        <span className="w-20 shrink-0 line-clamp-3 text-xs font-medium break-words text-stone-700 dark:text-stone-300">
                          {c.acronym || c.name}
                        </span>
                      ) : null}
                      <div className="min-w-0 flex-1">{row.render(c, { now, parentOf })}</div>
                    </dd>
                  ))}
                </div>
              ))}
            </dl>
          </div>
          <div className="-mx-4 overflow-x-auto max-sm:hidden">
            <table
              className="w-full table-fixed border-separate border-spacing-0 text-sm"
              // Label column + ~10.5rem per club: scrolls sideways on phones, fills the page on desktop.
              style={{ minWidth: `${7.5 + clubs.length * 10.5}rem` }}
            >
              <colgroup>
                <col className="w-30 sm:w-36" />
                {clubs.map((c) => (
                  <col key={c.id} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white dark:bg-stone-950">
                    <span className="sr-only">Club</span>
                  </th>
                  {clubs.map((c) => (
                    <th
                      key={c.id}
                      className="border-b border-stone-200 px-3 pb-3 text-left align-bottom font-normal last:pr-4 dark:border-stone-800"
                    >
                      <div className="flex items-start gap-2">
                        <ClubLogo name={c.name} src={c.isFixture ? null : c.logo} size="sm" />
                        <div className="min-w-0">
                          <Link href={`/clubs/${c.slug}`} className="font-semibold break-words hover:underline">
                            {c.name}
                          </Link>
                          <div className="mt-0.5 flex items-center gap-2">
                            {c.isFixture ? <DemoPill /> : null}
                            <RemoveFromCompare slug={c.slug} selected={selected} />
                          </div>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-r border-b border-stone-100 bg-white py-2.5 pr-3 pl-4 text-left align-top text-xs font-medium text-stone-500 sm:border-r-0 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400"
                    >
                      {row.label}
                    </th>
                    {clubs.map((c) => (
                      <td
                        key={c.id}
                        className="border-b border-stone-100 px-3 py-2.5 align-top last:pr-4 dark:border-stone-800"
                      >
                        {row.render(c, { now, parentOf })}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* One line, once: a blank cell next to "3 hours/week" reads as "less" otherwise. */}
          <p className="mt-3  text-xs text-stone-500 dark:text-stone-400">
            &ldquo;Unknown&rdquo; means we haven&apos;t found a source that says, not that the club has none or takes no
            time. Tap a value on a club&apos;s page to see where it comes from.
          </p>
          {hiddenRows > 0 || (diffOnly && known.length > rows.length) ? (
            <p className="mt-1  text-xs text-stone-500">
              {[
                hiddenRows > 0
                  ? `${hiddenRows} ${hiddenRows === 1 ? "row" : "rows"} unknown for all of these clubs`
                  : null,
                diffOnly && known.length > rows.length ? `${known.length - rows.length} the same for every club` : null,
              ]
                .filter(Boolean)
                .join(" · ")}{" "}
              hidden.
            </p>
          ) : null}
        </>
      )}
      {index && clubs && clubs.length > 0 && clubs.length < 4 ? (
        <CompareSuggestions index={index} selected={selected} />
      ) : null}
    </div>
  );
}
