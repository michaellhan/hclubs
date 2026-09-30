import type { Metadata } from "next";
import Link from "next/link";
import { SOURCE_TYPE_LABEL, type SourceType } from "@hci/core";
import { getIndexStats, getSourceSummary } from "@hci/db";
import { ContactLine, Prose } from "@/components/prose";
import { db } from "@/lib/db";
import { formatDate, pluralize } from "@/lib/format";
import { contactEmail, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: "What Harvard Club Index is, where its data comes from, and how to reach us.",
};

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
        We currently index {pluralize(stats.clubs, "organization")}. Organizations are discovered from public Harvard
        directories and department pages, then enriched from each club&apos;s own public website when a Harvard page or
        the club itself links to it.
      </p>
      {sources.directories.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 uppercase dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">Pages</th>
                <th className="px-3 py-2 font-medium">Last checked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {sources.directories.map((s) => (
                <tr key={s.publisher}>
                  <td className="px-3 py-2">{s.publisher}</td>
                  <td className="px-3 py-2 text-zinc-500">
                    {SOURCE_TYPE_LABEL[s.sourceType as SourceType] ?? s.sourceType}
                  </td>
                  <td className="tabular px-3 py-2 text-right">{s.pages}</td>
                  <td className="tabular px-3 py-2 text-zinc-500">
                    {s.lastFetchedAt ? formatDate(s.lastFetchedAt) : "—"}
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
        We don&apos;t log in to anything. Harvard&apos;s own student-organization directory requires HarvardKey, so we
        don&apos;t use it. We also don&apos;t scrape Instagram, LinkedIn, or other social platforms. We only link to a
        club&apos;s accounts when an official page does. Read the full{" "}
        <Link href="/about/methodology">methodology</Link> or how our <Link href="/about/bot">crawler</Link> behaves.
      </p>

      <h2>What we don&apos;t publish</h2>
      <ul>
        <li>Member rosters, officer names, or personal contact details.</li>
        <li>Acceptance rates we can&apos;t source. A rate appears only when a club published its own numbers.</li>
        <li>&ldquo;Prestige&rdquo; rankings of any kind.</li>
      </ul>

      <h2>Corrections and removal requests</h2>
      <p>
        Many profiles are still sparse, and gaps show as &ldquo;Not yet known&rdquo; rather than a guess. Each club page
        has a <em>Share what you know</em> button (recruiting dates, how to join, comp stages, time commitment, size,
        dues, with a source link if you have one) and a <em>Suggest a correction</em> link. Club officers can use{" "}
        <em>Run this club? Update your page</em>; we confirm through the club&apos;s official email or website first. A
        person reviews every submission and records it with its source before anything changes. Anyone who wants
        information corrected or removed, or has a legal or privacy concern, can contact{" "}
        <ContactLine email={email} subject={`${SITE_NAME}: correction or removal`} />. Removals are logged.
      </p>
      {stats.lastObservedAt ? (
        <p className="text-sm text-zinc-500">Data last observed {formatDate(stats.lastObservedAt)}.</p>
      ) : null}
    </Prose>
  );
}
