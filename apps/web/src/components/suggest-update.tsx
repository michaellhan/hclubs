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
  const target = contributeHref(club, type);
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

/** Facts a student can add when the page lacks them, most useful first. */
const ADDABLE: ContributionType[] = [
  "deadline",
  "joining_process",
  "time_commitment",
  "member_count",
  "dues",
  "eligibility",
  "application_link",
  "website",
  "instagram",
];
/** Corrections and changes, offered on every profile. */
const FIXES: ContributionType[] = [
  "incorrect_info",
  "website",
  "instagram",
  "inactive",
  "renamed",
  "duplicate",
  "club_manager",
  "other",
];
const ADD_LABEL: Partial<Record<ContributionType, string>> = {
  deadline: "Recruiting deadline",
  joining_process: "How to join",
  time_commitment: "Time commitment",
  member_count: "Member count",
  dues: "Dues",
  eligibility: "Who can join",
  application_link: "Application link",
  website: "Website",
  instagram: "Instagram",
};
const FIX_LABEL: Partial<Record<ContributionType, string>> = {
  incorrect_info: "Something is wrong",
  website: "New website",
  instagram: "New Instagram",
  inactive: "Club seems inactive",
  renamed: "Club was renamed",
  duplicate: "Listed twice",
  club_manager: "I run this club",
  other: "Something else",
};

const chip = "hc-chip";
const textLink = "hc-chip-text";

/**
 * "Help improve this page" at the end of a profile: prefilled form links. Facts the page
 * lacks are offered as "add" chips; corrections sit in one quiet row of links.
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
  if (!contributeHref(club)) return null;
  const gaps = new Set(missing);
  const adds = ADDABLE.filter((t) => gaps.has(t));
  // A link the page lacks is offered once, as an addition.
  const fixes = FIXES.filter((t) => !gaps.has(t));
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
          Know something about this club? Pick a topic and a short form opens with the club filled in. A person checks
          every answer before it appears.
        </p>
      </div>
      {adds.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Add missing information">
          {adds.map((t) => (
            <li key={t}>
              <ContributeLink club={club} type={t} className={chip}>
                <span aria-hidden="true" className="text-accent">
                  +
                </span>
                {ADD_LABEL[t]}
              </ContributeLink>
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-wrap gap-x-4" aria-label="Correct or update">
        {fixes.map((t) => (
          <li key={t}>
            <ContributeLink club={club} type={t} className={textLink}>
              {FIX_LABEL[t] ?? contributionType(t).label}
            </ContributeLink>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone-500 dark:text-stone-400">{NO_PERSONAL_INFO}</p>
    </section>
  );
}
