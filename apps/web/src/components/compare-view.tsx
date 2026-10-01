"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { JOIN_MODE_LABEL, ORG_TYPE_LABEL, SELECTIVITY_LABEL, STAGE_KIND_LABEL, type JoinMode } from "@hci/core";
import { pickLinkBar, type ClubProfile } from "@hci/db/local";
import { formatDateValue, formatPercent } from "@/lib/format";
import { renderHours, renderMembers } from "@/lib/render";
import { withBase } from "@/lib/site";
import { setCompare } from "@/lib/use-compare";
import { useIndex } from "@/lib/use-index";
import { CycleStatusPill } from "./club-bits";
import { ComparePicker, RemoveFromCompare } from "./compare-picker";
import { LinkBar } from "./link-icons";
import { FieldValue } from "./provenance";
import { ListSkeleton } from "./recruiting-now";
import { ClubLogo } from "./club-logo";
import { DemoPill, EmptyState, Unknown } from "./ui";

type Ctx = { now: Date };

/**
 * Comparison rows. Add a row by appending an entry — each renders one club's cell from
 * the resolved profile (never from raw claims).
 */
const ROWS: { label: string; known: (c: ClubProfile) => boolean; render: (c: ClubProfile, ctx: Ctx) => ReactNode }[] = [
  {
    label: "Category",
    known: (c) => c.categories.length > 0,
    render: (c) => (c.categories.length ? c.categories.map((x) => x.name).join(", ") : <Unknown>—</Unknown>),
  },
  {
    label: "Type",
    known: (c) => Boolean(c.orgType),
    render: (c) => (c.orgType ? ORG_TYPE_LABEL[c.orgType] : <Unknown>—</Unknown>),
  },
  {
    label: "How to join",
    known: (c) => Boolean(c.fields["club.join_mode"]),
    render: (c) => <FieldValue field={c.fields["club.join_mode"]} render={(v) => JOIN_MODE_LABEL[v as JoinMode]} />,
  },
  {
    label: "Recruiting now",
    known: (c) => Boolean(c.currentCycle && c.currentCycle.status !== "unknown"),
    render: (c) =>
      c.currentCycle && c.currentCycle.status !== "unknown" ? (
        <CycleStatusPill cycle={c.currentCycle} />
      ) : (
        <Unknown>—</Unknown>
      ),
  },
  {
    label: "Deadline",
    known: (c) => Boolean(c.currentCycle?.deadline),
    render: (c, { now }) =>
      c.currentCycle?.deadline ? (
        <span className="tabular">{formatDateValue(c.currentCycle.deadline, now)}</span>
      ) : (
        <Unknown>—</Unknown>
      ),
  },
  {
    label: "Process stages",
    known: (c) => (c.cycles.find((x) => x.id === c.currentCycle?.id)?.stages.length ?? 0) > 0,
    render: (c) => {
      const cycle = c.cycles.find((x) => x.id === c.currentCycle?.id);
      return cycle && cycle.stages.length > 0 ? (
        <ol className="list-inside list-decimal text-xs">
          {cycle.stages.map((s) => (
            <li key={s.ordinal}>{s.label ?? STAGE_KIND_LABEL[s.kind]}</li>
          ))}
        </ol>
      ) : (
        <Unknown>—</Unknown>
      );
    },
  },
  {
    label: "Selectivity",
    known: (c) => Boolean(c.selectivity),
    render: (c) =>
      c.selectivity ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="tabular">{formatPercent(c.selectivity.acceptanceRate)} admitted</span>
          {c.selectivity.label ? (
            <span className="text-xs text-zinc-500">{SELECTIVITY_LABEL[c.selectivity.label]}</span>
          ) : null}
        </span>
      ) : (
        <Unknown>—</Unknown>
      ),
  },
  {
    label: "First-years",
    known: (c) => Boolean(c.fields["club.freshmen_eligible"]),
    render: (c) => (
      <FieldValue field={c.fields["club.freshmen_eligible"]} render={(v) => (v ? "Eligible" : "Not eligible")} />
    ),
  },
  {
    label: "Eligibility",
    known: (c) => Boolean(c.fields["club.eligibility_note"]),
    render: (c) => <FieldValue field={c.fields["club.eligibility_note"]} render={(v) => String(v)} unknown="—" />,
  },
  {
    label: "Members",
    known: (c) => Boolean(c.fields["club.member_count"]),
    render: (c) => <FieldValue field={c.fields["club.member_count"]} render={renderMembers} />,
  },
  {
    label: "Time",
    known: (c) => Boolean(c.fields["club.hours_per_week"]),
    render: (c) => <FieldValue field={c.fields["club.hours_per_week"]} render={renderHours} />,
  },
  {
    label: "Links",
    known: (c) => c.links.length > 0,
    render: (c) =>
      c.links.length ? (
        <LinkBar bar={pickLinkBar(c.links, c.currentCycle?.applicationUrl)} fixture={c.isFixture} />
      ) : (
        <Unknown>—</Unknown>
      ),
  },
];

