import type { Metadata } from "next";
import { getStaticIndex } from "@hci/db";
import { completenessTier } from "@hci/db/local";
import { ContributeList, type ContributeItem } from "@/components/contribute-list";
import { NO_PERSONAL_INFO, contributeHref, missingClubHref } from "@/components/suggest-update";
import { db } from "@/lib/db";
import { pluralize } from "@/lib/format";
import { pageMetadata } from "@/lib/meta";

export const metadata: Metadata = pageMetadata({
  title: "Help fill in hclubs",
  description: "Harvard student clubs we know little about. Add a club's Instagram, website or what it does.",
  path: "/contribute/",
});

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * Clubs that need help, by completeness tier (ADR 0032): "name only" (nothing beyond the
 * College directory's listing) and "sparse" with no description or official channel. Each
 * links to the prefilled contribution form; a person reviews every response before it
 * becomes a claim (CLAUDE.md §14, ADR 0027).
 */
export default async function ContributePage() {
  const index = await getStaticIndex(db(), new Date());
  const bySlug = new Map(index.categories.map((cat) => [cat.slug, cat]));
  const topName = (slug: string): string | null => {
    const cat = bySlug.get(slug);
    if (!cat) return null;
    return cat.parentSlug ? topName(cat.parentSlug) : cat.name;
  };
  const items: ContributeItem[] = index.clubs
    .filter((c) => !c.isFixture)
    .map((c) => ({ c, tier: completenessTier(c) }))
    .filter(
      ({ c, tier }) =>
        tier === "name_only" ||
        (tier === "sparse" && !c.shortDescription && !c.quickLinks?.website && !c.quickLinks?.instagram),
    )
    .map(({ c, tier }) => {
      const first = c.categories[0];
      const target = contributeHref(c, "missing_info");
      return {
        slug: c.slug,
        name: c.name,
        category: (first ? topName(first.slug) : null) ?? "Other",
        nameOnly: tier === "name_only",
        hasNews: (c.pressCount ?? 0) > 0,
        href: target?.href ?? null,
        external: target?.external ?? false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const nameOnly = items.filter((i) => i.nameOnly).length;
  const missing = missingClubHref();

  return (
    <div className="space-y-6">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Help fill in hclubs</h1>
        <p className="text-zinc-700 dark:text-zinc-300">
          We have no description, website or Instagram for {pluralize(items.length, "club")} (
          {pluralize(nameOnly, "club")} we know only by name). We searched club sites, Harvard pages and the web and
          couldn&apos;t find anything we could confirm. Students who know these clubs can fill the gap in a minute.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            <strong className="font-medium text-zinc-800 dark:text-zinc-200">Add info</strong> opens a short form with
            the club already filled in. Answer only what you know: what it does, its website or Instagram, how to join.
          </li>
          <li>A person checks every answer before it appears, and it&apos;s shown as student-reported.</li>
          <li>A link to where you saw it helps us confirm it, but it isn&apos;t required.</li>
          <li>{NO_PERSONAL_INFO}</li>
        </ul>
        {missing ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Missing a club entirely?{" "}
            <a
              href={missing.href}
              {...(missing.external ? external : {})}
              className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Tell us
            </a>
            .
          </p>
        ) : null}
      </header>
      <ContributeList items={items} />
    </div>
  );
}
