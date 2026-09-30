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
  PressMentionValue,
  getField,
} from "@hci/core";
import {
  getClubProfile,
  getClubSlugs,
  pickLinkBar,
  type ClubProfile,
  type CycleDetail,
  type LinkDisplay,
  type StoredField,
} from "@hci/db";
import { CycleStatusPill } from "@/components/club-bits";
import { FieldValue } from "@/components/provenance";
import { LinkBar, LinkGlyph, describeLink, linkText } from "@/components/link-icons";
import { ClientRedirect } from "@/components/client-redirect";
import { CONTRIBUTE_ANCHOR, SuggestUpdate } from "@/components/suggest-update";
import { ClubLogo } from "@/components/club-logo";
import { DemoPill, Pill, SectionHeading, Unknown } from "@/components/ui";
import { db } from "@/lib/db";
import { ogImage } from "@/lib/og";
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
  const { name, acronym, shortDescription, slug } = r.profile;
  const title = acronym && !name.includes(acronym) ? `${name} (${acronym})` : name;
  const description =
    shortDescription ?? `How to join ${name}: process, deadlines, time commitment, and links, on hclubs.`;
  const image = ogImage(`/og/clubs/${slug}.png`, `${name} on hclubs`);
  return {
    title,
    description,
    openGraph: { type: "website", siteName: "hclubs", url: `/clubs/${slug}/`, title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
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
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {formatTerm(cycle.termKey)} recruiting{cycle.track !== "main" ? ` · ${cycle.track}` : ""}
        </p>
        <CycleStatusPill cycle={cycle} />
      </div>
      <dl className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
        {cycle.opens ? (
          <Row label="Opens">
            <span className="tabular">{formatDateValue(cycle.opens, now)}</span>
          </Row>
        ) : null}
        <Row label="Deadline">
          {cycle.deadline ? (
            <span className="tabular font-medium">
              {formatDateValue(cycle.deadline, now)}
              {cycle.deadline.label ? ` — ${cycle.deadline.label}` : ""}
            </span>
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
      {cycle.stages.length > 0 ? (
        <div className="mt-3">
          <div className="mb-2 text-xs text-zinc-500">Stages</div>
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

/** Valid press mentions, newest first (headline, publisher and date only — never article text, §21). */
function pressMentions(field: StoredField | undefined): { id: string; mention: PressMentionValue }[] {
  if (field?.kind !== "multi") return [];
  return field.values
    .flatMap((v) => {
      const parsed = PressMentionValue.safeParse(v.value);
      return parsed.success ? [{ id: v.claimId, mention: parsed.data }] : [];
    })
    .sort(
      (a, b) =>
        b.mention.publishedOn.localeCompare(a.mention.publishedOn) || a.mention.url.localeCompare(b.mention.url),
    );
}

const PRESS_SHOWN = 5;

function PressItem({ mention, fixture }: { mention: PressMentionValue; fixture: boolean }) {
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
      </span>
    </li>
  );
}

function InTheNews({
  mentions,
  fixture,
}: {
  mentions: { id: string; mention: PressMentionValue }[];
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
          <PressItem key={m.id} mention={m.mention} fixture={fixture} />
        ))}
      </ul>
      {more.length > 0 ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Show all {mentions.length} articles
          </summary>
          <ul className={`mt-2 ${list}`}>
            {more.map((m) => (
              <PressItem key={m.id} mention={m.mention} fixture={fixture} />
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

/** Secondary links (directory listings, extra addresses, other pages): a short plain list. */
function MoreLinks({ links, fixture }: { links: LinkDisplay[]; fixture: boolean }) {
  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {links.map((l) => (
        <li key={l.url} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
            <LinkGlyph kind={l.kind} className="size-4" />
          </span>
          <span className="min-w-0 flex-1 truncate" title={describeLink(l)}>
            <ExternalLink href={l.url} fixture={fixture}>
              {l.label ?? linkText(l)}
            </ExternalLink>
          </span>
          <span className="hidden shrink-0 text-xs text-zinc-400 sm:inline dark:text-zinc-500">
            {LINK_KIND_LABEL[l.kind]}
          </span>
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
  const linkBar = pickLinkBar(club.links, club.currentCycle?.applicationUrl);
  const press = pressMentions(f["club.press_mention"]);
  const hasSeasons =
    renderSeasons(
      f["club.recruiting_seasons"]?.kind === "single" ? f["club.recruiting_seasons"].current.value : null,
    ) !== "";
  const hasDatedCycle = club.cycles.some((c) => c.deadline || c.opens);
  const hasSelectivitySection = Boolean(club.selectivity || selfDescribed);

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
  ]
    .filter((k) => !f[k])
    // An "Open to" row (eligible class years) already answers whether first-years can join.
    .filter((k) => !(k === "club.freshmen_eligible" && club.eligibleClasses?.length));
  if (!activityKnown) glanceMissing.push("club.activity_status");

  return (
    <article className="space-y-8">
      {club.isFixture ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-semibold">Demo data.</strong> This is a fictional organization used to develop the
          site. None of its details describe a real club.
        </div>
      ) : null}

      <header>
        <div className="flex items-start gap-3 sm:gap-4">
          <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl">
              {club.name}
              {club.acronym ? (
                <span className="ml-2 align-baseline text-base font-normal text-zinc-500 sm:text-lg dark:text-zinc-400">
                  {club.acronym}
                </span>
              ) : null}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {club.isFixture ? <DemoPill /> : null}
              {club.orgType ? <Pill>{ORG_TYPE_LABEL[club.orgType]}</Pill> : null}
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
                  className="rounded-md px-2 py-1 text-xs leading-4 font-medium text-zinc-600 ring-1 ring-zinc-200 ring-inset sm:px-1.5 sm:py-0.5 sm:text-[11px] hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
          <Link
            href={`/compare?clubs=${club.slug}`}
            className="hidden h-9 shrink-0 items-center rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 sm:inline-flex dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
          >
            Compare
          </Link>
        </div>
        <div className="mt-3 space-y-3 sm:pl-[4.5rem]">
          {club.shortDescription || club.aliases.length > 0 ? (
            <div className="max-w-2xl">
              {club.shortDescription ? (
                <p className="text-zinc-700 text-pretty dark:text-zinc-300">{club.shortDescription}</p>
              ) : null}
              {club.aliases.length > 0 ? (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Also known as {club.aliases.map((a) => a.alias).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
          <LinkBar
            bar={linkBar}
            fixture={club.isFixture}
            applyText={selective || club.joinModes.length === 0 ? "Apply" : "Join"}
          />
        </div>
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
                  <span className="italic">“{selfDescribed}”</span>
                  <p className="mt-1 text-xs text-zinc-500">Quoted from the club; not a measured acceptance rate.</p>
                </div>
              ) : null}
              {club.selectivity ? (
                <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
                  <dl className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    <Row label="Applicants">
                      <span className="tabular">{club.selectivity.applicants.value}</span>
                    </Row>
                    <Row label="Admitted">
                      <span className="tabular">{club.selectivity.admits.value}</span>
                    </Row>
                    <Row label="Acceptance">
                      <span className="tabular font-medium">{formatPercent(club.selectivity.acceptanceRate)}</span>
                    </Row>
                    {club.selectivity.label ? (
                      <Row label="Classification">{SELECTIVITY_LABEL[club.selectivity.label]}</Row>
                    ) : null}
                  </dl>
                  <p className="mt-2 text-xs text-zinc-500">
                    From {formatTerm(club.selectivity.termKey)} applicant and admit numbers. Past cycles may not predict
                    future ones.
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
                <p className="max-w-prose leading-relaxed text-zinc-700 dark:text-zinc-300">{club.longDescription}</p>
              ) : null}
              {mission && f["club.mission"]?.kind === "single" && mission !== club.longDescription ? (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-medium text-zinc-500">Mission</p>
                  <p className="max-w-prose text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{mission}</p>
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
                  <p className="text-xs font-medium text-zinc-500">Sponsors &amp; partners</p>
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

          {linkBar.rest.length > 0 ? (
            <section id="links" className="scroll-mt-20">
              <SectionHeading>More links</SectionHeading>
              <MoreLinks links={linkBar.rest} fixture={club.isFixture} />
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
                    <span className="text-zinc-500">{m.asOf ? `as of ${formatDate(m.asOf)}` : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
                  <FieldValue field={f["club.hours_per_week"]} render={renderHours} />
                </Row>
              ) : null}
              {f["club.member_count"] ? (
                <Row label="Members">
                  <FieldValue field={f["club.member_count"]} render={renderMembers} />
                </Row>
              ) : null}
              {club.eligibleClasses?.length ? (
                <Row label="Open to">
                  <FieldValue
                    field={f["club.eligible_classes"]}
                    render={(v) => (v as ClassYear[]).map((c) => CLASS_YEAR_LABEL[c]).join(", ")}
                  />
                </Row>
              ) : null}
              {f["club.freshmen_eligible"] ? (
                <Row label="First-years">
                  <FieldValue field={f["club.freshmen_eligible"]} render={(v) => (v ? "Eligible" : "Not eligible")} />
                </Row>
              ) : null}
              {f["club.eligibility_note"] ? (
                <Row label="Eligibility">
                  <FieldValue field={f["club.eligibility_note"]} render={(v) => String(v)} />
                </Row>
              ) : null}
              {f["club.experience_required"] ? (
                <Row label="Experience">
                  <FieldValue field={f["club.experience_required"]} render={(v) => String(v)} />
                </Row>
              ) : null}
              {f["club.dues"] ? (
                <Row label="Dues">
                  <FieldValue field={f["club.dues"]} render={renderDues} />
                </Row>
              ) : null}
              {f["club.meeting_frequency"] ? (
                <Row label="Meets">
                  <FieldValue field={f["club.meeting_frequency"]} render={(v) => String(v)} />
                </Row>
              ) : null}
              {f["club.recognition_status"] ? (
                <Row label="Recognition">
                  <FieldValue
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
                      field={f["club.activity_status"]}
                      render={(v) => ACTIVITY_STATUS_LABEL[v as ActivityStatus]}
                    />
                  ) : (
                    <span title={club.activityReasons.join("; ")}>{ACTIVITY_STATUS_LABEL[club.activityStatus]}</span>
                  )}
                </Row>
              ) : null}
              {club.affiliationScope !== "unknown" ? (
                <Row label="Affiliation">
                  <FieldValue
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
          </div>
        </aside>
      </div>

      {club.sources.length > 0 ? (
        <details className="group border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
          <summary className="-my-2 inline-flex cursor-pointer items-center gap-1.5 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
            <span aria-hidden className="transition-transform group-open:rotate-90">
              ›
            </span>
            Sources ({club.sources.length})
          </summary>
          <ul className="mt-2 space-y-2 text-xs sm:space-y-1">
            {club.sources.map((s) => (
              <li key={s.id} className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                <span className="min-w-0 truncate py-0.5 sm:py-0">
                  <ExternalLink href={s.url} fixture={s.isFixture}>
                    {s.title ?? s.url}
                  </ExternalLink>
                </span>
                <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{SOURCE_TYPE_LABEL[s.sourceType]}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
