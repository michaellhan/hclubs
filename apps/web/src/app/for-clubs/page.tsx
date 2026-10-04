import type { Metadata } from "next";
import { Suspense } from "react";
import { getStaticIndex } from "@hci/db";
import { OfficerForm, type OfficerClub } from "@/components/officer-form";
import { NO_PERSONAL_INFO } from "@/components/suggest-update";
import { db } from "@/lib/db";
import { pageMetadata } from "@/lib/meta";
import { clubManagerFormUrl, contactEmail, contributeFormUrl } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "For club officers",
  description:
    "Run a Harvard club? Tell students how to join, when you recruit and how much time it takes. A person reviews every update.",
  path: "/for-clubs/",
});

/**
 * Club officers' update form (ADR 0045). The site is static, so answers go to the same
 * external form as other contributions, as "Label: value" lines the importer turns into
 * per-field proposals for review (ADR 0035). Nothing here writes data.
 */
export default async function ForClubsPage() {
  const index = await getStaticIndex(db(), new Date());
  const clubs: OfficerClub[] = index.clubs
    .filter((c) => !c.isFixture)
    .map((c) => {
      const j = c.joining;
      const missing = [
        !j?.general.length && !j?.access ? "how members join" : null,
        j?.firstYears == null ? "whether first-years can join" : null,
        c.hoursPerWeek ? null : "hours per week",
        j?.dues == null ? "dues" : null,
        c.recruitingSeasons?.length ? null : "when you recruit",
        c.memberCount ? null : "size",
        c.quickLinks?.website ? null : "website",
      ].filter((m): m is string => m !== null);
      return { slug: c.slug, name: c.name, acronym: c.acronym, missing };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">For club officers</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Students use hclubs to decide which clubs to try and how to join them. Most clubs&apos; pages don&apos;t say
          how members join, when you recruit or how much time it takes, so neither can we. Tell us, and your club&apos;s
          page will say it.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600 dark:text-stone-400">
          <li>Answer only what you know; every question is optional.</li>
          <li>
            A person reviews every update before it appears. Updates show fastest when you link a page or post that says
            the same thing.
          </li>
          <li>{NO_PERSONAL_INFO}</li>
        </ul>
      </header>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-900" />}>
        <OfficerForm clubs={clubs} formTemplate={clubManagerFormUrl() ?? contributeFormUrl()} email={contactEmail()} />
      </Suspense>
    </div>
  );
}
