import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ACTIVITY_STATUS_LABEL,
  AFFILIATION_SCOPE_LABEL,
  HARVARD_SCHOOL_LABEL,
  LINK_KIND_LABEL,
  ORG_TYPE_LABEL,
  RECOGNITION_STATUS_LABEL,
  SELECTIVITY_LABEL,
  RecruitingSeasonsValue,
  PressMentionValue,
  collapseSimilarPhrases,
  cleanDescriptionText,
  type AffiliationScope,
  type ContributionType,
  type HarvardSchool,
} from "@hci/core";
import {
  getClubProfile,
  publicProfile,
  getClubSlugs,
  pickLinkBar,
  type ClubProfile,
  type LinkDisplay,
  type StoredField,
} from "@hci/db";
import { isSparseClub, rankPressMentions } from "@hci/db/local";
import { AtAGlance } from "@/components/profile/glance";
import { HowToJoin } from "@/components/profile/joining";
import { ApplyLink, JoinStatusLine } from "@/components/profile/joining-live";
import { Alternatives } from "@/components/profile/alternatives";
import { alternativeCandidates, slimClub } from "@/lib/alternatives";
import { EndedNotice } from "@/components/profile/lifecycle";
import { isSearchSource } from "@/lib/known-by-name";
import { SOURCE_KIND } from "@/lib/provenance";
import { LinkBar, LinkGlyph, describeLink, linkText } from "@/components/link-icons";
import { ClientRedirect } from "@/components/client-redirect";
import { SimilarClubs } from "@/components/similar-clubs";
import { buildTimeIndex } from "@/lib/static-index";
import { ContributeLink, SuggestUpdate } from "@/components/suggest-update";
import { ClubLogo } from "@/components/club-logo";
import { CompareToggle } from "@/components/compare-tray";
import { SaveToggle } from "@/components/save-toggle";
import { DemoPill, Pill, SectionHeading } from "@/components/ui";
import { db } from "@/lib/db";
import { ogImage } from "@/lib/og";
import { distinctAliases, formatDate, formatDateValue, formatPercent, formatRange, formatTerm } from "@/lib/format";
import { pageMetadata } from "@/lib/meta";
import { siteUrl } from "@/lib/site";

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
  const { name, acronym, shortDescription, slug, joinModes, currentCycle } = publicProfile(r.profile);
  const title = acronym && !name.includes(acronym) ? `${name} (${acronym})` : name;
  // Without a description, say only what the page actually has.
  const description =
    shortDescription ??
    (joinModes.length || currentCycle
      ? `How to join ${name}, with sources, on hclubs.`
      : `${name}: a Harvard student organization. What hclubs knows so far, with sources.`);
  const image = ogImage(`/og/clubs/${slug}.png`, `${name} on hclubs`);
  return pageMetadata({ title, description, path: `/clubs/${slug}/`, image });
}

/**
 * schema.org Organization for search engines: the club's name, our one-line summary and
 * only verified links (launch audit). No parentOrganization or memberOf: nothing here may
 * imply the page is official or that Harvard endorses it.
 */
function ClubJsonLd({ club }: { club: ClubProfile }) {
  // The club's own site and accounts only: a Harvard directory page about it is not "the same as" it.
  const OWN = ["website", "instagram", "linkedin", "facebook", "x", "youtube", "tiktok", "github"];
  const verified = club.links.filter((l) => l.status === "verified" && OWN.includes(l.kind) && /^https?:/.test(l.url));
  const website = verified.find((l) => l.kind === "website")?.url;
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: club.name,
    ...(club.acronym ? { alternateName: club.acronym } : {}),
    ...(club.shortDescription ? { description: club.shortDescription } : {}),
    ...(website ? { url: website } : {}),
    ...(verified.length ? { sameAs: verified.map((l) => l.url) } : {}),
    mainEntityOfPage: `${siteUrl()}/clubs/${club.slug}/`,
  };
  // "<" escaped so text can never close the script element.
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

/** The College directory's own categories and flags: shown as facts or categories, not tags. */
const DIRECTORY_FLAGS = new Set([
  "no comping requirement",
  "domestic travel",
  "international travel",
  "academic and pre-professional",
  "cultural and racial initiatives",
  "creative and performing arts",
  "department sponsored student organization",
  "government and politics",
  "hobbies and special interests",
  "religious and spiritual life",
  "media and publications",
  "health and wellness",
  "gender and sexuality",
  "women's initiatives",
  "peer counseling/peer education",
  "college life",
  "pre-orientation program",
  "house committee",
  "club sports",
  "public service",
  "pbha",
  "seas",
  "professional",
  "orientation program",
]);

