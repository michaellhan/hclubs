import {
  clubManagerFormUrl,
  contactEmail,
  contributeFormUrl,
  correctionsFormUrl,
  fillFormUrl,
  mailtoHref,
} from "@/lib/site";

/** Anchor for "Share what you know" links elsewhere on the profile. */
export const CONTRIBUTE_ANCHOR = "contribute";

const NO_PERSONAL_INFO = "Please don't include personal information about members (names, emails, phone numbers).";

function contributeBody(clubName: string, clubSlug: string): string {
  return [
    `Club: ${clubName} (${clubSlug})`,
    "",
    "Fill in whatever you know; leave the rest blank.",
    "",
    "Recruiting term and deadline (e.g. Fall 2026, apps due Sept 12):",
    "How to join (open / application / comp / audition / tryout / invite only):",
    "Comp or application stages (e.g. application, interview, final round):",
    "Hours per week (as a member, or during the comp):",
    "Approximate number of members:",
    "Dues (amount, or none):",
    "",
    "Source (link to the club's page, post, form, or recruiting deck), if you have one:",
    "",
    NO_PERSONAL_INFO,
  ].join("\n");
}

function managerBody(clubName: string, clubSlug: string): string {
  return [
    `Club: ${clubName} (${clubSlug})`,
    "",
    "Your role in the club (e.g. president, comp director):",
    "",
    "For verification, the club's official email address or website",
    "(we'll confirm through that channel before changing anything):",
    "",
    "What should we add or update? (recruiting dates, how to join, stages, hours, size, dues, links, description)",
    "",
    NO_PERSONAL_INFO,
  ].join("\n");
}

function correctionBody(clubName: string, clubSlug: string): string {
  return [
    `Club: ${clubName} (${clubSlug})`,
    "",
    "What should change?",
    "",
    "Source (link to an official page, post, or form):",
    "",
    NO_PERSONAL_INFO,
  ].join("\n");
}

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * Contributions on the static site (no server, ADR 0022) go to a person by email or an
 * external form. Nothing a visitor sends changes the data directly: a reviewer records it
 * as a sourced claim (CLAUDE.md §14).
 */
export function SuggestUpdate({ clubName, clubSlug }: { clubName: string; clubSlug: string }) {
  const email = contactEmail();
  const club = { name: clubName, slug: clubSlug };
  const pick = (form: string | null, subject: string, body: string) =>
    form
      ? { href: fillFormUrl(form, club), isForm: true }
      : email
        ? { href: mailtoHref(email, subject, body), isForm: false }
        : null;

  const contribute = pick(contributeFormUrl(), `Info about ${clubName}`, contributeBody(clubName, clubSlug));
  const manager = pick(clubManagerFormUrl(), `Club page update: ${clubName}`, managerBody(clubName, clubSlug));
  const correction = pick(correctionsFormUrl(), `Correction: ${clubName}`, correctionBody(clubName, clubSlug));

  return (
    <section
      id={CONTRIBUTE_ANCHOR}
      aria-labelledby="contribute-heading"
      className="scroll-mt-20 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="contribute-heading" className="text-sm font-semibold">
            Know something about this club?
          </h2>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            Recruiting dates, how to join, comp stages, time commitment, size, dues. A person reviews every submission
            and adds it with its source; nothing changes automatically.
          </p>
        </div>
        {contribute ? (
          <a
            href={contribute.href}
            {...(contribute.isForm ? external : {})}
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-md bg-zinc-900 px-3.5 sm:h-9 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Share what you know
          </a>
        ) : (
          <span className="text-xs text-zinc-500">Contributions open soon</span>
        )}
      </div>
      {manager || correction ? (
        <div className="mt-3 flex flex-col gap-x-4 border-t border-zinc-200 pt-1 text-xs sm:flex-row sm:flex-wrap sm:pt-3 dark:border-zinc-800">
          {manager ? (
            <a
              href={manager.href}
              {...(manager.isForm ? external : {})}
              className="py-2 font-medium text-zinc-700 underline sm:py-0 decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900 dark:text-zinc-300 dark:decoration-zinc-600 dark:hover:decoration-zinc-100"
            >
              Run this club? Update your page
            </a>
          ) : null}
          {correction ? (
            <a
              href={correction.href}
              {...(correction.isForm ? external : {})}
              className="py-2 text-zinc-600 underline decoration-zinc-300 sm:py-0 underline-offset-2 hover:decoration-zinc-900 dark:text-zinc-400 dark:decoration-zinc-600 dark:hover:decoration-zinc-100"
            >
              Something wrong? Suggest a correction
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
