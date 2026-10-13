"use client";

import { useState } from "react";

/** Copies the current page URL (filters, search, compare set) for sharing. */
export function CopyLink({
  label = "Copy link",
  className,
  iconOnly = false,
}: {
  label?: string;
  className?: string;
  /** Just the link glyph (the label is the accessible name and tooltip). */
  iconOnly?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <>
      {state !== "idle" ? (
        // Touch screens never show data-tip: say it where it can be seen.
        <span
          aria-hidden
          className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full bg-stone-900 px-4 py-2 text-sm text-stone-50 shadow-lg dark:bg-stone-100 dark:text-stone-900"
        >
          {state === "copied" ? "Link copied" : "Couldn\u2019t copy"}
        </span>
      ) : null}
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2000);
      }}
      aria-label={iconOnly ? label : undefined}
      data-tip={iconOnly ? (state === "copied" ? "Copied" : label) : undefined}
      className={
        className ??
        (iconOnly
          ? "inline-flex size-11 items-center justify-center rounded-full text-stone-600 hover:bg-stone-50 hover:text-stone-900 sm:size-8 dark:text-stone-400 dark:hover:bg-stone-900 dark:hover:text-stone-100"
          : "inline-flex min-h-11 items-center gap-1 rounded-full border border-stone-200 px-3 text-xs sm:min-h-7 sm:px-2.5 text-stone-600 hover:border-stone-400 hover:text-stone-900 dark:border-stone-700 dark:text-stone-400 dark:hover:text-stone-100")
      }
    >
      <svg aria-hidden viewBox="0 0 20 20" className="size-3.5 fill-current">
        <path d="M12.6 3.4a3.5 3.5 0 0 1 4.95 4.95l-2.12 2.12a3.5 3.5 0 0 1-4.95 0 .75.75 0 0 1 1.06-1.06 2 2 0 0 0 2.83 0l2.12-2.12a2 2 0 1 0-2.83-2.83l-.7.7a.75.75 0 1 1-1.06-1.06l.7-.7ZM7.4 8.6a2 2 0 0 0-2.83 0L2.45 10.7a2 2 0 1 0 2.83 2.83l.7-.7a.75.75 0 1 1 1.06 1.06l-.7.7a3.5 3.5 0 0 1-4.95-4.95L3.5 7.53a3.5 3.5 0 0 1 4.95 0 .75.75 0 0 1-1.06 1.06Z" />
      </svg>
      {iconOnly ? (
        <span role="status" className="sr-only">
          {state === "copied" ? "Link copied" : state === "failed" ? "Copy failed" : ""}
        </span>
      ) : (
        <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}</span>
      )}
    </button>
    </>
  );
}
