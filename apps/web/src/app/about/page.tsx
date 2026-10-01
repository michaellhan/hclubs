import type { Metadata } from "next";
import Link from "next/link";
import { SOURCE_TYPE_LABEL, type SourceType } from "@hci/core";
import { getIndexStats, getSourceSummary } from "@hci/db";
import { ContactLine, Prose } from "@/components/prose";
import { db } from "@/lib/db";
import { formatDate, pluralize } from "@/lib/format";
import { contactEmail, goatcounterEndpoint, SITE_NAME } from "@/lib/site";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "About",
  description: "What hclubs is, where its data comes from, and how to reach us.",
  path: "/about/",
});

/**
 * Readable names for source groups whose publisher is an internal job name, and groups
 * that are one source under two names. Unlisted publishers show as they are.
 */
const SOURCE_DISPLAY: Record<string, { name: string; type?: string }> = {
  "curated-list": { name: "Editor's list of clubs", type: "Editorial" },
  "Harvard College SOCO": { name: "Harvard College student organization directory (saved copy)" },
  "Harvard College Student Organization Center (SOCO)": {
    name: "Harvard College student organization directory (saved copy)",
  },
  "crimson-mentions": { name: "The Harvard Crimson (articles naming a club)", type: "Student newspaper" },
  "hpr-mentions": { name: "Harvard Political Review (articles naming a club)", type: "Student publication" },
  "independent-mentions": { name: "The Harvard Independent (articles naming a club)", type: "Student newspaper" },
  "name-only-search": { name: "Web search results", type: "Public web" },
  "recruiting-search": { name: "Web search results", type: "Public web" },
  "web-discovery": { name: "Web search results", type: "Public web" },
  "web-search": { name: "Web search results", type: "Public web" },
  submissions: { name: "Student contributions (reviewed)", type: "Student submission" },
};

function sourceRows(groups: Awaited<ReturnType<typeof getSourceSummary>>["directories"]) {
  const rows = new Map<string, { name: string; type: string; pages: number; last: string | null }>();
  for (const g of groups) {
    const d = SOURCE_DISPLAY[g.publisher] ?? SOURCE_DISPLAY[g.adapter];
    const name = d?.name ?? g.publisher;
    const type = d?.type ?? SOURCE_TYPE_LABEL[g.sourceType as SourceType] ?? g.sourceType;
    const row = rows.get(name) ?? { name, type, pages: 0, last: null };
    row.pages += g.pages;
    if (g.lastFetchedAt && (!row.last || g.lastFetchedAt > row.last)) row.last = g.lastFetchedAt;
    rows.set(name, row);
  }
  return [...rows.values()];
}

export default async function AboutPage() {
  const [stats, sources] = await Promise.all([getIndexStats(db()), getSourceSummary(db())]);
  const email = contactEmail();
  return (
    <Prose>
      <h1>About {SITE_NAME}</h1>
      <p>
        {SITE_NAME} is an independent, student-built index of Harvard student organizations: what each club does, how to
        join, when applications close, and how much time it takes. Every fact links to the page it came from and the
        date we saw it. When we don&apos;t have evidence for something, we say <em>Unknown</em> rather than guess.
      </p>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        {SITE_NAME} is not affiliated with, sponsored by, or endorsed by Harvard University or Harvard College. Listing
        a club here does not mean it is officially recognized, and club information here is not official.
      </p>

      <h2>Where the data comes from</h2>
      <p>
        We currently index {pluralize(stats.clubs, "organization")}. They come from public Harvard directories and
        department pages, the College&apos;s student organization directory, web searches and student newspapers.
        Details come from each club&apos;s own public website, articles that name the club, and reviewed student
        contributions.
      </p>
      {sources.directories.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500 uppercase dark:bg-stone-900">
              <tr>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="hidden px-3 py-2 font-medium sm:table-cell">Type</th>
                <th className="px-3 py-2 text-right font-medium">Pages</th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">Last checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {sourceRows(sources.directories).map((s) => (
                <tr key={s.name}>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="hidden px-3 py-2 text-stone-500 sm:table-cell">{s.type}</td>
                  <td className="tabular px-3 py-2 text-right">{s.pages}</td>
                  <td className="tabular px-3 py-2 whitespace-nowrap text-stone-500">
                    {s.last ? formatDate(s.last) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {sources.clubSitePages > 0 ? (
        <p>
          Plus {pluralize(sources.clubSitePages, "page")} from the official websites of{" "}
          {pluralize(sources.clubsWithOwnSite, "club")}.
        </p>
      ) : null}
      <p>
        We don&apos;t log in to anything. The College&apos;s student organization directory requires HarvardKey, so our
        crawler never visits it; the club names, categories and flags we use from it come from a copy the site&apos;s
        maintainer saved by hand, without any officer names. We don&apos;t scrape Instagram, LinkedIn, or other social
        platforms. A club page links to the social accounts its website names and to accounts found through a web
        search; a searched account may not be the club&apos;s official one. Read the full{" "}
        <Link href="/about/methodology">methodology</Link> or how our <Link href="/about/bot">crawler</Link> behaves.
      </p>

      <h2>What we don&apos;t publish</h2>
      <ul>
        <li>Member rosters, officer names, or personal contact details.</li>
        <li>Acceptance rates we can&apos;t source. A rate appears only when a club published its own numbers.</li>
        <li>&ldquo;Prestige&rdquo; rankings of any kind.</li>
      </ul>
      {goatcounterEndpoint() ? (
        <p>We count page views with GoatCounter, which uses no cookies and doesn&apos;t track individuals.</p>
      ) : null}

      <h2 id="contribute">Contributions, corrections and removal requests</h2>
      <p>
        Much of what students want to know (when a club recruits, what the comp involves, how many hours it takes)
        isn&apos;t on any public page. Each club page ends with <em>Help improve this page</em>: pick what you know and
        a short form opens with the club and the question filled in. Pages we know little about are listed on{" "}
        <Link href="/contribute/">Help fill in hclubs</Link>.
      </p>
      <ul>
        <li>
          A person reviews every answer, field by field, before anything changes. Nothing is published automatically.
        </li>
        <li>
          Accepted answers are shown as student-reported. If you include a public link that states the same thing, we
          fetch that page and cite it as well.
        </li>
        <li>
          A student report never silently replaces information from a club&apos;s own pages or Harvard; when they
          disagree, both are kept and a person decides.
        </li>
        <li>
          Don&apos;t include anyone&apos;s name, email or phone number. We drop email addresses and phone numbers on
          import and never publish who sent what.
        </li>
        <li>
          Club officers can choose <em>I run this club</em>; we confirm through the club&apos;s official website or
          Instagram before using it.
        </li>
      </ul>
      <p>
        Anyone who wants information corrected or removed, or has a legal or privacy concern, can contact{" "}
        <ContactLine email={email} subject={`${SITE_NAME}: correction or removal`} />. Removals are logged.
      </p>
      {stats.lastObservedAt ? (
        <p className="text-sm text-stone-500">Data last observed {formatDate(stats.lastObservedAt)}.</p>
      ) : null}
    </Prose>
  );
}
