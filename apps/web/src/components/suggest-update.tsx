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

/** Kinds of update offered on every profile, most useful first; the rest sit under "More". */
const MAIN: ContributionType[] = [
  "incorrect_info",
  "deadline",
  "joining_process",
  "time_commitment",
  "member_count",
  "dues",
  "eligibility",
  "website",
  "instagram",
  "application_link",
];
const MORE: ContributionType[] = ["inactive", "renamed", "duplicate", "club_manager", "other"];
/** Labels for kinds of update about one field. */
const ADD_LABEL: Partial<Record<ContributionType, string>> = {
  deadline: "Add recruiting deadline",
  joining_process: "Add how to join",
  time_commitment: "Add time commitment",
  member_count: "Add member count",
  dues: "Add dues",
  eligibility: "Add who can join",
  website: "Add website",
  instagram: "Add Instagram",
  application_link: "Add application link",
};

const chip =
  "inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 text-sm text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50 sm:h-8 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900";

/**
 * "Help improve this page" at the end of a profile: one prefilled link per kind of update.
 * Kinds whose field the page doesn't know yet come first, as "Add …".
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
  const main = [...MAIN.filter((t) => gaps.has(t)), ...MAIN.filter((t) => !gaps.has(t))];
  // "Add dues" when the page has none, "Update dues" when it does.
  const label = (t: ContributionType) => {
    const add = ADD_LABEL[t];
    return add ? (gaps.has(t) ? add : add.replace(/^Add /, "Update ")) : contributionType(t).label;
  };
  return (
    <section
      id="improve"
      aria-labelledby="improve-heading"
      className="scroll-mt-20 space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800"
    >
      <h2 id="improve-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Help improve this page
      </h2>
      <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
        Students know things no website says: when a club recruits, what the comp is really like, how many hours it
        takes. Pick what you know and a short form opens with this club filled in. A person checks every answer before
        it appears. A link to where you saw it helps us confirm it, but a careful estimate (&ldquo;about 40
        members&rdquo;) is useful too. {NO_PERSONAL_INFO}
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="What would you like to add or fix?">
        {main.map((t) => (
          <li key={t}>
            <ContributeLink club={club} type={t} className={chip}>
              {label(t)}
            </ContributeLink>
          </li>
        ))}
      </ul>
      <details className="text-sm text-zinc-600 dark:text-zinc-400">
        <summary className="inline-flex h-9 cursor-pointer items-center rounded-lg px-1 hover:text-zinc-900 sm:h-8 dark:hover:text-zinc-100">
          More: inactive, renamed, listed twice, I run this club
        </summary>
        <ul className="mt-2 flex flex-wrap gap-2">
          {MORE.map((t) => (
            <li key={t}>
              <ContributeLink club={club} type={t} className={chip}>
                {label(t)}
              </ContributeLink>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