const profileCache = new Map<string, Promise<ClubProfile | null>>();
function loadProfile(slug: string): Promise<ClubProfile | null> {
  let p = profileCache.get(slug);
  if (!p) {
    p = fetch(withBase(`/data/clubs/${slug}.json`)).then((r) => (r.ok ? (r.json() as Promise<ClubProfile>) : null));
    profileCache.set(slug, p);
  }
  return p;
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
  ].slice(0, 4);
  const key = slugs.join(",");
  const { data: index } = useIndex();
  const [loaded, setLoaded] = useState<{ key: string; clubs: ClubProfile[] } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(key ? key.split(",").map(loadProfile) : []).then((ps) => {
      if (live) setLoaded({ key, clubs: ps.filter((p): p is ClubProfile => p !== null) });
    });
    return () => {
      live = false;
    };
  }, [key]);
  const clubs = loaded?.key === key ? loaded.clubs : null;
  // `now` is used only to decide whether a date shows its year; statuses are live.
  const now = new Date();
  const selected = clubs ? clubs.map((c) => c.slug) : slugs;
  const options = (index?.clubs ?? []).map((c) => ({
    slug: c.slug,
    name: c.name,
    acronym: c.acronym,
    description: c.shortDescription,
  }));
  // The URL is the shareable source of truth; keep the "+ Compare" picks in step with it.
  useEffect(() => {
    if (key) setCompare(key.split(","));
  }, [key]);
  const rows = clubs ? ROWS.filter((r) => clubs.some(r.known)) : [];
  const hiddenRows = clubs ? ROWS.length - rows.length : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compare clubs</h1>
          <p className="mt-1 text-sm text-zinc-500">Up to four clubs, side by side.</p>
        </div>
        <ComparePicker options={options} selected={selected} />
      </div>

      {clubs === null ? (
        <ListSkeleton rows={3} />
      ) : clubs.length === 0 ? (
        <EmptyState title="Pick clubs to compare">
          Search above, or tap <span className="font-medium text-zinc-700 dark:text-zinc-300">+</span> on any club in
          the{" "}
          <Link href="/clubs" className="underline underline-offset-2">
            directory
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="-mx-4 overflow-x-auto">
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
                <th className="sticky left-0 z-10 bg-white dark:bg-zinc-950" />
                {clubs.map((c) => (
                  <th
                    key={c.id}
                    className="border-b border-zinc-200 px-3 pb-3 text-left align-bottom font-normal last:pr-4 dark:border-zinc-800"
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
                    className="sticky left-0 z-10 border-r border-b border-zinc-100 bg-white py-2.5 pr-3 pl-4 text-left align-top text-xs font-medium text-zinc-500 sm:border-r-0 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400"
                  >
                    {row.label}
                  </th>
                  {clubs.map((c) => (
                    <td
                      key={c.id}
                      className="border-b border-zinc-100 px-3 py-2.5 align-top last:pr-4 dark:border-zinc-800"
                    >
                      {row.render(c, { now })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {hiddenRows > 0 ? (
            <p className="mt-3 px-4 text-xs text-zinc-500">
              {hiddenRows} {hiddenRows === 1 ? "row" : "rows"} with no data for these clubs hidden.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
