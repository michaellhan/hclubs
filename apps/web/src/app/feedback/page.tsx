import type { Metadata } from "next";
import { Suspense } from "react";
import { contributionTopic } from "@hci/core";
import { getStaticIndex } from "@hci/db";
import { FeedbackHub } from "@/components/feedback-hub";
import { ADDABLE, FIXES, TOPIC_LABEL } from "@/lib/contribute-topics";
import { db } from "@/lib/db";
import { pageMetadata } from "@/lib/meta";
import { contactEmail, contributeFormUrl, feedbackFormUrl } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Feedback",
  description: "Add or correct a club's details, or tell us what to fix or add on hclubs. A person reads every answer.",
  path: "/feedback/",
});

/**
 * Everything visitors tell us, on one page (ADR 0035): a club's details (`?club=<slug>&topic=<type>`)
 * or the site in general (`?about=site`, `?from=<path>`). The site is static: answers are sent
 * through the shared contribution form, prefilled, for a person to review.
 */
export default async function FeedbackPage() {
  const index = await getStaticIndex(db(), new Date());
  const clubs = index.clubs
    .filter((c) => !c.isFixture)
    .map((c) => ({ slug: c.slug, name: c.name, acronym: c.acronym }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const keys = [...ADDABLE, ...FIXES];
  const chipLabel: Record<string, string> = {};
  for (const k of keys) chipLabel[k] = TOPIC_LABEL[k] ?? k;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Feedback</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-900" />}>
        <FeedbackHub
          clubs={clubs}
          topics={keys.map(contributionTopic)}
          addKeys={ADDABLE}
          fixKeys={FIXES}
          chipLabel={chipLabel}
          formTemplate={contributeFormUrl()}
          fallbackUrl={feedbackFormUrl()}
          email={contactEmail()}
        />
      </Suspense>
    </div>
  );
}
