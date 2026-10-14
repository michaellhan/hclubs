import Link from "next/link";
import type { ReactNode } from "react";
import { clubReference, contributionTemplate, contributionType, type ContributionType } from "@hci/core";
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
  return `/feedback?club=${encodeURIComponent(club.slug)}&topic=${type}`;
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

/**
 * The profile's quiet closing line: one way to add or fix something (the suggest form lists
 * every topic) and the officer form. `#improve` links from the page land here.
 */
export function ImproveLine({ clubName, clubSlug }: { clubName: string; clubSlug: string }) {
  const club = { name: clubName, slug: clubSlug };
  if (!suggestHref(club)) return null;
  return (
    <p
      id="improve"
      className="flex scroll-mt-20 flex-wrap items-center gap-x-3 text-sm text-stone-500 dark:text-stone-400"
    >
      {/* No topic: the form opens on its list of every kind of update. */}
      <Link
        href={`/feedback?club=${encodeURIComponent(clubSlug)}`}
        className="hc-link-muted inline-flex min-h-11 items-center py-1 sm:min-h-6"
        data-track="contribute-click"
      >
        Suggest an update
      </Link>
      <span aria-hidden>·</span>
      <ContributeLink club={club} type="club_manager" className="hc-link-muted inline-flex min-h-11 items-center py-1 sm:min-h-6">
        I run this club
      </ContributeLink>
    </p>
  );
}
