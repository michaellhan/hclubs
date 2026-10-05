"use client";

import { useState, type ReactNode } from "react";
import { formPost, sendForm } from "@/lib/form-send";

/**
 * The submit control shared by the site's forms. A Google Form prefill target is sent from
 * the page (`sendForm`), so visitors stay on hclubs; if that fails, the prefilled form opens
 * as a fallback. Any other target (a mailto link) stays a plain link.
 */
export function SendButton({
  target,
  label = "Send",
  emailLabel = "Email this",
  track,
  sent,
  onSent,
}: {
  target: string;
  label?: string;
  emailLabel?: string;
  track: string;
  /** What to show once sent; the form keeps the visitor's answers until they move on. */
  sent?: ReactNode;
  onSent?: () => void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  if (!formPost(target))
    return (
      <a href={target} data-track={track} className="hc-btn-primary">
        {emailLabel}
      </a>
    );
  if (state === "sent")
    return (
      <div role="status" className="space-y-1 text-sm">
        <p className="font-medium text-stone-900 dark:text-stone-100">Sent. Thank you!</p>
        <p className="text-stone-600 dark:text-stone-400">
          {sent ?? "A person reads every message before anything changes on the site."}
        </p>
      </div>
    );
  return (
    <div className="space-y-2">
      <button
        type="button"
        data-track={track}
        disabled={state === "sending"}
        onClick={async () => {
          setState("sending");
          const ok = await sendForm(target);
          setState(ok ? "sent" : "failed");
          if (ok) onSent?.();
        }}
        className="hc-btn-primary disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : label}
      </button>
      {state === "failed" ? (
        <p role="alert" className="text-sm text-stone-600 dark:text-stone-400">
          That didn&apos;t go through.{" "}
          <a href={target} target="_blank" rel="noopener noreferrer" className="hc-link">
            Send it with the form instead
          </a>{" "}
          (your answers are filled in).
        </p>
      ) : null}
    </div>
  );
}