/** Page text joined across HTML blocks can lose the space between sentences ("running.Direct"). */
const spaceSentences = (t: string) => t.replace(/([a-z][.!?])([A-Z][a-z])/g, "$1 $2");

const capitalize = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Categories as a student scans them: specific ones, plus a broad one only if none of its own is listed. */
function displayCategories(club: ClubProfile, parentOf: Map<string, string | null>) {
  const slugs = new Set(club.categories.map((c) => c.slug));
  return club.categories.filter((c) => ![...slugs].some((other) => other !== c.slug && parentOf.get(other) === c.slug));
}

function ExternalLink({ href, fixture, children }: { href: string; fixture: boolean; children: ReactNode }) {
  if (fixture) {
    return (
      <span className="text-stone-500" title="Demo link — fixture data does not point anywhere real">
        {children}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hc-link">
      {children}
    </a>
  );
}

/** Valid press mentions, newest first (headline, publisher and date only — never article text, §21). */
function pressMentions(field: StoredField | undefined): { id: string; mention: PressMentionValue }[] {
  if (field?.kind !== "multi") return [];
  return (
    field.values
      .flatMap((v) => {
        const parsed = PressMentionValue.safeParse(v.value);
        return parsed.success ? [{ id: v.claimId, mention: parsed.data }] : [];
      })
      .sort(
        (a, b) =>
          b.mention.publishedOn.localeCompare(a.mention.publishedOn) || a.mention.url.localeCompare(b.mention.url),
      )
      // The same article is sometimes recorded under www. and bare hosts.
      .filter((m, i, all) => all.findIndex((o) => sameArticle(o.mention.url, m.mention.url)) === i)
  );
}

const articleKey = (url: string) =>
  url
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/[/#?]+$/, "")
    .toLowerCase();
const sameArticle = (a: string, b: string) => articleKey(a) === articleKey(b);

const PRESS_SHOWN = 5;

function PressItem({ mention, fixture }: { mention: PressMentionValue; fixture: boolean }) {
  return (
    <li className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
      <span className="min-w-0">
        <ExternalLink href={mention.url} fixture={fixture}>
          {mention.title}
        </ExternalLink>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
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
  const list =
    "divide-y divide-stone-100 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800";
  return (
    <section>
      <SectionHeading>In the news</SectionHeading>
      <p className="-mt-1 mb-2 text-xs text-stone-500 dark:text-stone-400">
        Student-newspaper articles that mention this club by name: headlines naming it first, then newest first. Not
        every article is about the club.
      </p>
      <ul className={list}>
        {shown.map((m) => (
          <PressItem key={m.id} mention={m.mention} fixture={fixture} />
        ))}
      </ul>
      {more.length > 0 ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
            Show all {mentions.length} articles
          </summary>
          <ul className={`mt-2 ${list}`}>
            {more.map((m) => (
              <PressItem key={m.id} mention={m.mention} fixture={fixture} />
            ))}
          </ul>
        </details>
      ) : null}
      <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
        Articles that mention the club. Headlines link to the publisher; we don&apos;t reproduce their text.
      </p>
    </section>
  );
}

/** Secondary links (directory listings, extra addresses, other pages): a short plain list. */
function MoreLinks({ links, fixture }: { links: LinkDisplay[]; fixture: boolean }) {
  return (
    <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
      {links.map((l) => (
        <li key={l.url} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="shrink-0 text-stone-500 dark:text-stone-400">
            <LinkGlyph kind={l.kind} className="size-4" />
          </span>
          <span className="min-w-0 flex-1 truncate" title={describeLink(l)}>
            <ExternalLink href={l.url} fixture={fixture}>
              {l.label && l.label.trim().toLowerCase() !== LINK_KIND_LABEL[l.kind].toLowerCase()
                ? l.label
                : linkText(l)}
            </ExternalLink>
          </span>
          <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">{LINK_KIND_LABEL[l.kind]}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function ClubPage({ params }: Props) {
  const r = await getClubProfile(db(), (await params).slug, new Date());
  const index = await buildTimeIndex();
  if (r.kind === "redirect") return <ClientRedirect to={`/clubs/${r.slug}/`} />;
  if (r.kind === "not_found") notFound();
  // Never publish evidence quotes or personal addresses (launch audit).
  const club: ClubProfile = publicProfile(r.profile);
  const now = new Date();
  const indexed = club.isFixture ? undefined : index.clubs.find((c) => c.id === club.id);
  const parentOf = new Map(index.categories.map((c) => [c.slug, c.parentSlug]));
  const f = club.fields;
  // A stated process for general members (ADR 0041); a board's or team's alone doesn't count.
  const selective = club.joining.access === "process" || club.joining.access === "mixed";
  const allTags = f["club.tag"]?.kind === "multi" ? f["club.tag"].values.map((v) => String(v.value)) : [];
  const travel = [
    allTags.includes("domestic travel") ? "Domestic" : null,
    allTags.includes("international travel") ? "International" : null,
  ].filter((t): t is string => t !== null);
  const tags = allTags.filter((t) => !DIRECTORY_FLAGS.has(t));
  const mission =
    f["club.mission"]?.kind === "single" ? cleanDescriptionText(String(f["club.mission"].current.value)) : null;
  // Activities come from several pages of a site and often repeat in other words.
  const activities = collapseSimilarPhrases(
    f["club.activity"]?.kind === "multi" ? f["club.activity"].values.map((v) => String(v.value)) : [],
  );
  const sponsors = f["club.sponsor"]?.kind === "multi" ? f["club.sponsor"].values : [];
  const selfDescribed =
    f["club.self_described_selectivity"]?.kind === "single"
      ? String(f["club.self_described_selectivity"].current.value)
      : null;
  const pickedBar = pickLinkBar(club.links, club.currentCycle?.applicationUrl);
  // An ended organization keeps its links for reference, but nothing to apply to.
  const linkBar = club.activityStatus === "defunct" ? { ...pickedBar, apply: null } : pickedBar;
  const press = rankPressMentions(pressMentions(f["club.press_mention"]), club);
  const seasonsField = f["club.recruiting_seasons"];
  const seasons =
    seasonsField?.kind === "single" ? (RecruitingSeasonsValue.safeParse(seasonsField.current.value).data ?? []) : [];
  const hasSelectivitySection = Boolean(club.selectivity || selfDescribed);
  // "Join" only when a source says anyone can join. The College directory's "no comping
  // requirement" flag says nothing about an application (ADR 0037).
  const saysAnyoneCanJoin = club.joining.access === "open";
  const applyCycle =
    linkBar.apply && club.currentCycle?.applicationUrl === linkBar.apply.url ? club.currentCycle : null;
  const sparse = !club.isFixture && isSparseClub(club) && !club.longDescription;
  // Non-College scope is worth saying up front (a law-school clinic isn't a College club);
  // College groups get no pill, and unknown stays silent (ADR 0038).
  const scopePill = scopeLabel(club.affiliationScope, f["club.affiliation_scope"], f["club.school"]);
  // An organization a source says ended (ADR 0038): kept for reference, no joining actions.
  const ended = club.activityStatus === "defunct";
  const aliases = distinctAliases(club);
  const lifecycle = f["club.lifecycle"];
  const successorId =
    lifecycle?.kind === "single"
      ? (lifecycle.current.value as { successorClubId?: string | null }).successorClubId
      : null;
  const successorClub = successorId ? index.clubs.find((c) => c.id === successorId) : undefined;
  const sourceDates = club.sources.map((s) => s.lastObservedAt).sort();

  return (
    <article className="space-y-8">
      {club.isFixture ? null : <ClubJsonLd club={club} />}
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
            <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance break-words sm:text-3xl">
              {club.name}
              {club.acronym && !club.name.includes(club.acronym) ? (
                <span className="ml-2 align-baseline text-base font-normal text-stone-500 sm:text-lg dark:text-stone-400">
                  {club.acronym}
                </span>
              ) : null}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {club.isFixture ? <DemoPill /> : null}
              {ended ? (
                <Pill tone="amber" title="A source says this organization ended">
                  No longer active
                </Pill>
              ) : ["possibly_dormant", "inactive"].includes(club.activityStatus) ? (
                <Pill tone="amber" title="Estimated from how recently we've seen the club active online">
                  {ACTIVITY_STATUS_LABEL[club.activityStatus]}
                </Pill>
              ) : null}
              {scopePill ? <Pill title={scopePill.title}>{scopePill.label}</Pill> : null}
              {club.orgType ? <Pill>{ORG_TYPE_LABEL[club.orgType]}</Pill> : null}
              {club.recognitionStatus === "recognized" ? (
                <Pill tone="green" title="Listed as a recognized student organization by a Harvard office">
                  {RECOGNITION_STATUS_LABEL[club.recognitionStatus]}
                </Pill>
              ) : club.recognitionStatus !== "unknown" ? (
                <Pill>{RECOGNITION_STATUS_LABEL[club.recognitionStatus]}</Pill>
              ) : null}
              {displayCategories(club, parentOf).map((c) => (
                <Link key={c.slug} href={`/categories/${c.slug}/`} className="hc-tag-button">
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
          {club.isFixture ? null : (
            <div className="hidden gap-2 sm:flex">
              <SaveToggle slug={club.slug} name={club.name} variant="button" />
              <CompareToggle slug={club.slug} variant="button" />
            </div>
          )}
        </div>
        <div className="mt-3 space-y-3 sm:pl-[4.5rem]">
          {club.shortDescription || aliases.length > 0 ? (
            <div className="max-w-2xl">
              {club.shortDescription ? (
                <p className="text-stone-700 text-pretty dark:text-stone-300">{club.shortDescription}</p>
              ) : null}
              {aliases.length > 0 ? (
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  {aliases.some((a) => a.kind === "former") ? "Also known as / formerly" : "Also known as"}{" "}
                  {aliases.map((a) => a.alias).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
          {ended ? (
            <EndedNotice
              name={club.name}
              field={lifecycle}
              successor={successorClub ? { slug: successorClub.slug, name: successorClub.name } : null}
            />
          ) : club.isFixture ? null : (
            <JoinStatusLine cycle={club.currentCycle} joining={club.joining} seasons={seasons} />
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <LinkBar
              bar={linkBar}
              fixture={club.isFixture}
              applySlot={
                linkBar.apply && !ended ? (
                  <ApplyLink
                    url={linkBar.apply.url}
                    label={linkBar.apply.label}
                    cycle={applyCycle}
                    open={saysAnyoneCanJoin}
                    fixture={club.isFixture}
                  />
                ) : null
              }
            />
            {club.isFixture ? null : (
              <div className="flex gap-2 sm:hidden">
                <SaveToggle slug={club.slug} name={club.name} variant="button" />
                <CompareToggle slug={club.slug} variant="button" />
              </div>
            )}
          </div>
          {sparse ? <KnownByName club={club} /> : null}
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-8">
          {ended ? null : <HowToJoin club={club} now={now} />}

          {indexed && !ended && (selective || club.cycles.length > 0) ? (
            <Alternatives
              candidates={alternativeCandidates(indexed, index)}
              self={slimClub(indexed)}
              ownCycle={club.currentCycle}
              selective={selective}
            />
          ) : null}

          {hasSelectivitySection ? (
            <section>
              <SectionHeading>Selectivity</SectionHeading>
              {selfDescribed && f["club.self_described_selectivity"]?.kind === "single" ? (
                <div className="mb-3 text-sm">
                  <span className="text-stone-500">In the club&apos;s words: </span>
                  <span className="italic">“{selfDescribed}”</span>
                  <p className="mt-1 text-xs text-stone-500">Quoted from the club; not a measured acceptance rate.</p>
                </div>
              ) : null}
              {club.selectivity ? (
                <div className="rounded-lg border border-stone-200 p-4 text-sm dark:border-stone-800">
                  <dl className="divide-y divide-stone-100 dark:divide-stone-800">
                    <Row label="Applicants">
                      <span className="tabular">{club.selectivity.applicants.value}</span>
                    </Row>
                    <Row label="Admitted">
                      <span className="tabular">{club.selectivity.admits.value}</span>
                    </Row>
                    <Row label="Acceptance">
                      <span className="tabular font-medium">{formatPercent(club.selectivity.acceptanceRate)}</span>
                      <span className="text-xs text-stone-500"> · computed from the two numbers above</span>
                    </Row>
                    {club.selectivity.label ? (
                      <Row label="Classification">{SELECTIVITY_LABEL[club.selectivity.label]}</Row>
                    ) : null}
                  </dl>
                  <p className="mt-2 text-xs text-stone-500">
                    From {formatTerm(club.selectivity.termKey)} applicant and admit numbers. Past cycles may not predict
                    future ones.
                  </p>
                </div>
              ) : selective ? (
                <p className="text-sm text-stone-500">
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
                <p className="max-w-prose leading-relaxed text-stone-700 dark:text-stone-300">
                  {spaceSentences(club.longDescription)}
                </p>
              ) : null}
              {activities.length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-xs font-medium text-stone-500">What members do</h3>
                  <ul className="mt-1 max-w-prose list-disc space-y-0.5 pl-5 text-sm text-stone-700 marker:text-stone-300 dark:text-stone-300 dark:marker:text-stone-600">
                    {activities.slice(0, 8).map((a) => (
                      <li key={a}>{capitalize(a)}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {mission && f["club.mission"]?.kind === "single" && !club.longDescription?.includes(mission.trim()) ? (
                <div className="mt-4 space-y-1">
                  <h3 className="text-xs font-medium text-stone-500">Mission, in their words</h3>
                  <p className="max-w-prose text-sm leading-relaxed text-stone-700 dark:text-stone-300">{mission}</p>
                </div>
              ) : null}
              {sponsors.length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-xs font-medium text-stone-500">Sponsors &amp; partners</h3>
                  <p className="mt-1 text-sm text-stone-700 dark:text-stone-300">
                    {sponsors.map((x) => String(x.value)).join(" · ")}
                  </p>
                </div>
              ) : null}
              {tags.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Link
                      key={t}
                      href={`/clubs?q=${encodeURIComponent(t)}`}
                      className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700"
                    >
                      {capitalize(t)}
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
              <SectionHeading>Membership over time</SectionHeading>
              <ul className="space-y-1 text-sm">
                {club.membership.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="tabular w-24">
                      {m.kind === "exact" ? m.count : formatRange({ min: m.min, max: m.max })}
                    </span>
                    <span className="text-stone-500">
                      {m.termKey ? formatTerm(m.termKey) : m.asOf ? `as of ${formatDate(m.asOf)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {indexed ? <SimilarClubs club={indexed} clubs={index.clubs} categories={index.categories} /> : null}

          <SuggestUpdate
            clubName={club.name}
            clubSlug={club.slug}
            missing={[
              ...(club.currentCycle ? [] : (["deadline"] as const)),
              ...(f["club.join_mode"] ? [] : (["joining_process"] as const)),
              ...(f["club.hours_per_week"] ? [] : (["time_commitment"] as const)),
              ...(f["club.member_count"] ? [] : (["member_count"] as const)),
              ...(f["club.dues"] ? [] : (["dues"] as const)),
              ...(f["club.freshmen_eligible"] || f["club.eligibility_note"] || club.eligibleClasses?.length
                ? []
                : (["eligibility"] as const)),
              ...(club.links.some((l) => l.kind === "website") ? [] : (["website"] as const)),
              ...(club.links.some((l) => l.kind === "instagram") ? [] : (["instagram"] as const)),
              ...(club.currentCycle?.applicationUrl ||
              club.links.some((l) => l.kind === "application_form" || l.kind === "application_page")
                ? []
                : (["application_link"] as const)),
            ]}
          />
        </div>

        <div id="at-a-glance" className="scroll-mt-20 max-lg:order-first lg:sticky lg:top-18 lg:self-start">
          {ended ? null : <AtAGlance club={club} travel={travel} />}
        </div>
      </div>

      {club.sources.length > 0 ? (
        <details
          id="sources"
          className="group scroll-mt-20 border-t border-stone-100 pt-4 text-sm dark:border-stone-800"
        >
          <summary className="-my-2 inline-flex cursor-pointer items-center gap-1.5 py-2 text-xs font-medium text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100">
            <span aria-hidden className="transition-transform group-open:rotate-90">
              ›
            </span>
            Sources ({club.sources.length})
            {sourceDates.length ? (
              <span className="font-normal"> · last checked {formatDate(sourceDates[sourceDates.length - 1])}</span>
            ) : null}
          </summary>
          <p className="mt-2 max-w-2xl text-xs text-stone-500 dark:text-stone-400">
            Every fact on this page comes from one of these pages (or a reviewed student report). When sources disagree,
            the more official, more recent one is shown.{" "}
            <Link href="/about/methodology/" className="underline underline-offset-2">
              How hclubs knows this
            </Link>
          </p>
          <ul className="mt-2 space-y-2 text-xs sm:space-y-1">
            {club.sources.map((s) => (
              <li key={s.id} className="hc-glance-row">
                <span className="min-w-0 truncate py-0.5 sm:py-0">
                  <ExternalLink href={s.url} fixture={s.isFixture}>
                    {s.title ?? s.url}
                  </ExternalLink>
                </span>
                <span className="shrink-0 text-stone-500 dark:text-stone-400">
                  {SOURCE_KIND[s.sourceType]} · seen {formatDate(s.lastObservedAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

/** Header pill for a group outside the College, e.g. "Harvard Law School group". */
function scopeLabel(
  scope: string,
  scopeField: StoredField | undefined,
  schoolField: StoredField | undefined,
): { label: string; title: string } | null {
  if (scope === "unknown" || scope === "harvard_college") return null;
  const schools =
    schoolField?.kind === "multi"
      ? schoolField.values.map((v) => v.value as HarvardSchool).filter((v) => v !== "college")
      : [];
  const estimated = scopeField?.kind === "single" && scopeField.current.assertionKind === "inferred";
  const why = estimated
    ? "Estimated: the group's site is hosted by the school"
    : "A source describes who the group is for";
  if (scope === "graduate_school")
    return {
      label:
        schools.length === 1 ? `${HARVARD_SCHOOL_LABEL[schools[0] as HarvardSchool]} group` : "Graduate-school group",
      title: why,
    };
  return { label: AFFILIATION_SCOPE_LABEL[scope as AffiliationScope], title: why };
}

/** Where a source says the club appears, in words a student recognizes. */
function sourcePhrase(s: ClubProfile["sources"][number]): string {
  let host = "";
  try {
    host = new URL(s.url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  if (host === "soco.college.harvard.edu") return "the College's student-organization directory";
  if (host.endsWith("wikipedia.org")) return "Wikipedia's list of Harvard organizations";
  if (s.sourceType === "harvard_official") return `a Harvard page (${host})`;
  return s.title ? `“${s.title}”` : host || SOURCE_KIND[s.sourceType];
}

/**
 * A club we know by name only (ADR 0038): say plainly where its name comes from and what
 * is missing, and make the most useful additions one tap away. No filler.
 */
function KnownByName({ club }: { club: ClubProfile }) {
  // Listings, not news: articles have their own section and aren't where a name "comes from".
  const listings = club.sources.filter(
    (s) => s.sourceType !== "harvard_crimson" && s.sourceType !== "harvard_related_other" && !isSearchSource(s),
  );
  const where = [...new Set(listings.map(sourcePhrase))].slice(0, 2);
  const seen = listings
    .map((s) => s.lastObservedAt)
    .sort()
    .at(-1);
  const unconfirmed = club.links.some((l) => l.status === "unverified" && l.kind !== "email");
  const ask: [ContributionType, string][] = [
    ["website", "Its website or Instagram"],
    ["missing_info", "What it does"],
    ["joining_process", "How to join"],
    ["inactive", "It's inactive or was renamed"],
  ];
  return (
    <section
      aria-labelledby="known-by-name"
      className="max-w-2xl rounded-lg border border-dashed border-stone-300 px-3 py-3 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-400"
    >
      <h2 id="known-by-name" className="font-medium text-stone-900 dark:text-stone-100">
        Known by name only, so far
      </h2>
      <p className="mt-1">
        {where.length ? <>It appears in {where.join(" and ")}</> : <>We know this organization exists</>}
        {seen ? ` (checked ${formatDate(seen)})` : ""}, but we haven&apos;t found a public description or an official
        link yet. That isn&apos;t a sign it&apos;s inactive.
        {unconfirmed ? " Any links shown here were found by name and aren't confirmed as the club's own." : null}
      </p>
      <p className="mt-2 font-medium text-stone-900 dark:text-stone-100">Know this club? Add:</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {ask.map(([type, label]) => (
          <li key={type}>
            <ContributeLink
              club={{ name: club.name, slug: club.slug }}
              type={type}
              className="inline-flex min-h-11 items-center text-stone-900 underline sm:min-h-9 decoration-stone-400 underline-offset-2 dark:text-stone-100"
            >
              {label}
            </ContributeLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
