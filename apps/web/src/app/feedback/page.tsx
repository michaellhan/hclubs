import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedbackForm } from "@/components/feedback-form";
import { pageMetadata } from "@/lib/meta";
import { contactEmail, contributeFormUrl, feedbackFormUrl } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Feedback",
  description: "Tell us what to fix or add on hclubs.",
  path: "/feedback/",
});

export default function FeedbackPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-900" />}>
        <FeedbackForm formTemplate={contributeFormUrl()} fallbackUrl={feedbackFormUrl()} email={contactEmail()} />
      </Suspense>
    </div>
  );
}
