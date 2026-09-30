import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ACTIVITY_STATUS_LABEL,
  AFFILIATION_SCOPE_LABEL,
  CLASS_YEAR_LABEL,
  type ClassYear,
  JOIN_MODE_LABEL,
  LINK_KIND_LABEL,
  ORG_TYPE_LABEL,
  RECOGNITION_STATUS_LABEL,
  RECRUITING_SEASON_LABEL,
  SELECTIVITY_LABEL,
  SELECTIVE_JOIN_MODES,
  SOURCE_TYPE_LABEL,
  STAGE_KIND_LABEL,
  type ActivityStatus,
  type AffiliationScope,
  type JoinMode,
  type RecognitionStatus,
  type RecruitingSeason,
  type ResolvedValue,
  PressMentionValue,
  getField,
} from "@hci/core";
import {
  getClubProfile,
  getClubSlugs,
  type ClubProfile,
  type CycleDetail,
  type LinkDisplay,
  type StoredField,
} from "@hci/db";
import { CycleStatusPill } from "@/components/club-bits";
import { FieldValue, Provenance, ProvenanceBadge } from "@/components/provenance";
import { Ago } from "@/components/ago";
import { ClientRedirect } from "@/components/client-redirect";
import { CONTRIBUTE_ANCHOR, SuggestUpdate } from "@/components/suggest-update";
import { DemoPill, LogoPlaceholder, Pill, SectionHeading, Unknown } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate, formatDateValue, formatPercent, formatRange, formatTerm } from "@/lib/format";
import { renderDues, renderHours, renderMembers } from "@/lib/render";

