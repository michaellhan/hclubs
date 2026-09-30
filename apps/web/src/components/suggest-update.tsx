import { contactEmail, correctionsFormUrl } from "@/lib/site";

/**
 * Corrections on the static site go to a person by email (or an external form when
 * configured). Nothing a visitor sends changes the data directly: a reviewer records it
 * as a sourced claim (CLAUDE.md §14).
 */
export function SuggestUpdate({ clubName, clubSlug }: { clubName: string; clubSlug: string }) {
  const form = correctionsFormUrl();
  const email = contactEmail();
  const subject = `Correction: ${clubName}`;
  const body = [
    `Club: ${clubName} (${clubSlug})`,
    "",
    "What should change?",
    "",
    "Source (link to an official page, post, or form):",
    "",
    "Please don't include personal information about members.",
  ].join("\n");
  const href =
    form ?? (email ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null);
  return (
    <div id="suggest" className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Something out of date or missing?</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Corrections are reviewed by a person and become sourced facts. They never silently overwrite evidence.
          </p>
        </div>
        {href ? (
          <a
            href={href}
            {...(form ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Suggest a correction
          </a>
        ) : (
          <span className="text-xs text-zinc-400">Corrections open soon</span>
        )}
      </div>
    </div>
  );
}
