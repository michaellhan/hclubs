"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatRange } from "@/lib/format";
import { parseSlugList } from "@/lib/local-list";
import { currentSlug } from "@/lib/club-redirect";
import { migrateSlugs, nextStep, offerableSlugs, parseClubsParam, savedSummary, sortSaved } from "@/lib/saved";
import { useIndex } from "@/lib/use-index";
import { useNow } from "@/lib/use-now";
import { MAX_COMPARE } from "@/lib/use-compare";
import { addSaved, setSaved, useSaved } from "@/lib/use-saved";
import { JoiningPills } from "./club-bits";
import { ClubLogo } from "./club-logo";
import { ListSkeleton } from "./recruiting-now";
import { RowRecruiting } from "./row-recruiting";
import { DemoPill, EmptyState, Pill } from "./ui";

const PICKED_KEY = "hclubs:saved-picked";
const BTN =
  "inline-flex min-h-11 sm:min-h-9 items-center rounded-full border border-stone-200 px-3.5 text-sm font-medium text-stone-700 hover:border-stone-400 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-900";

function CopyListLink({ slugs }: { slugs: string[] }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className={BTN}
      onClick={async () => {
        try {
          const url = new URL(window.location.href);
          url.search = `?clubs=${slugs.join(",")}`;
          await navigator.clipboard.writeText(url.toString());
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      <span aria-live="polite">
        {state === "copied" ? "Link copied" : state === "failed" ? "Copy failed" : "Copy list link"}
      </span>
    </button>
  );
}

/** A shared `/saved?clubs=a,b` link: offers to add those clubs to the visitor's own list. */
function ShareImport({ shared, names }: { shared: string[]; names: Map<string, string> }) {
  const { slugs } = useSaved();
  const [dismissed, setDismissed] = useState(false);
  // Slugs not in the index may be old ones that redirect: resolve them, offer only listed clubs.
  const [moved, setMoved] = useState<ReadonlyMap<string, string>>(new Map());
  const unlistedKey = shared.filter((s) => !names.has(s)).join(",");
  useEffect(() => {
    if (!unlistedKey) return;
    let live = true;
    const old = unlistedKey.split(",");
    void Promise.all(old.map(currentSlug)).then((targets) => {
      if (!live) return;
      const m = new Map<string, string>();
      old.forEach((s, i) => {
        const t = targets[i];
        if (t && t !== s) m.set(s, t);
      });
      setMoved(m);
    });
    return () => {
      live = false;
    };
  }, [unlistedKey]);
  const fresh = offerableSlugs(shared, (s) => names.has(s), moved).filter((s) => !slugs.includes(s));
  if (dismissed || fresh.length === 0) return null;
  return (
    <section
      aria-label="Shared list"
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-accent-soft px-4 py-3 text-sm text-stone-800 dark:text-stone-200"
    >
      <p className="min-w-0 flex-1">
        This link shares {fresh.length} {fresh.length === 1 ? "club" : "clubs"}:{" "}
        {fresh
          .slice(0, 4)
          .map((s) => names.get(s) ?? "")
          .join(", ")}
        {fresh.length > 4 ? ` and ${fresh.length - 4} more` : ""}.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            let next = [...slugs];
            for (const s of [...fresh].reverse()) next = addSaved(next, s);
            setSaved(next);
            setDismissed(true);
          }}
          className="hc-btn-primary"
        >
          Add to my saved
        </button>
        <button type="button" onClick={() => setDismissed(true)} className={BTN}>
          Not now
        </button>
      </div>
    </section>
  );
}

