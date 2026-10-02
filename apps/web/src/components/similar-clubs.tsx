import Link from "next/link";
import { similarClubs, type CategoryWithCount, type IndexClub } from "@hci/db/local";
import { ClubLogo } from "./club-logo";
import { CompareToggle } from "./compare-tray";
import { SectionHeading } from "./ui";

/**
 * "Similar clubs" on a profile (ADR 0034): a fixed score over shared categories, topics,
 * name words, description words and the joining model (`similarClubs`). Same for every visitor.
 */
export function SimilarClubs({
  club,
  clubs,
  categories,
}: {
  club: IndexClub;
  clubs: readonly IndexClub[];
  categories: CategoryWithCount[];
}) {
  const byslug = new Map(categories.map((c) => [c.slug, c]));
  const similar = similarClubs(club, clubs, { limit: 5, isLeaf: (s) => !categories.some((c) => c.parentSlug === s) });
  if (!similar.length) return null;
  const compareHref = `/compare?clubs=${[club.slug, ...similar.slice(0, 3).map((s) => s.club.slug)].join(",")}`;
  return (
    <section aria-labelledby="similar-clubs">
      <SectionHeading
        aside={
          <Link
            href={compareHref}
            className="-my-2 inline-block py-2 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
          >
            Compare these →
          </Link>
        }
      >
        <span id="similar-clubs">Similar clubs</span>
      </SectionHeading>
      <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
        {similar.map(({ club: c, reasons }) => {
          const why = reasons.map((r) =>
            r.startsWith("cat:") ? `Also ${byslug.get(r.slice(4))?.name ?? r.slice(4)}` : r,
          );
          return (
            <li key={c.id} className="hc-row">
              <ClubLogo name={c.name} src={c.logo} size="sm" />
              <div className="min-w-0 flex-1">
                <Link href={`/clubs/${c.slug}`} prefetch={false} className="hc-row-title">
                  {c.name}
                </Link>
                {c.shortDescription ? (
                  <p className="line-clamp-1 text-xs text-stone-600 dark:text-stone-400">{c.shortDescription}</p>
                ) : null}
                {why.length ? <p className="text-[11px] text-stone-500">{why.join(" · ")}</p> : null}
              </div>
              <CompareToggle slug={c.slug} />
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 text-[11px] text-stone-500 dark:text-stone-400">
        Picked by shared categories, topics, names and descriptions — the same for everyone.
      </p>
    </section>
  );
}
