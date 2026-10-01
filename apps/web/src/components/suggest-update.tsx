import type { ReactNode } from "react";
import { contactEmail, contributeFormUrl, fillFormUrl, mailtoHref } from "@/lib/site";

const NO_PERSONAL_INFO = "Please don't include personal information about members (names, emails, phone numbers).";

function contributeBody(clubName: string, clubSlug: string): string {
  return [
    `Club: ${clubName} (${clubSlug})`,
    "",
    "What should we add or fix? (Instagram/website, what the club does, how to join, recruiting dates, time commitment, size, dues)",
    "",
    "Source (link to the club's page, post or form), if you have one:",
    "",
    "If you run this club, say so and give the club's official email so we can confirm.",
    "",
    NO_PERSONAL_INFO,
  ].join("\n");
}

/**
 * Where a visitor sends an addition or correction for a club: the feedback form with the
 * club prefilled, or an email. Nothing a visitor sends changes the data directly; a person
 * reviews it and records it as a sourced claim (CLAUDE.md §14, ADR 0027).
 */
export function contributeHref(club: { name: string; slug: string }): { href: string; external: boolean } | null {
  const form = contributeFormUrl();
  if (form) return { href: fillFormUrl(form, club), external: true };
  const email = contactEmail();
  return email
    ? { href: mailtoHref(email, `About ${club.name}`, contributeBody(club.name, club.slug)), external: false }
    : null;
}

export function ContributeLink({
  club,
  className,
  children,
}: {
  club: { name: string; slug: string };
  className?: string;
  children: ReactNode;
}) {
  const target = contributeHref(club);
  if (!target) return null;
  return (
    <a
      href={target.href}
      {...(target.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={className}
      data-track="contribute-click"
    >
      {children}
    </a>
  );
}

/** One quiet line at the end of a profile: a single place to add, fix or claim. */
export function SuggestUpdate({ clubName, clubSlug }: { clubName: string; clubSlug: string }) {
  if (!contributeHref({ name: clubName, slug: clubSlug })) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-100 pt-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <span>Missing something, or run this club?</span>
      <ContributeLink
        club={{ name: clubName, slug: clubSlug }}
        className="inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 font-medium text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50 sm:h-8 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        Suggest an edit
      </ContributeLink>
    </p>
  );
}
