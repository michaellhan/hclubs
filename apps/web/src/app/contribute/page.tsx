import type { Metadata } from "next";
import Link from "next/link";
import { getStaticIndex } from "@hci/db";
import { completenessTier } from "@hci/db/local";
import { ContributeList, type ContributeItem } from "@/components/contribute-list";
import { missingClubHref, suggestHref } from "@/components/suggest-update";
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
    .map(({ c }) => {
      const first = c.categories[0];
      return {
        slug: c.slug,
        name: c.name,
        category: (first ? topName(first.slug) : null) ?? "Other",
        href: suggestHref(c, "missing_info"),
        external: false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const missing = missingClubHref();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Help fill in hclubs</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {pluralize(items.length, "club")} we know almost nothing about. Know one? Add what you know.
        </p>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          <Link
            href="/for-clubs"
            className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
          >
            Run a club?
          </Link>
          {missing ? (
            <>
              {" · "}
              <a
                href={missing.href}
                {...(missing.external ? external : {})}
                className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
              >
                Missing a club?
              </a>
            </>
          ) : null}
        </p>
      </header>
      <ContributeList items={items} />
    </div>
  );
}