// Prebuilt for every club plus every retired/merged slug (which redirects).
export const dynamicParams = false;
export async function generateStaticParams() {
  const { live, retired } = await getClubSlugs(db());
  return [...live, ...retired].map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await getClubProfile(db(), (await params).slug, new Date());
  if (r.kind === "redirect") return { title: "Moved", robots: { index: false } };
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
  // `now` is the build time: used only for year display; status is recomputed in the browser.
  const deadlineField = cycle.fields["cycle.deadline"];
  const opensField = cycle.fields["cycle.opens_at"];
  const stagesField = cycle.fields["cycle.stages"];
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {formatTerm(cycle.termKey)} recruiting{cycle.track !== "main" ? ` · ${cycle.track}` : ""}
        </p>
        <CycleStatusPill cycle={cycle} />
      </div>
      <dl className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {opensField?.kind === "single" ? (
          <Row label="Opens">
            <Provenance
              value={opensField.current}
              alternatives={opensField.alternatives}
              conflict={opensField.conflict}
            >
              <span className="tabular">{formatDateValue(cycle.opens, now)}</span>
            </Provenance>
          </Row>
        ) : null}
        <Row label="Deadline">
          {deadlineField?.kind === "single" && cycle.deadline ? (
            <Provenance
              value={deadlineField.current}
              alternatives={deadlineField.alternatives}
              conflict={deadlineField.conflict}
            >
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
      {cycle.lastVerifiedAt ? (
        <p className="mt-2 text-xs text-zinc-500">
          Recruiting info last verified <Ago iso={cycle.lastVerifiedAt} />
        </p>
      ) : null}
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

/**
 * Lower-case registry label for a field that has no data yet (CLAUDE.md §6: the registry
 * drives display), with a few phrasings that read better in a "Not yet known" list.
 */
const MISSING_PHRASE: Record<string, string> = {
  "cycle.deadline": "recruiting deadline",
  "club.recruiting_seasons": "usual recruiting term",
  "cycle.stated_acceptance_rate": "acceptance rate",
};
function missingLabel(key: string): string {
  const phrase = MISSING_PHRASE[key];
  if (phrase) return phrase;
  const label = getField(key).label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** One compact line in place of rows of "Unknown", with a way to help fill them in. */
function NotYetKnown({ keys, title }: { keys: string[]; title?: string }) {
  if (keys.length === 0) return null;
  return (
    <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400" title={title}>
      <span className="font-medium text-zinc-600 dark:text-zinc-300">Not yet known:</span>{" "}
      {keys.map(missingLabel).join(", ")}.{" "}
      <a
        href={`#${CONTRIBUTE_ANCHOR}`}
        className="whitespace-nowrap underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 hover:decoration-zinc-900 dark:decoration-zinc-600 dark:hover:text-zinc-100"
      >
        Know any of these?
      </a>
    </p>
  );
}

function renderSeasons(v: unknown): string {
  return (Array.isArray(v) ? v : [])
    .map((s) => RECRUITING_SEASON_LABEL[s as RecruitingSeason] ?? null)
    .filter((s): s is string => s !== null)
    .join(", ");
}

/** Which key facts the profile has, at a glance (text + icon, never color alone). */
function WhatWeKnow({ facts }: { facts: { label: string; known: boolean; href: string }[] }) {
  const known = facts.filter((f) => f.known).length;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
      <span className="text-zinc-500 dark:text-zinc-400">
        What we know{" "}
        <span className="tabular">
          ({known} of {facts.length})
        </span>
      </span>
      <ul className="contents">
        {facts.map((f) => (
          <li key={f.label}>
            {f.known ? (
              <a
                href={f.href}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 font-medium text-zinc-800 ring-1 ring-zinc-200 ring-inset hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-700"
              >
                <span aria-hidden>✓</span>
                {f.label}
                <span className="sr-only">: known</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-zinc-500 ring-1 ring-zinc-300 ring-dashed ring-inset dark:text-zinc-400 dark:ring-zinc-700">
                <span aria-hidden>?</span>
                {f.label}
                <span className="sr-only">: not yet known</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {known < facts.length ? (
        <a
          href={`#${CONTRIBUTE_ANCHOR}`}
          className="text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:decoration-zinc-600 dark:hover:text-zinc-100"
        >
          Help fill this in
        </a>
      ) : null}
    </div>
  );
}

/** Valid press mentions, newest first (headline, publisher and date only — never article text, §21). */
function pressMentions(field: StoredField | undefined): { value: ResolvedValue; mention: PressMentionValue }[] {
  if (field?.kind !== "multi") return [];
  return field.values
    .flatMap((v) => {
      const parsed = PressMentionValue.safeParse(v.value);
      return parsed.success ? [{ value: v, mention: parsed.data }] : [];
    })
    .sort(
      (a, b) =>
        b.mention.publishedOn.localeCompare(a.mention.publishedOn) || a.mention.url.localeCompare(b.mention.url),
    );
}

const PRESS_SHOWN = 5;

function PressItem({
  item,
  fixture,
}: {
  item: { value: ResolvedValue; mention: PressMentionValue };
  fixture: boolean;
}) {
  const { mention, value } = item;
  return (
    <li className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
      <span className="min-w-0">
        <ExternalLink href={mention.url} fixture={fixture}>
          {mention.title}
        </ExternalLink>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{mention.publisher}</span>
        <span className="tabular">
          {/* epoch "now" ⇒ always show the year */}
          {formatDateValue({ at: mention.publishedOn, precision: "date" }, new Date(0))}
        </span>
        <Provenance value={value} align="right" />
      </span>
    </li>
  );
}

function InTheNews({
  mentions,
  fixture,
}: {
  mentions: { value: ResolvedValue; mention: PressMentionValue }[];
  fixture: boolean;
}) {
  const shown = mentions.slice(0, PRESS_SHOWN);
  const more = mentions.slice(PRESS_SHOWN);
  const list = "divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800";
  return (
    <section>
      <SectionHeading>In the news</SectionHeading>
      <ul className={list}>
        {shown.map((m) => (
          <PressItem key={m.value.claimId} item={m} fixture={fixture} />
        ))}
      </ul>
      {more.length > 0 ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Show all {mentions.length} articles
          </summary>
          <ul className={`mt-2 ${list}`}>
            {more.map((m) => (
              <PressItem key={m.value.claimId} item={m} fixture={fixture} />
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        Articles that mention the club. Headlines link to the publisher; we don&apos;t reproduce their text.
      </p>
    </section>
  );
}

const LINK_STATUS: Record<LinkDisplay["status"], { label: string; tone: "green" | "blue" | "muted"; help: string }> = {
  verified: {
    label: "Official",
    tone: "green",
    help: "Listed by an official Harvard source or the club's own website",
  },
  probable: {
    label: "Likely official",
    tone: "blue",
    help: "Evidence suggests this is the club's, but it isn't confirmed by an official source",
  },
  unverified: { label: "Unconfirmed", tone: "muted", help: "Seen only on lower-trust sources" },
};

function LinkList({ links, fixture }: { links: LinkDisplay[]; fixture: boolean }) {
  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {links.map((l) => (
        <li key={l.url} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="w-28 shrink-0 text-zinc-500">{l.label ?? LINK_KIND_LABEL[l.kind]}</span>
          <span className="min-w-0 flex-1 truncate">
            <ExternalLink href={l.url} fixture={fixture}>
              {l.handle && l.kind !== "email"
                ? `@${l.handle}`
                : l.url.replace(/^https?:\/\/(www\.)?/, "").replace(/^mailto:/, "")}
            </ExternalLink>
          </span>
          <Pill tone={LINK_STATUS[l.status].tone} title={[LINK_STATUS[l.status].help, ...l.signals].join(" · ")}>
            {LINK_STATUS[l.status].label}
          </Pill>
        </li>
      ))}
    </ul>
  );
}

export default async function ClubPage({ params }: Props) {
  const r = await getClubProfile(db(), (await params).slug, new Date());
  if (r.kind === "redirect") return <ClientRedirect to={`/clubs/${r.slug}/`} />;
  if (r.kind === "not_found") notFound();
  const club: ClubProfile = r.profile;
  const now = new Date();
  const f = club.fields;
  const selective = club.joinModes.some((m) => SELECTIVE_JOIN_MODES.includes(m));
  const pastCycles = club.cycles.filter((c) => c.id !== club.currentCycle?.id);
  const tags = f["club.tag"]?.kind === "multi" ? f["club.tag"].values.map((v) => String(v.value)) : [];
  const mission = f["club.mission"]?.kind === "single" ? String(f["club.mission"].current.value) : null;
  const activities = f["club.activity"]?.kind === "multi" ? f["club.activity"].values : [];
  const sponsors = f["club.sponsor"]?.kind === "multi" ? f["club.sponsor"].values : [];
  const selfDescribed =
    f["club.self_described_selectivity"]?.kind === "single"
      ? String(f["club.self_described_selectivity"].current.value)
      : null;
  const confirmedLinks = club.links.filter((l) => l.status !== "unverified");
  const unconfirmedLinks = club.links.filter((l) => l.status === "unverified");
  const press = pressMentions(f["club.press_mention"]);
  const hasSeasons =
    renderSeasons(
      f["club.recruiting_seasons"]?.kind === "single" ? f["club.recruiting_seasons"].current.value : null,
    ) !== "";
  const hasDatedCycle = club.cycles.some((c) => c.deadline || c.opens);
  const categoryName = (v: unknown) => club.categories.find((c) => c.slug === v)?.name ?? String(v);
  const hasSelectivitySection = Boolean(club.selectivity || selfDescribed);

  // "What we know": key facts a student looks for first. Presence only — no scores.
  const facts = [
    {
      label: "Website",
      known: club.links.some((l) => l.kind === "website" && l.status !== "unverified"),
      href: "#links",
    },
    { label: "How to join", known: Boolean(f["club.join_mode"]), href: "#how-to-join" },
    { label: "Recruiting", known: hasDatedCycle || hasSeasons, href: "#how-to-join" },
    { label: "Time commitment", known: Boolean(f["club.hours_per_week"]), href: "#at-a-glance" },
    { label: "Size", known: Boolean(f["club.member_count"]), href: "#at-a-glance" },
  ];

  // How to join: what's missing, as one line instead of Unknown rows.
  const joinMissing = [
    ...(f["club.join_mode"] ? [] : ["club.join_mode"]),
    ...(hasDatedCycle ? [] : ["cycle.deadline"]),
    ...(hasSeasons ? [] : ["club.recruiting_seasons"]),
    ...(selective && !club.selectivity ? ["cycle.stated_acceptance_rate"] : []),
  ];

  // At a glance: rows with data render; the rest collapse into one "Not yet known" line.
  const activityKnown = club.activityStatus !== "unknown";
  const glanceMissing = [
    "club.hours_per_week",
    "club.member_count",
    "club.freshmen_eligible",
    "club.dues",
    "club.recognition_status",
  ].filter((k) => !f[k]);
  if (!activityKnown) glanceMissing.push("club.activity_status");

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
            {club.categories.length > 0 && f["club.category"] ? (
              // Category links above; this shows how they were assigned (often inferred ⇒ Estimate).
              <FieldValue
                field={f["club.category"]}
                render={categoryName}
                summary={<span className="sr-only">How the categories were assigned</span>}
              />
            ) : null}
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
          <div className="mt-3">
            <WhatWeKnow facts={facts} />
          </div>
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
          <section id="how-to-join" className="scroll-mt-20">
            <SectionHeading>How to join</SectionHeading>
            {f["club.join_mode"] || hasSeasons ? (
              <dl className="mb-3 space-y-1.5 text-sm">
                {f["club.join_mode"] ? (
                  <div className="flex flex-wrap items-center gap-x-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">Process</dt>
                    <dd>
                      <FieldValue field={f["club.join_mode"]} render={(v) => JOIN_MODE_LABEL[v as JoinMode]} />
                    </dd>
                  </div>
                ) : null}
                {hasSeasons ? (
                  <div className="flex flex-wrap items-center gap-x-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">Usually recruits</dt>
                    <dd>
                      <FieldValue field={f["club.recruiting_seasons"]} render={renderSeasons} />
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            {hasSeasons && !club.currentCycle ? (
              <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                A pattern from past recruiting, not a current deadline. Check the club&apos;s own channels for dates.
              </p>
            ) : null}
            {club.currentCycle ? (
              <div className="mb-3">
                <CycleCard cycle={club.currentCycle as CycleDetail} now={now} fixture={club.isFixture} />
              </div>
            ) : null}
            <NotYetKnown
              keys={joinMissing}
              {...(selective && !club.selectivity
                ? {
                    title:
                      "This club has a selective process, but we haven't found published applicant or admit numbers. We don't estimate acceptance rates without them.",
                  }
                : {})}
            />
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

          {hasSelectivitySection ? (
            <section>
              <SectionHeading>Selectivity</SectionHeading>
              {selfDescribed && f["club.self_described_selectivity"]?.kind === "single" ? (
                <div className="mb-3 text-sm">
                  <span className="text-zinc-500">In the club&apos;s words: </span>
                  <Provenance value={f["club.self_described_selectivity"].current}>
                    <span className="italic">“{selfDescribed}”</span>
                  </Provenance>
                  <p className="mt-1 text-xs text-zinc-500">Quoted from the club; not a measured acceptance rate.</p>
                </div>
              ) : null}
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
              ) : selective ? (
                <p className="text-sm text-zinc-500">
                  No published applicant or admit numbers, so no acceptance rate. We don&apos;t estimate one without
                  them.
                </p>
              ) : null}
            </section>
          ) : null}

          {club.longDescription || tags.length > 0 || mission || activities.length > 0 || sponsors.length > 0 ? (
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
              {mission && f["club.mission"]?.kind === "single" && mission !== club.longDescription ? (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-zinc-500">Mission</p>
                  <p className="max-w-prose text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{mission}</p>
                  <Provenance value={f["club.mission"].current}>
                    <span className="text-xs text-zinc-500">Source</span>
                  </Provenance>
                </div>
              ) : null}
              {activities.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-medium text-zinc-500">Activities</p>
                  <FieldValue field={f["club.activity"]} render={(v) => String(v)} />
                </div>
              ) : null}
              {sponsors.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-medium text-zinc-500">Sponsors &amp; partners (as listed by the club)</p>
                  <FieldValue field={f["club.sponsor"]} render={(v) => String(v)} />
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
            <section id="links" className="scroll-mt-20">
              <SectionHeading>Links</SectionHeading>
              {confirmedLinks.length > 0 ? <LinkList links={confirmedLinks} fixture={club.isFixture} /> : null}
              {unconfirmedLinks.length > 0 ? (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                    {unconfirmedLinks.length} unconfirmed {unconfirmedLinks.length === 1 ? "link" : "links"} (not
                    verified as the club&apos;s own)
                  </summary>
                  <div className="mt-2">
                    <LinkList links={unconfirmedLinks} fixture={club.isFixture} />
                  </div>
                </details>
              ) : null}
            </section>
          ) : null}

          {press.length > 0 ? <InTheNews mentions={press} fixture={club.isFixture} /> : null}

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
                  <span className="text-xs text-zinc-400">
                    Profile rebuilt <Ago iso={club.resolvedAt} />
                  </span>
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
                      <th
                        className="px-3 py-2 text-right font-medium"
                        title="Number of separate details (name, links, join process, …) this source supports about the club."
                      >
                        Details
                        <span className="sr-only">
                          {" "}
                          (number of separate details — name, links, join process, and so on — this source supports
                          about the club)
                        </span>
                      </th>
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
                          <Ago iso={s.lastObservedAt} />
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

          <SuggestUpdate clubName={club.name} clubSlug={club.slug} />
        </div>

        <aside id="at-a-glance" className="scroll-mt-20 lg:sticky lg:top-18 lg:self-start">
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <SectionHeading>At a glance</SectionHeading>
            <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {club.currentCycle && club.currentCycle.status !== "unknown" ? (
                <Row label="Recruiting">
                  <CycleStatusPill cycle={club.currentCycle} />
                </Row>
              ) : null}
              {f["club.hours_per_week"] ? (
                <Row label="Time">
                  <FieldValue align="right" field={f["club.hours_per_week"]} render={renderHours} />
                </Row>
              ) : null}
              {f["club.member_count"] ? (
                <Row label="Members">
                  <FieldValue align="right" field={f["club.member_count"]} render={renderMembers} />
                </Row>
              ) : null}
              {club.eligibleClasses?.length ? (
                <Row label="Open to">
                  <FieldValue
                    align="right"
                    field={f["club.eligible_classes"]}
                    render={(v) => (v as ClassYear[]).map((c) => CLASS_YEAR_LABEL[c]).join(", ")}
                  />
                </Row>
              ) : null}
              {f["club.freshmen_eligible"] ? (
                <Row label="First-years">
                  <FieldValue
                    align="right"
                    field={f["club.freshmen_eligible"]}
                    render={(v) => (v ? "Eligible" : "Not eligible")}
                  />
                </Row>
              ) : null}
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
              {f["club.recognition_status"] ? (
                <Row label="Recognition">
                  <FieldValue
                    align="right"
                    field={f["club.recognition_status"]}
                    render={(v) => RECOGNITION_STATUS_LABEL[v as RecognitionStatus]}
                  />
                </Row>
              ) : null}
              {activityKnown ? (
                <Row label="Activity">
                  {f["club.activity_status"]?.kind === "single" &&
                  f["club.activity_status"].current.value === club.activityStatus ? (
                    <FieldValue
                      align="right"
                      field={f["club.activity_status"]}
                      render={(v) => ACTIVITY_STATUS_LABEL[v as ActivityStatus]}
                    />
                  ) : (
                    <span className="inline-flex items-center gap-1.5" title={club.activityReasons.join("; ")}>
                      {ACTIVITY_STATUS_LABEL[club.activityStatus]}
                      <ProvenanceBadge badge="estimate" />
                    </span>
                  )}
                </Row>
              ) : null}
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
            {glanceMissing.length > 0 ? (
              <div className="mt-2">
                <NotYetKnown keys={glanceMissing} />
              </div>
            ) : null}
            <div className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
              <div className="flex justify-between">
                <span>Last verified by an official source</span>
                <span className="tabular">
                  <Ago iso={club.lastVerifiedAt} />
                </span>
              </div>
              <div className="flex justify-between">
                <span>Last observed</span>
                <span className="tabular">
                  <Ago iso={club.lastObservedAt} />
                </span>
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
