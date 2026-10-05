"use client";

import { useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { SendButton } from "@/components/send-button";
import { FEEDBACK_FORM_OPTION, feedbackDetails, feedbackPage } from "@/lib/feedback";
import { fillFormUrl, mailtoHref } from "@/lib/site";

const input =
  "w-full rounded-lg border border-stone-300 bg-white px-3 text-base outline-none placeholder:text-stone-400 focus:border-accent focus:ring-4 focus:ring-accent/15 sm:text-sm dark:border-stone-700 dark:bg-stone-900";

/**
 * Site feedback, written here and sent from the page to the shared contribution form
 * (ADR 0035) as "Feedback about the site". Falls back to the plain feedback form link or
 * email when the contribution form isn't configured.
 */
export function FeedbackForm({
  formTemplate,
  fallbackUrl,
  email,
}: {
  formTemplate: string | null;
  fallbackUrl: string | null;
  email: string | null;
}) {
  const params = useSearchParams();
  const page = feedbackPage(params.get("from"));
  const [message, setMessage] = useState("");
  const id = useId();
  const details = feedbackDetails(message, page);
  const target = !details
    ? null
    : formTemplate
      ? fillFormUrl(formTemplate, { name: "", slug: "" }, { clubref: "", type: FEEDBACK_FORM_OPTION, details })
      : email
        ? mailtoHref(email, "hclubs feedback", details)
        : null;

  if (!formTemplate && !email)
    return fallbackUrl ? (
      <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="hc-btn-primary">
        Open the feedback form
      </a>
    ) : (
      <p className="text-sm text-stone-600 dark:text-stone-400">Feedback opens soon.</p>
    );

  return (
    <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
      <div className="space-y-1">
        <label htmlFor={id} className="block text-sm font-medium text-stone-800 dark:text-stone-200">
          What should we fix or add?
        </label>
        <textarea
          id={id}
          value={message}
          rows={5}
          maxLength={2000}
          autoFocus
          placeholder="Something broken, confusing or missing, a club we got wrong, an idea…"
          onChange={(e) => setMessage(e.target.value)}
          className={`${input} py-2`}
        />
        {page ? <p className="text-xs text-stone-500 dark:text-stone-400">About the page {page}</p> : null}
      </div>
      {target ? (
        <SendButton key={target} target={target} track="feedback-submit" sent="We read every message." />
      ) : (
        <button type="button" disabled className="hc-btn-primary opacity-50">
          Send
        </button>
      )}
    </form>
  );
}