export function SavedView() {
  const { slugs, remove } = useSaved();
  const { data: index, error } = useIndex();
  const now = useNow();
  const shared = parseClubsParam(useSearchParams().get("clubs"));
  // Ticks survive Compare -> Back (sessionStorage; falls back to nothing if blocked).
  const [picked, setPickedState] = useState<string[]>([]);
  useEffect(() => {
    try {
      setPickedState(parseSlugList(sessionStorage.getItem(PICKED_KEY), MAX_COMPARE));
    } catch {
      /* storage blocked: start empty */
    }
  }, []);
  const setPicked = (next: string[]) => {
    setPickedState(next);
    try {
      sessionStorage.setItem(PICKED_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked or full: the ticks just won't persist */
    }
  };

  // Drop ticks for clubs no longer saved, so they don't come back ticked if re-saved.
  const slugsKey = slugs.join(",");
  const firstPrune = useRef(true);
  useEffect(() => {
    // The first run can still see the server's empty list during hydration: don't prune on it.
    if (firstPrune.current) {
      firstPrune.current = false;
      return;
    }
    setPickedState((cur) => {
      const kept = cur.filter((s) => slugsKey.split(",").includes(s));
      if (kept.length === cur.length) return cur;
      try {
        sessionStorage.setItem(PICKED_KEY, JSON.stringify(kept));
      } catch {
        /* storage blocked: ticks just won't persist */
      }
      return kept;
    });
  }, [slugsKey]);

  const bySlug = new Map((index?.clubs ?? []).map((c) => [c.slug, c]));
  const names = new Map((index?.clubs ?? []).map((c) => [c.slug, c.name]));
  const found = slugs.map((s) => bySlug.get(s)).filter((c) => c !== undefined);
  const missing = index ? slugs.filter((s) => !bySlug.has(s)) : [];
  // Renamed or merged clubs keep a redirect: move those to their current slug instead of
  // calling them gone. Only slugs that don't resolve to a listed club are offered for clearing.
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    let live = true;
    const old = missingKey.split(",");
    void Promise.all(old.map(currentSlug)).then((targets) => {
      if (!live) return;
      const moved = new Map<string, string>();
      old.forEach((s, i) => {
        const t = targets[i];
        if (t && t !== s && bySlug.has(t)) moved.set(s, t);
      });
      setUnresolved(old.filter((s) => !moved.has(s)));
      if (moved.size) setSaved(migrateSlugs(slugs, moved));
    });
    return () => {
      live = false;
    };
    // bySlug/slugs are derived from the index and store; missingKey captures what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey]);
  const gone = missing.filter((s) => unresolved.includes(s));
  const sorted = now ? sortSaved(found, now) : null;
  const rows = sorted ?? found.map((club) => ({ club, state: null }));
  const summary = now && sorted ? savedSummary(sorted, now) : null;
  const compare = picked.filter((s) => slugs.includes(s));
  // The last removal, undoable for a few seconds (put back where it was).
  const [removed, setRemoved] = useState<{ slug: string; name: string; at: number; ticked: boolean } | null>(null);
  useEffect(() => {
    if (!removed) return;
    const t = setTimeout(() => setRemoved(null), 8000);
    return () => clearTimeout(t);
  }, [removed]);
  const removeWithUndo = (slug: string, name: string) => {
    setRemoved({ slug, name, at: slugs.indexOf(slug), ticked: compare.includes(slug) });
    remove(slug);
  };
  const undo = () => {
    if (!removed) return;
    const rest = slugs.filter((s) => s !== removed.slug);
    setSaved([...rest.slice(0, removed.at), removed.slug, ...rest.slice(removed.at)]);
    // Bring back its compare tick too (the prune above dropped it with the club).
    if (removed.ticked && compare.length < MAX_COMPARE) setPicked([...compare, removed.slug]);
    setRemoved(null);
  };

  const header = (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Saved clubs</h1>
        {summary ? (
          <p className="mt-1 text-sm font-medium text-stone-800 dark:text-stone-200" aria-live="polite">
            {summary}
          </p>
        ) : null}
      </div>
      {slugs.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <CopyListLink slugs={slugs} />
          {/* Phones: the sticky bar below is Compare, and the hint is the line under the list's
              summary (same height ticked or not), so ticking never shifts the buttons. */}
          <div className="max-sm:hidden">
            {compare.length >= 2 ? (
              <Link href={`/compare?clubs=${compare.join(",")}`} className="hc-btn-primary">
                Compare {compare.length}
              </Link>
            ) : (
              <span className="inline-flex h-9 items-center rounded-full bg-stone-100 px-4 text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                Tick 2 to {MAX_COMPARE} to compare
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );

  if (error)
    return (
      <>
        {header}
        <EmptyState title="Couldn't load the club list">Reload the page to try again.</EmptyState>
      </>
    );
  if (!index && (slugs.length > 0 || shared.length > 0)) return <ListSkeleton rows={Math.min(slugs.length || 3, 6)} />;

  return (
    <>
      {header}
      <ShareImport shared={shared} names={names} />
      <p role="status" aria-live="polite" className="mb-2 text-sm text-stone-600 dark:text-stone-400">
        {removed ? (
          <>
            Removed {removed.name}.{" "}
            <button
              type="button"
              onClick={undo}
              className="hc-link inline-flex min-h-11 items-center font-medium text-stone-900 sm:min-h-0 dark:text-stone-100"
            >
              Undo
            </button>
          </>
        ) : null}
      </p>
      {slugs.length > 0 ? (
        <p className="mb-2 text-sm text-stone-600 sm:hidden dark:text-stone-400">
          {compare.length === 0
            ? `Tick 2 to ${MAX_COMPARE} clubs to compare.`
            : `${compare.length} ticked · compare up to ${MAX_COMPARE}`}
        </p>
      ) : null}
      {slugs.length === 0 ? (
        <EmptyState title="Nothing saved yet">
          Tap the bookmark on any club in the{" "}
          <Link href="/clubs" className="underline underline-offset-2">
            directory
          </Link>{" "}
          or on its page to keep it here, with its deadline and how to join. Start from the{" "}
          <Link href="/" className="underline underline-offset-2">
            home page
          </Link>{" "}
          if you are not sure what you want.
        </EmptyState>
      ) : (
        <>
          <ul className="hc-list">
            {rows.map(({ club, state }) => {
              const step = nextStep(club, state);
              const hours = formatRange(club.hoursPerWeek, "h/wk");
              const ended = club.activityStatus === "defunct";
              const checked = compare.includes(club.slug);
              return (
                <li key={club.slug} className="flex gap-3 px-3 py-3 sm:px-4">
                  <label className="-ml-1 flex size-11 shrink-0 cursor-pointer items-center justify-center sm:size-8">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && compare.length >= MAX_COMPARE}
                      onChange={() =>
                        setPicked(checked ? compare.filter((s) => s !== club.slug) : [...compare, club.slug])
                      }
                      aria-label={`Compare ${club.name}`}
                    />
                  </label>
                  <div className="hidden sm:block">
                    <ClubLogo name={club.name} src={club.isFixture ? null : club.logo} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <Link
                        href={`/clubs/${club.slug}`}
                        prefetch={false}
                        className="-my-2.5 py-2.5 font-semibold tracking-tight hover:underline sm:my-0 sm:py-0"
                      >
                        {club.name}
                      </Link>
                      {club.acronym ? (
                        <span className="text-sm text-stone-500 dark:text-stone-400">{club.acronym}</span>
                      ) : null}
                      {club.isFixture ? <DemoPill /> : null}
                    </div>
                    {club.shortDescription ? (
                      <p className="mt-0.5 line-clamp-2 text-sm text-stone-600 dark:text-stone-400">
                        {club.shortDescription}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {ended ? (
                        <Pill tone="amber" title="A source says this organization ended">
                          No longer active
                        </Pill>
                      ) : (
                        <>
                          <RowRecruiting
                            cycle={club.currentCycle}
                            cycles={club.cycles}
                            seasons={club.recruitingSeasons}
                            joinModes={club.joinModes}
                            openAccess={club.joining.access === "open"}
                            lastRound={club.lastRound}
                          />
                          <JoiningPills joining={club.joining} max={2} tips />
                        </>
                      )}
                      {hours ? (
                        <span className="tabular text-xs text-stone-600 dark:text-stone-400">{hours}</span>
                      ) : null}
                      {step?.kind === "apply" ? (
                        <a href={step.url} target="_blank" rel="noopener noreferrer" className="hc-btn-primary-sm">
                          Apply<span className="sr-only"> to {club.name} (opens the club's page)</span>
                        </a>
                      ) : step?.kind === "join" ? (
                        <Link href={step.href} prefetch={false} className="hc-btn-sm">
                          Join anytime<span className="sr-only">: how to join {club.name}</span>
                        </Link>
                      ) : step?.kind === "website" ? (
                        <a href={step.url} target="_blank" rel="noopener noreferrer" className="hc-btn-sm">
                          Website<span className="sr-only"> for {club.name} (opens the club's site)</span>
                        </a>
                      ) : step?.kind === "instagram" ? (
                        <a href={step.url} target="_blank" rel="noopener noreferrer" className="hc-btn-sm">
                          How to join<span className="sr-only"> {club.name} on Instagram (opens Instagram)</span>
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeWithUndo(club.slug, club.name)}
                    aria-label={`Remove ${club.name} from saved`}
                    className="inline-flex size-11 shrink-0 items-center justify-center self-center rounded-md text-lg leading-none text-stone-500 hover:text-stone-900 sm:size-8 dark:hover:text-stone-100"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          {compare.length >= 1 ? (
            <>
              <div aria-hidden className="h-20 sm:hidden" />
              <aside
                aria-label="Compare selected clubs"
                className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden dark:border-stone-800 dark:bg-stone-900/95"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="tabular text-sm text-stone-700 dark:text-stone-300" aria-live="polite">
                    {compare.length} selected
                  </span>
                  {compare.length >= 2 ? (
                    <Link href={`/compare?clubs=${compare.join(",")}`} className="hc-btn-primary">
                      Compare {compare.length}
                    </Link>
                  ) : (
                    <span className="inline-flex min-h-11 items-center rounded-full bg-stone-100 px-4 text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                      Tick one more to compare
                    </span>
                  )}
                </div>
              </aside>
            </>
          ) : null}
          {gone.length > 0 ? (
            <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
              {gone.length} saved {gone.length === 1 ? "club is" : "clubs are"} no longer listed.{" "}
              <button
                type="button"
                onClick={() => setSaved(slugs.filter((s) => bySlug.has(s)))}
                className="underline underline-offset-2 hover:text-stone-900 dark:hover:text-stone-100"
              >
                Clear {gone.length === 1 ? "it" : "them"}
              </button>
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
