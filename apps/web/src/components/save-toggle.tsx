"use client";

import Link from "next/link";
import { useState } from "react";
import { track } from "@/lib/track";
import { useSaved } from "@/lib/use-saved";

function Bookmark({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-[1.125rem] shrink-0" fill={filled ? "currentColor" : "none"}>
      <path
        d="M6.5 4.5h11a1 1 0 0 1 1 1v14.2a.3.3 0 0 1-.48.24L12 15.5l-6.02 4.44a.3.3 0 0 1-.48-.24V5.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Save/unsave a club for later (/saved). Icon-only on directory rows, labelled on profiles. */
export function SaveToggle({
  slug,
  name,
  variant = "row",
}: {
  slug: string;
  name: string;
  variant?: "row" | "button";
}) {
  const { has, toggle } = useSaved();
  const on = has(slug);
  // Spoken after a press only (never on load), so a screen reader hears the result of the toggle.
  const [note, setNote] = useState("");
  const onToggle = () => {
    if (!on) track("save-add");
    toggle(slug);
    setNote(on ? `Removed ${name} from saved` : `Saved ${name}`);
  };
  // A constant name: aria-pressed carries the state (a changing label too would be read twice).
  const label = `Save ${name}`;
  const status = (
    <span role="status" className="sr-only">
      {note}
    </span>
  );
  if (variant === "button")
    return (
      <>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={on}
          className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border sm:h-9 px-3.5 text-sm font-medium transition-colors ${
            on
              ? "border-accent bg-accent-soft text-accent"
              : "border-stone-200 text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-900"
          }`}
        >
          <Bookmark filled={on} />
          {on ? "Saved" : "Save"}
        </button>
        {status}
      </>
    );
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        aria-label={label}
        title={on ? "Saved. Press to remove" : "Save for later"}
        className={`relative z-10 inline-flex size-11 shrink-0 items-center justify-center rounded-md transition sm:size-8 ${
          on ? "text-accent" : "text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
        }`}
      >
        <Bookmark filled={on} />
      </button>
      {status}
    </>
  );
}

/** Header link to /saved with a count once something is saved (client-only: no hydration mismatch). */
export function SavedNavLink({ className }: { className: string }) {
  const { slugs } = useSaved();
  return (
    <Link href="/saved" className={className}>
      Saved
      {slugs.length > 0 ? (
        <span className="tabular ml-1.5 rounded-full bg-brand px-1.5 text-[11px] leading-4 font-semibold text-on-brand">
          {slugs.length}
          <span className="sr-only"> saved</span>
        </span>
      ) : null}
    </Link>
  );
}
