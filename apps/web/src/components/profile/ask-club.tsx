"use client";

import { useEffect, useState } from "react";
import { askDmText, askEmail, type AskPlan } from "@/lib/ask-club";
import { mailtoHref } from "@/lib/site";
import { track } from "@/lib/track";

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

/**
 * "Ask the club" for a profile that doesn't say how or when to join: a prefilled email to the
 * club's own address, or a short message copied for its Instagram DMs. The student sends it
 * themselves. Once they've started one, the page says so, so they don't ask twice. Each use counts
 * one anonymous event naming the club, which shows where students want answers most.
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

  return (
    <section aria-labelledby="ask-club" className="text-sm text-stone-600 dark:text-stone-400">
      <p id="ask-club">
        {day ? (
          <>You started a message to this club on {day}. Any answer goes to you, not to hclubs.</>
        ) : (
          <>Can&apos;t find it? Ask the club directly; they reply to you.</>
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {mail && plan.email ? (
          <a href={mailtoHref(plan.email, mail.subject, mail.body)} className="hc-chip" onClick={() => asked("email")}>
            {day ? "Email them again" : "Email the club"}
          </a>
        ) : null}
        {plan.instagram ? (
          <a
            href={plan.instagram}
            target="_blank"
            rel="noopener noreferrer"
            className="hc-chip"
            data-tip="Copies a short message to paste into their DMs"
            onClick={() => {
              asked("instagram");
              // No clipboard (insecure context, old browser): show the text to copy by hand.
              if (!navigator.clipboard) setCopied("failed");
              else
                void navigator.clipboard.writeText(dm).then(
                  () => setCopied("copied"),
                  () => setCopied("failed"),
                );
            }}
          >
            Message on Instagram
          </a>
        ) : null}
      </div>
      <p aria-live="polite" className="mt-1.5 text-xs">
        {copied === "copied" ? (
          "Message copied. Paste it into your DM."
        ) : copied === "failed" ? (
          <>
            Copy this into your DM: <span className="select-all text-stone-800 dark:text-stone-200">{dm}</span>
          </>
        ) : null}
      </p>
    </section>
  );
}
