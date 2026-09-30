import type { Metadata } from "next";
import Link from "next/link";
import { getStaticIndex } from "@hci/db";
import { isSparseClub } from "@hci/db/local";
import { SectionHeading } from "@/components/ui";
import { db } from "@/lib/db";
import { pluralize } from "@/lib/format";
import { contactEmail, contributeFormUrl, feedbackFormUrl, fillFormUrl, mailtoHref } from "@/lib/site";

export const metadata: Metadata = {
  title: "Help fill in hclubs",
  description: "Harvard student clubs we only know by name. Add a club's Instagram, website or what it does.",
};

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * Clubs we know only by name (and directory category): no description and no website or
 * Instagram (`isSparseClub`). Each links to the prefilled contribution form; a person
 * reviews every response before it becomes a claim (CLAUDE.md §14, ADR 0027).
 */
export default async function ContributePage() {
  const index = await getStaticIndex(db(), new Date());
  const bare = index.clubs.filter((c) => !c.isFixture && isSparseClub(c));
  const form = contributeFormUrl();
  const email = contactEmail();
  const addHref = (club: { name: string; slug: string }) =>
    form
      ? fillFormUrl(form, club)
      : email
        ? mailtoHref(
            email,
            `Info about ${club.name}`,
            `Club: ${club.name} (${club.slug})\n\nInstagram / website:\n\nWhat the club does:\n`,
          )
        : null;
  const feedback = feedbackFormUrl();

  // Group by the club's first category so people can scan the groups they know.
  const bySlug = new Map(index.categories.map((cat) => [cat.slug, cat]));
  const topName = (slug: string): string | null => {
    const cat = bySlug.get(slug);
    if (!cat) return null;
    return cat.parentSlug ? topName(cat.parentSlug) : cat.name;
  };
  const groups = new Map<string, typeof bare>();
  for (const c of bare) {
    const first = c.categories[0];
    const key = (first ? topName(first.slug) : null) ?? "Other";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const sorted = [...groups.entries()].sort(([a], [b]) =>
    a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b),
  );

  return (
    <div className="space-y-8">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Help fill in hclubs</h1>
        <p className="text-zinc-700 dark:text-zinc-300">
          We know {pluralize(bare.length, "club")} only by name: no description, website or Instagram yet. If you know
          one, add its Instagram handle, website, or a sentence on what it does. It takes a minute, and a person checks
          every submission before it shows up.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Please don&apos;t include personal information about members.
          {feedback ? (
            <>
              {" "}
              Missing a club entirely?{" "}
              <a
                href={feedback}
                {...external}
                className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Tell us
              </a>
              .
            </>
          ) : null}
        </p>
      </header>

      {sorted.map(([group, clubs]) => (
        <section key={group}>
          <SectionHeading aside={<span className="text-xs text-zinc-500">{clubs.length}</span>}>{group}</SectionHeading>
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {clubs
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => {
                const href = addHref(c);
                return (
                  <li key={c.slug} className="flex items-center justify-between gap-3 px-3 py-2">
                    <Link
                      href={`/clubs/${c.slug}`}
                      className="min-w-0 truncate text-sm font-medium hover:underline"
                      title={c.name}
                    >
                      {c.name}
                    </Link>
                    {href ? (
                      <a
                        href={href}
                        {...(form ? external : {})}
                        className="inline-flex h-9 shrink-0 items-center rounded-md border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 sm:h-7 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                      >
                        Add info
                      </a>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
