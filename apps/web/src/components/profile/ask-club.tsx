"use client";

import { useEffect, useState } from "react";
import { askDmText, askEmail, type AskPlan } from "@/lib/ask-club";
import { mailtoHref } from "@/lib/site";
import { track } from "@/lib/track";
import { Chevron } from "@/components/ui";

const KEY = "hc-asked";

/** When this visitor last asked each club (localStorage only, never sent anywhere). */
function readAsked(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function rememberAsked(slug: string, at: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAsked(), [slug]: at }));
  } catch {
    // Private mode or blocked storage: the reminder just won't show next time.
  }
}

/** The chip names the first thing the page is missing. */
const LABEL = { how: "Ask how to join", when: "Ask when they recruit", time: "Ask how to join" } as const;

/**
 * "Ask the club" for a profile that doesn't say how or when to join: one chip in the profile's
 * action row. With the club's email it opens a finished email in the student's mail app; with
 * only Instagram it opens a panel showing the DM before anything is copied. Once they've started one, the chip
 * says so, so they don't ask twice. Each use counts one anonymous event naming the club, which
 * shows where students want answers most. Renders two flex items: the chip, and the panel as a
 * full-width row under the action row.
 */
export function AskTheClub({
  club,
  plan,
  site,
}: {
  club: { name: string; slug: string };
  plan: AskPlan;
  site: string;
}) {
  const [askedOn, setAskedOn] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  useEffect(() => setAskedOn(readAsked()[club.slug] ?? null), [club.slug]);

  const dm = askDmText(club, plan.topics, site);
  const mail = plan.email ? askEmail(club, plan.topics, site) : null;
  const asked = (channel: "email" | "instagram") => {
    const at = new Date().toISOString();
    rememberAsked(club.slug, at);
    setAskedOn(at);
    track(`ask-club/${channel}/${club.slug}`, { oncePerPage: true });
  };
  const day = askedOn
    ? new Date(askedOn).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
    : null;
  const panelId = `ask-club-${club.slug}`;

  // With the club's address, the chip opens the finished email: the student only presses Send.
  if (mail && plan.email)
    return (
      <a href={mailtoHref(plan.email, mail.subject, mail.body)} className="hc-chip" onClick={() => asked("email")}>
        {day ? `Asked ${day}` : LABEL[plan.topics[0] ?? "how"]}
      </a>
    );

  return (
    <>
      <button
        type="button"
        className="hc-chip"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {day ? `Asked ${day}` : LABEL[plan.topics[0] ?? "how"]}
        <Chevron className={open ? "rotate-180" : ""} />
      </button>
      {open ? (
        <div
          id={panelId}
          className="order-last mt-1 w-full rounded-xl border border-stone-200 p-3 text-sm dark:border-stone-700"
        >
          <p className="text-stone-800 dark:text-stone-200">{dm}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {plan.instagram ? (
              <a
                href={plan.instagram}
                target="_blank"
                rel="noopener noreferrer"
                className="hc-btn-primary"
                onClick={() => {
                  asked("instagram");
                  // No clipboard (insecure context, old browser): the text above is selectable.
                  if (!navigator.clipboard) setCopied("failed");
                  else
                    void navigator.clipboard.writeText(dm).then(
                      () => setCopied("copied"),
                      () => setCopied("failed"),
                    );
                }}
              >
                Copy and open Instagram
              </a>
            ) : null}
          </div>
          <p aria-live="polite" className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            {copied === "copied"
              ? "Copied. Paste it into their DMs."
              : copied === "failed"
                ? "Couldn't copy. Select the message above and copy it."
                : "You send it from your own account, and replies come to you."}
          </p>
        </div>
      ) : null}
    </>
  );
}
