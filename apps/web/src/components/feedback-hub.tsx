"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { FeedbackForm } from "@/components/feedback-form";
import type { PickableClub } from "@/components/officer-form";
import { SuggestForm } from "@/components/suggest-form";
import { clubFromPage, feedbackPage, initialFeedbackMode, type FeedbackMode } from "@/lib/feedback";
import type { SuggestTopic } from "@/lib/suggest";

const MODES: { key: FeedbackMode; label: string }[] = [
  { key: "club", label: "About a club" },
  { key: "site", label: "About the site" },
];

/**
 * One place for everything visitors tell us: a club's details (the topic form, ADR 0035) or
 * the site in general (one box). Both go through the same contribution form.
 */
export function FeedbackHub({
  clubs,
  topics,
  addKeys,
  fixKeys,
  chipLabel,
  formTemplate,
  fallbackUrl,
  email,
}: {
  clubs: PickableClub[];
  topics: SuggestTopic[];
  addKeys: string[];
  fixKeys: string[];
  chipLabel: Record<string, string>;
  formTemplate: string | null;
  fallbackUrl: string | null;
  email: string | null;
}) {
  const params = useSearchParams();
  // Read once: the club form rewrites the query string as the visitor picks.
  const [page] = useState(() => feedbackPage(params.get("from")));
  const [initialClub] = useState(() => params.get("club") ?? clubFromPage(page));
  const [mode, setMode] = useState<FeedbackMode>(() =>
    initialFeedbackMode({ about: params.get("about"), club: params.get("club"), topic: params.get("topic"), page }),
  );

  const choose = (next: FeedbackMode) => {
    if (next === mode) return;
    setMode(next);
    if (next === "site") {
      // Drop the club form's ?club=/&topic= so a reload stays on the site box.
      const q = new URLSearchParams({ about: "site" });
      if (page) q.set("from", page);
      window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
    }
  };

  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label="What is it about?" className="flex flex-wrap gap-2">
        {MODES.map((m, i) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={mode === m.key}
            // ARIA radio pattern: one Tab stop (the checked one), arrows move and select.
            tabIndex={mode === m.key ? 0 : -1}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = MODES[(i + step + MODES.length) % MODES.length];
              if (!next) return;
              choose(next.key);
              (e.currentTarget.parentElement?.children[MODES.indexOf(next)] as HTMLElement | undefined)?.focus();
            }}
            onClick={() => choose(m.key)}
            className="hc-chip aria-checked:border-accent aria-checked:bg-accent/10 aria-checked:text-stone-900 dark:aria-checked:text-stone-100"
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === "club" ? (
        <SuggestForm
          clubs={clubs}
          topics={topics}
          addKeys={addKeys}
          fixKeys={fixKeys}
          chipLabel={chipLabel}
          formTemplate={formTemplate}
          email={email}
          initialClub={initialClub}
        />
      ) : (
        <FeedbackForm formTemplate={formTemplate} fallbackUrl={fallbackUrl} email={email} page={page} />
      )}
    </div>
  );
}
