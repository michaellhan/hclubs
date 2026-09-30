"use client";

import { useState } from "react";

/**
 * Placeholder for community corrections (CLAUDE.md §14). The data model
 * (student_submission) exists; the public submission flow and moderation are not built.
 */
export function SuggestUpdate({ clubName }: { clubName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Something out of date or missing?</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Corrections become sourced claims after review — they never overwrite evidence silently.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Suggest an update
        </button>
      </div>
      {open ? (
        <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
          <p className="text-zinc-600 dark:text-zinc-400">
            Submissions for <span className="font-medium text-zinc-900 dark:text-zinc-100">{clubName}</span> aren&apos;t
            open yet. When they are, you&apos;ll be able to submit a link, a recruiting deadline, or a correction with a
            source URL.
          </p>
          <fieldset disabled className="grid gap-2 opacity-60">
            <input
              className="h-9 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
              placeholder="What should change?"
            />
            <input
              className="h-9 rounded-md border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
              placeholder="Source URL (official page, post, doc)"
            />
            <button
              type="button"
              className="h-9 w-fit rounded-md bg-zinc-900 px-3 text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Submit (coming soon)
            </button>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
