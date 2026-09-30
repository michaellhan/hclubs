import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  JOIN_MODE_LABEL,
  LINK_KIND_LABEL,
  ORG_TYPE_LABEL,
  SELECTIVITY_LABEL,
  STAGE_KIND_LABEL,
  type JoinMode,
} from "@hci/core";
import { getClubOptions, getClubsForCompare, type ClubProfile } from "@hci/db";
import { CycleStatusPill } from "@/components/club-bits";
import { ComparePicker, RemoveFromCompare } from "@/components/compare-picker";
import { FieldValue, ProvenanceBadge } from "@/components/provenance";
import { DemoPill, EmptyState, LogoPlaceholder, Unknown } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDateValue, formatPercent } from "@/lib/format";
import { renderHours, renderMembers } from "@/lib/render";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Compare clubs" };

type Ctx = { now: Date };

/**
 * Comparison rows. Add a row by appending an entry — each renders one club's cell from
 * the resolved profile (never from raw claims).
 */
const ROWS: { label: string; render: (c: ClubProfile, ctx: Ctx) => ReactNode }[] = [
  {
    label: "Category",
    render: (c) => (c.categories.length ? c.categories.map((x) => x.name).join(", ") : <Unknown />),
  },
  { label: "Type", render: (c) => (c.orgType ? ORG_TYPE_LABEL[c.orgType] : <Unknown />) },
  {
    label: "How to join",
    render: (c) => <FieldValue field={c.fields["club.join_mode"]} render={(v) => JOIN_MODE_LABEL[v as JoinMode]} />,
  },
  {
    label: "Recruiting now",
    render: (c, { now }) =>
      c.currentCycle && c.currentCycle.status !== "unknown" ? (
        <CycleStatusPill cycle={c.currentCycle} now={now} />
      ) : (
        <Unknown />
      ),
  },
  {
    label: "Deadline",
    render: (c, { now }) =>
      c.currentCycle?.deadline ? (
        <span className="tabular">{formatDateValue(c.currentCycle.deadline, now)}</span>
      ) : (
        <Unknown />
      ),
  },
  {
    label: "Process stages",
    render: (c) => {
      const cycle = c.cycles.find((x) => x.id === c.currentCycle?.id);
      return cycle && cycle.stages.length > 0 ? (
        <ol className="list-inside list-decimal text-xs">
          {cycle.stages.map((s) => (
            <li key={s.ordinal}>{s.label ?? STAGE_KIND_LABEL[s.kind]}</li>
          ))}
        </ol>
      ) : (
        <Unknown />
      );
    },
  },
  {
    label: "Selectivity",
    render: (c) =>
      c.selectivity ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="tabular">{formatPercent(c.selectivity.acceptanceRate)} admitted</span>
          <ProvenanceBadge badge="computed" />
          {c.selectivity.label ? (
            <span className="text-xs text-zinc-500">{SELECTIVITY_LABEL[c.selectivity.label]} (derived)</span>
          ) : null}
        </span>
      ) : (
        <Unknown />
      ),
  },
  {
    label: "First-years",
    render: (c) => (
      <FieldValue field={c.fields["club.freshmen_eligible"]} render={(v) => (v ? "Eligible" : "Not eligible")} />
    ),
  },
  {
    label: "Eligibility",
    render: (c) => <FieldValue field={c.fields["club.eligibility_note"]} render={(v) => String(v)} unknown="—" />,
  },
  { label: "Members", render: (c) => <FieldValue field={c.fields["club.member_count"]} render={renderMembers} /> },
  { label: "Time", render: (c) => <FieldValue field={c.fields["club.hours_per_week"]} render={renderHours} /> },
  {
    label: "Links",
    render: (c) =>
      c.links.length ? (
        <ul className="space-y-0.5 text-xs">
          {c.links.slice(0, 5).map((l) => (
            <li key={l.url}>
              {c.isFixture ? (
                <span className="text-zinc-500">{l.label ?? LINK_KIND_LABEL[l.kind]}</span>
              ) : (
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-zinc-300 underline-offset-2"
                >
                  {l.label ?? LINK_KIND_LABEL[l.kind]}
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Unknown />
      ),
  },
];

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.clubs) ? sp.clubs.join(",") : (sp.clubs ?? "");
  const slugs = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9-]+$/.test(s)),
    ),
  ].slice(0, 4);
  const now = new Date();
  const [clubs, options] = await Promise.all([getClubsForCompare(db(), slugs, now), getClubOptions(db())]);
  const selected = clubs.map((c) => c.slug);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Compare clubs</h1>
          <p className="mt-1 text-sm text-zinc-500">Side by side, with sources. Pick up to four.</p>
        </div>
        <ComparePicker options={options} selected={selected} />
      </div>

      {clubs.length === 0 ? (
        <EmptyState title="Choose clubs to compare">
          Add clubs with the picker, or use the Compare button on any club page.{" "}
          <Link href="/clubs" className="underline">
            Browse the directory
          </Link>
        </EmptyState>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[40rem] table-fixed border-separate border-spacing-0 text-sm">
            <colgroup>
              <col className="w-32" />
              {clubs.map((c) => (
                <col key={c.id} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky left-0 bg-white dark:bg-zinc-950" />
                {clubs.map((c) => (
                  <th
                    key={c.id}
                    className="border-b border-zinc-200 px-3 pb-3 text-left align-bottom font-normal dark:border-zinc-800"
                  >
                    <div className="flex items-start gap-2">
                      <LogoPlaceholder name={c.name} size="sm" />
                      <div className="min-w-0">
                        <Link href={`/clubs/${c.slug}`} className="font-semibold hover:underline">
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
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="sticky left-0 border-b border-zinc-100 bg-white py-2.5 pr-3 text-left align-top text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    {row.label}
                  </th>
                  {clubs.map((c) => (
                    <td key={c.id} className="border-b border-zinc-100 px-3 py-2.5 align-top dark:border-zinc-800">
                      {row.render(c, { now })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
