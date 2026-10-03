import Link from "next/link";
import type { ReactNode } from "react";
import { clubReference, contributionTemplate, contributionType, type ContributionType } from "@hci/core";
import { TOPIC_LABEL, planContributions } from "@/lib/contribute-topics";
import { contactEmail, contributeFormUrl, fillFormUrl, mailtoHref } from "@/lib/site";

export const NO_PERSONAL_INFO = "Please don't include anyone's name, email or phone number, yours or a member's.";

/**
 * Where a visitor sends an addition or correction for a club: the feedback form with the
 * club, the kind of update and a short answer template prefilled (ADR 0035), or an email.
 * Nothing a visitor sends changes the data directly; a person reviews each answer and
 * records it as a claim with its source (CLAUDE.md §14).
 */
export function contributeHref(
  club: { name: string; slug: string },
  type: ContributionType = "other",
): { href: string; external: boolean } | null {
  const def = contributionType(type);
  const details = contributionTemplate(type);
  const form = contributeFormUrl();
  if (form)
    return {
      href: fillFormUrl(form, club, { clubref: clubReference(club), type: def.formOption, details }),
      external: true,
    };
  const email = contactEmail();
  if (!email) return null;
  const body = [
    `Club: ${clubReference(club)}`,
    `Update: ${def.label}`,
    "",
    details || "What should we add or fix?",
    "",
    "Source link (a page, post or form that shows it), if you have one:",
    "",
    NO_PERSONAL_INFO,
  ].join("\n");
  return { href: mailtoHref(email, `${def.label}: ${club.name}`, body), external: false };
}

/** The form preset to "A club that's missing from hclubs", with no club filled in. */
export function missingClubHref(): { href: string; external: boolean } | null {
  const form = contributeFormUrl();
  const def = contributionType("missing_club");
  if (form)
    return {
      href: fillFormUrl(
        form,
        { name: "", slug: "" },
        { clubref: "", type: def.formOption, details: contributionTemplate("missing_club") },
      ),
      external: true,
    };
  const email = contactEmail();
  return email
    ? {
        href: mailtoHref(
          email,
          "A club that's missing from hclubs",
          `${contributionTemplate("missing_club")}\n\n${NO_PERSONAL_INFO}`,
        ),
        external: false,
      }
    : null;
}

/** The site's suggest form for a club, opened on one topic (or null when nothing can receive it). */
export function suggestHref(club: { slug: string }, type: ContributionType = "other"): string | null {
  if (!contributeFormUrl() && !contactEmail()) return null;
  return `/suggest?club=${encodeURIComponent(club.slug)}&topic=${type}`;
}

export function ContributeLink({
  club,
  type,
  className,
  children,
}: {
  club: { name: string; slug: string };
  type?: ContributionType;
  className?: string;
  children: ReactNode;
}) {
  // Officers get the structured update form (ADR 0045); everyone else the suggest form, on its topic.
  const href = type === "club_manager" ? `/for-clubs?club=${club.slug}` : suggestHref(club, type);
  if (!href) return null;
  return (
    <Link href={href} className={className} data-track="contribute-click">
      {children}
    </Link>
  );
}

const chip = "hc-chip";
const groupLabel = "text-xs font-medium tracking-wide text-stone-500 uppercase sm:w-14 sm:shrink-0 sm:pt-2 dark:text-stone-400";

/**
 * "Help improve this page" at the end of a profile: every topic of the contribution form,
 * as chips that open the site's suggest form on that topic. Facts the page lacks lead the
 * "Add" row, marked with a plus.
 */
export function SuggestUpdate({
  clubName,
  clubSlug,
  missing = [],
}: {
  clubName: string;
  clubSlug: string;
  /** Contribution types whose information the page lacks. */
  missing?: ContributionType[];
}) {
  const club = { name: clubName, slug: clubSlug };
  if (!suggestHref(club)) return null;
  const { add, fixes } = planContributions(missing);
  return (
    <section
      id="improve"
      aria-labelledby="improve-heading"
      className="scroll-mt-20 space-y-3 border-t border-stone-100 pt-4 dark:border-stone-800"
    >
      <div className="space-y-1">
        <h2 id="improve-heading" className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          Help improve this page
        </h2>
        <p className="max-w-2xl text-sm text-stone-600 dark:text-stone-400">
          Know something about this club? Pick a topic. A person checks every answer before it appears.
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
          <p id="improve-add" className={groupLabel}>
            Add
          </p>
          <ul className="flex flex-wrap gap-2" aria-labelledby="improve-add">
            {add.map(({ type, missing: gap }) => (
              <li key={type}>
                <ContributeLink club={club} type={type} className={chip}>
                  {gap ? (
                    <span aria-hidden="true" className="text-accent">
                      +
                    </span>
                  ) : null}
                  {TOPIC_LABEL[type]}
                  {gap ? <span className="sr-only"> (not on this page yet)</span> : null}
                </ContributeLink>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
          <p id="improve-fix" className={groupLabel}>
            Report
          </p>
          <ul className="flex flex-wrap gap-2" aria-labelledby="improve-fix">
            {fixes.map((type) => (
              <li key={type}>
                <ContributeLink club={club} type={type} className={chip}>
                  {TOPIC_LABEL[type]}
                </ContributeLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="text-sm text-stone-600 dark:text-stone-400">
        Run this club?{" "}
        <ContributeLink club={club} type="club_manager" className="hc-link">
          Update its page
        </ContributeLink>
      </p>
    </section>
  );
}
