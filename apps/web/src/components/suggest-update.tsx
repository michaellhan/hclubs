"use client";

import { useActionState, useState } from "react";
import { suggestUpdate, type SuggestState } from "@/app/clubs/[slug]/actions";

const KINDS = [
  ["edit_suggestion", "Something is wrong or missing"],
  ["link", "Official link (website, Instagram, application)"],
  ["deadline", "Recruiting deadline"],
  ["inactive_report", "This club seems inactive"],
] as const;

const INITIAL: SuggestState = { status: "idle", message: "" };
const FIELD = "h-9 w-full rounded-md border border-zinc-300 bg-transparent px-3 text-sm dark:border-zinc-700";

/**
 * Community corrections (CLAUDE.md §14). Submissions go to a moderation queue; they are
 * reviewed by a person and never overwrite sourced facts automatically.
 */
export function SuggestUpdate({ clubName, clubSlug }: { clubName: string; clubSlug: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(suggestUpdate, INITIAL);
  return (
    <div id="suggest" className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Something out of date or missing?</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Corrections are reviewed by a person and become sourced facts — they never silently overwrite evidence.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="suggest-form"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Suggest a correction
        </button>
      </div>
      {open ? (
        state.status === "ok" ? (
          <p
            role="status"
            className="mt-4 border-t border-zinc-100 pt-4 text-sm text-emerald-700 dark:border-zinc-800 dark:text-emerald-400"
          >
            {state.message}
          </p>
        ) : (
          <form
            id="suggest-form"
            action={action}
            className="mt-4 grid gap-3 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800"
          >
            <input type="hidden" name="clubSlug" value={clubSlug} />
            <div aria-hidden className="absolute -left-[9999px]">
              <label>
                Leave this empty <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">About {clubName}</span>
              <select name="kind" className={FIELD} defaultValue="edit_suggestion">
                {KINDS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">What should change?</span>
              <textarea
                name="message"
                required
                minLength={5}
                maxLength={2000}
                rows={3}
                className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Source URL <span className="font-normal">(optional — an official page, post, or form)</span>
              </span>
              <input name="evidenceUrl" type="url" maxLength={500} placeholder="https://" className={FIELD} />
            </label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Please don&apos;t include personal information about members. We don&apos;t store your name or email.
            </p>
            {state.status === "error" ? (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {state.message}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="h-9 w-fit rounded-md bg-zinc-900 px-3 font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? "Sending…" : "Submit for review"}
            </button>
          </form>
        )
      ) : null}
    </div>
  );
}
