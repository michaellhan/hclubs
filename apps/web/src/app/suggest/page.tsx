import type { Metadata } from "next";
import { Suspense } from "react";
import { contributionTopic } from "@hci/core";
import { getStaticIndex } from "@hci/db";
import { SuggestForm } from "@/components/suggest-form";
import { ADDABLE, FIXES, TOPIC_LABEL } from "@/lib/contribute-topics";
import { db } from "@/lib/db";
import { pageMetadata } from "@/lib/meta";
import { contactEmail, contributeFormUrl } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  title: "Suggest an update",
  description: "Add or correct information about a Harvard club. A person checks every answer before it appears.",
  path: "/suggest/",
});

/**
 * Students' suggestions for a club (ADR 0035). The site is static: the answers are asked
 * here and sent through the shared contribution form, prefilled, for a person to review.
 */
export default async function SuggestPage() {
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
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Suggest an update</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Know something about a club? Answer here; the next step sends it. A person checks every answer before it
          appears.
        </p>
      </header>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-900" />}>
        <SuggestForm
          clubs={clubs}
          topics={keys.map(contributionTopic)}
          addKeys={ADDABLE}
          fixKeys={FIXES}
          chipLabel={chipLabel}
          formTemplate={contributeFormUrl()}
          email={contactEmail()}
        />
      </Suspense>
    </div>
  );
}
