import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  ACTIVITY_STATUS_LABEL,
  AFFILIATION_SCOPE_LABEL,
  JOIN_MODE_LABEL,
  LINK_KIND_LABEL,
  ORG_TYPE_LABEL,
  RECOGNITION_STATUS_LABEL,
  SELECTIVITY_LABEL,
  SELECTIVE_JOIN_MODES,
  SOURCE_TYPE_LABEL,
  STAGE_KIND_LABEL,
  type ActivityStatus,
  type AffiliationScope,
  type JoinMode,
  type RecognitionStatus,
} from "@hci/core";
import { getClubProfile, type ClubProfile, type CycleDetail } from "@hci/db";
import { CycleStatusPill } from "@/components/club-bits";
import { FieldValue, Provenance, ProvenanceBadge } from "@/components/provenance";
import { SuggestUpdate } from "@/components/suggest-update";
import { DemoPill, LogoPlaceholder, Pill, SectionHeading, Unknown } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate, formatDateValue, formatPercent, formatRange, formatTerm, relativeDays } from "@/lib/format";
import { renderDues, renderHours, renderMembers } from "@/lib/render";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string): Promise<ClubProfile> {
  const r = await getClubProfile(db(), slug, new Date());
  if (r.kind === "redirect") permanentRedirect(`/clubs/${r.slug}`);
  if (r.kind === "not_found") notFound();
  return r.profile;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await getClubProfile(db(), (await params).slug, new Date());
  if (r.kind !== "found") return { title: "Club not found" };
  return { title: r.profile.name, description: r.profile.shortDescription ?? undefined };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function ExternalLink({ href, fixture, children }: { href: string; fixture: boolean; children: ReactNode }) {
  if (fixture) {
    return (
      <span className="text-zinc-500" title="Demo link — fixture data does not point anywhere real">
        {children}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:decoration-zinc-600 dark:hover:decoration-zinc-100"
    >
      {children}
    </a>
  );
}

function CycleCard({ cycle, now, fixture }: { cycle: CycleDetail; now: Date; fixture: boolean }) {
  const deadlineField = cycle.fields["cycle.deadline"];
  const opensField = cycle.fields["cycle.opens_at"];
  const stagesField = cycle.fields["cycle.stages"];
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {formatTerm(cycle.termKey)} recruiting{cycle.track !== "main" ? ` · ${cycle.track}` : ""}
        </p>
        <CycleStatusPill cycle={cycle} now={now} />
      </div>
      <dl className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {opensField?.kind === "single" ? (
          <Row label="Opens">
            <Provenance value={opensField.current} alternatives={opensField.alternatives}>
              <span className="tabular">{formatDateValue(cycle.opens, now)}</span>
            </Provenance>
          </Row>
        ) : null}
        <Row label="Deadline">
          {deadlineField?.kind === "single" && cycle.deadline ? (
            <Provenance value={deadlineField.current} alternatives={deadlineField.alternatives}>
              <span className="tabular font-medium">
                {formatDateValue(cycle.deadline, now)}
                {cycle.deadline.label ? ` — ${cycle.deadline.label}` : ""}
              </span>
            </Provenance>
          ) : (
            <Unknown>No deadline on record</Unknown>
          )}
        </Row>
        {cycle.processTypes.length > 0 ? (
          <Row label="Process">
            <FieldValue field={cycle.fields["cycle.process_type"]} render={(v) => JOIN_MODE_LABEL[v as JoinMode]} />
          </Row>
        ) : null}
        {cycle.applicationUrl ? (
          <Row label="Apply">
            <ExternalLink href={cycle.applicationUrl} fixture={fixture}>
              {new URL(cycle.applicationUrl).hostname}
            </ExternalLink>
          </Row>
        ) : null}
      </dl>
      {cycle.stages.length > 0 && stagesField?.kind === "single" ? (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
            Stages <ProvenanceBadge badge={stagesField.current.badge} stale={stagesField.current.stale} />
          </div>
          <ol className="relative space-y-2 border-l border-zinc-200 pl-4 dark:border-zinc-800">
            {cycle.stages.map((s) => (
              <li key={s.ordinal} className="relative text-sm">
                <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                <span className="font-medium">{s.label ?? STAGE_KIND_LABEL[s.kind]}</span>
                {s.label ? <span className="text-zinc-500"> · {STAGE_KIND_LABEL[s.kind]}</span> : null}
                {s.startsAt || s.endsAt ? (
                  <span className="tabular text-zinc-500">
                    {" "}
                    · {s.startsAt ? formatDateValue(s.startsAt, now) : ""}
                    {s.startsAt && s.endsAt ? "–" : ""}
                    {s.endsAt ? formatDateValue(s.endsAt, now) : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

export default async function ClubPage({ params }: Props) {
  const club = await load((await params).slug);
  const now = new Date();
  const f = club.fields;
  const selective = club.joinModes.some((m) => SELECTIVE_JOIN_MODES.includes(m));
  const pastCycles = club.cycles.filter((c) => c.id !== club.currentCycle?.id);
  const tags = f["club.tag"]?.kind === "multi" ? f["club.tag"].values.map((v) => String(v.value)) : [];

  return (
    <article className="space-y-8">
      {club.isFixture ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-semibold">Demo data.</strong> This is a fictional organization used to develop the
          site. None of its details describe a real club.
        </div>
      ) : null}

      <header className="flex gap-4">
        <LogoPlaceholder name={club.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{club.name}</h1>
            {club.acronym ? <span className="text-lg text-zinc-500">{club.acronym}</span> : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {club.isFixture ? <DemoPill /> : null}
            {club.orgType ? (
              f["club.org_type"]?.kind === "single" && f["club.org_type"].current.badge === "estimate" ? (
                <Pill tone="muted" title="Estimated from the source listing — not directly stated">
                  {ORG_TYPE_LABEL[club.orgType]} (est.)
                </Pill>
              ) : (
                <Pill>{ORG_TYPE_LABEL[club.orgType]}</Pill>
              )
            ) : null}
            {club.recognitionStatus !== "unknown" ? (
              <Pill tone={club.recognitionStatus === "recognized" ? "green" : "neutral"}>
                {RECOGNITION_STATUS_LABEL[club.recognitionStatus]}
              </Pill>
            ) : null}
            {club.activityStatus !== "unknown" && club.activityStatus !== "active" ? (
              <Pill tone="amber">{ACTIVITY_STATUS_LABEL[club.activityStatus]}</Pill>
            ) : null}
            {club.categories.map((c) => (
              <Link
                key={c.slug}
                href={`/clubs?category=${c.slug}`}
                className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
              >
                {c.name}
              </Link>
            ))}
          </div>
          {club.shortDescription ? (
            <div className="mt-3 max-w-2xl">
              <p className="text-zinc-700 text-pretty dark:text-zinc-300">{club.shortDescription}</p>
              {f["club.short_description"]?.kind === "single" ? (
                <div className="mt-1">
                  <Provenance
                    value={f["club.short_description"].current}
                    alternatives={f["club.short_description"].alternatives}
                  >
                    <span className="text-xs text-zinc-500">Source</span>
                  </Provenance>
                </div>
              ) : null}
            </div>
          ) : null}
          {club.aliases.length > 0 ? (
            <p className="mt-1 text-xs text-zinc-500">Also known as {club.aliases.map((a) => a.alias).join(", ")}</p>
          ) : null}
        </div>
        <Link
          href={`/compare?clubs=${club.slug}`}
          className="hidden h-9 shrink-0 items-center rounded-md border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-50 sm:inline-flex dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Compare
        </Link>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          <section>
            <SectionHeading>How to join</SectionHeading>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <FieldValue
                field={f["club.join_mode"]}
                render={(v) => JOIN_MODE_LABEL[v as JoinMode]}
                unknown="Joining process unknown"
              />
            </div>
            {club.currentCycle ? (
              <CycleCard cycle={club.currentCycle as CycleDetail} now={now} fixture={club.isFixture} />
            ) : (
              <p className="text-sm text-zinc-500">
                No recruiting cycle on record. Deadlines appear here once we find a source for them.
              </p>
            )}
            {pastCycles.length > 0 ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                  {pastCycles.length} other recruiting {pastCycles.length === 1 ? "cycle" : "cycles"}
                </summary>
                <div className="mt-3 space-y-3">
                  {pastCycles.map((c) => (
                    <CycleCard key={c.id} cycle={c} now={now} fixture={club.isFixture} />
                  ))}
                </div>
              </details>
            ) : null}
          </section>

          {club.selectivity || selective ? (
            <section>
              <SectionHeading>Selectivity</SectionHeading>
              {club.selectivity ? (
                <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
                  <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    <Row label="Applicants">
                      <Provenance value={club.selectivity.applicants}>
                        <span className="tabular">{club.selectivity.applicants.value}</span>
                      </Provenance>
                    </Row>
                    <Row label="Admitted">
                      <Provenance value={club.selectivity.admits}>
                        <span className="tabular">{club.selectivity.admits.value}</span>
                      </Provenance>
                    </Row>
                    <Row label="Acceptance">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tabular font-medium">{formatPercent(club.selectivity.acceptanceRate)}</span>
                        <ProvenanceBadge badge="computed" />
                      </span>
                    </Row>
                    {club.selectivity.label ? (
                      <Row label="Classification">
                        <span className="inline-flex items-center gap-1.5">
                          {SELECTIVITY_LABEL[club.selectivity.label]}
                          <ProvenanceBadge badge="estimate" />
                        </span>
                      </Row>
                    ) : null}
                  </dl>
                  <p className="mt-2 text-xs text-zinc-500">
                    From {formatTerm(club.selectivity.termKey)} numbers. The rate is computed from sourced counts; the
                    label is derived by rule ({club.selectivity.rulesetVersion}). Past cycles may not predict future
                    ones.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">Unknown.</span> This club has a
                  selective process, but we haven&apos;t found published applicant or admit numbers. We don&apos;t
                  estimate acceptance rates without them.
                </p>
              )}
            </section>
          ) : null}

          {club.longDescription || tags.length > 0 ? (
            <section>
              <SectionHeading>About</SectionHeading>
              {club.longDescription && f["club.long_description"]?.kind === "single" ? (
                <div className="space-y-2">
                  <p className="max-w-prose leading-relaxed text-zinc-700 dark:text-zinc-300">{club.longDescription}</p>
                  <Provenance
                    value={f["club.long_description"].current}
                    alternatives={f["club.long_description"].alternatives}
                  >
                    <span className="text-xs text-zinc-500">Source</span>
                  </Provenance>
                </div>
              ) : null}
              {tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Link
                      key={t}
                      href={`/clubs?q=${encodeURIComponent(t)}`}
                      className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400"
                    >
                      {t}
                    </Link>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {club.links.length > 0 ? (
            <section>
              <SectionHeading>Links</SectionHeading>
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {club.links.map((l) => (
                  <li key={l.url} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="w-28 shrink-0 text-zinc-500">{l.label ?? LINK_KIND_LABEL[l.kind]}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <ExternalLink href={l.url} fixture={club.isFixture}>
                        {l.handle ? `@${l.handle}` : l.url.replace(/^https?:\/\/(www\.)?/, "").replace(/^mailto:/, "")}
                      </ExternalLink>
                    </span>
                    {l.status === "verified" ? (
                      <Pill tone="green" title="Linked from an official Harvard or club source">
                        Official
                      </Pill>
                    ) : (
                      <Pill tone="muted" title="Found by us; not yet confirmed as the club's own">
                        Unconfirmed
                      </Pill>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {club.membership.length > 1 ? (
            <section>
              <SectionHeading>Membership history</SectionHeading>
              <ul className="space-y-1 text-sm">
                {club.membership.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="tabular w-24">
                      {m.kind === "exact" ? m.count : formatRange({ min: m.min, max: m.max })}
                    </span>
                    <span className="text-zinc-500">as of {formatDate(m.asOf)}</span>
                    {m.isCurrent ? <Pill>Shown</Pill> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <SectionHeading
              aside={
                club.resolvedAt ? (
                  <span className="text-xs text-zinc-400">Profile rebuilt {relativeDays(club.resolvedAt, now)}</span>
                ) : null
              }
            >
              Sources &amp; freshness
            </SectionHeading>
            {club.sources.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
                    <tr>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 text-right font-medium">Facts</th>
                      <th className="px-3 py-2 text-right font-medium">Last seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {club.sources.map((s) => (
                      <tr key={s.id}>
                        <td className="max-w-64 truncate px-3 py-2">
                          <ExternalLink href={s.url} fixture={s.isFixture}>
                            {s.title ?? s.url}
                          </ExternalLink>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{SOURCE_TYPE_LABEL[s.sourceType]}</td>
                        <td className="tabular px-3 py-2 text-right">{s.claimCount}</td>
                        <td
                          className="tabular px-3 py-2 text-right whitespace-nowrap text-zinc-500"
                          title={formatDate(s.lastObservedAt) ?? ""}
                        >
                          {relativeDays(s.lastObservedAt, now)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No sources yet.</p>
            )}
            {club.conflictFields.length > 0 ? (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                Sources disagree on {club.conflictFields.length} {club.conflictFields.length === 1 ? "field" : "fields"}
                ; we show the most authoritative/recent value and keep the others (open a badge to compare).
              </p>
            ) : null}
          </section>

          <SuggestUpdate clubName={club.name} />
        </div>

        <aside className="lg:sticky lg:top-18 lg:self-start">
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <SectionHeading>At a glance</SectionHeading>
            <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <Row label="Recruiting">
                {club.currentCycle && club.currentCycle.status !== "unknown" ? (
                  <CycleStatusPill cycle={club.currentCycle} now={now} />
                ) : (
                  <Unknown />
                )}
              </Row>
              <Row label="Time">
                <FieldValue align="right" field={f["club.hours_per_week"]} render={renderHours} />
              </Row>
              <Row label="Members">
                <FieldValue align="right" field={f["club.member_count"]} render={renderMembers} />
              </Row>
              <Row label="First-years">
                <FieldValue
                  align="right"
                  field={f["club.freshmen_eligible"]}
                  render={(v) => (v ? "Eligible" : "Not eligible")}
                />
              </Row>
              {f["club.eligibility_note"] ? (
                <Row label="Eligibility">
                  <FieldValue align="right" field={f["club.eligibility_note"]} render={(v) => String(v)} />
                </Row>
              ) : null}
              {f["club.experience_required"] ? (
                <Row label="Experience">
                  <FieldValue align="right" field={f["club.experience_required"]} render={(v) => String(v)} />
                </Row>
              ) : null}
              {f["club.dues"] ? (
                <Row label="Dues">
                  <FieldValue align="right" field={f["club.dues"]} render={renderDues} />
                </Row>
              ) : null}
              {f["club.meeting_frequency"] ? (
                <Row label="Meets">
                  <FieldValue align="right" field={f["club.meeting_frequency"]} render={(v) => String(v)} />
                </Row>
              ) : null}
              <Row label="Recognition">
                <FieldValue
                  align="right"
                  field={f["club.recognition_status"]}
                  render={(v) => RECOGNITION_STATUS_LABEL[v as RecognitionStatus]}
                />
              </Row>
              <Row label="Activity">
                <FieldValue
                  align="right"
                  field={f["club.activity_status"]}
                  render={(v) => ACTIVITY_STATUS_LABEL[v as ActivityStatus]}
                />
              </Row>
              {club.affiliationScope !== "unknown" ? (
                <Row label="Affiliation">
                  <FieldValue
                    align="right"
                    field={f["club.affiliation_scope"]}
                    render={(v) => AFFILIATION_SCOPE_LABEL[v as AffiliationScope]}
                  />
                </Row>
              ) : null}
            </dl>
            <div className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
              <div className="flex justify-between">
                <span>Last observed</span>
                <span className="tabular">{club.lastObservedAt ? relativeDays(club.lastObservedAt, now) : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Profile completeness</span>
                <span className="tabular">{Math.round(club.completeness * 100)}%</span>
              </div>
              <div className="flex justify-between">
                <span>Sources</span>
                <span className="tabular">{club.sourceCount}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </article>
  );
}
