"use client";

import type { ReactNode } from "react";
import { dateValueStart, isRecruitingNow, type JoinMode, type RecruitingSeason } from "@hci/core/browser";
import { isPastTerm, withLiveStatus, type CycleSummary, type JoiningSummary } from "@hci/db/local";
import { applyLinkText } from "@/lib/apply-link";
import { formatDateValue, formatTerm, relativeDateValue } from "@/lib/format";
import { joinTiming, type TimingTone } from "@/lib/join-timing";
import { useNow } from "@/lib/use-now";
import { LinkGlyph } from "../link-icons";

/**
 * The parts of a profile that depend on today's date, recomputed in the browser: pages are
 * prebuilt, so a cycle open at build time may be closed when someone reads the page
 * (CLAUDE.md §8). Before mount they render the build-time state.
 */
function useLiveCycle(cycle: CycleSummary | null): { cycle: CycleSummary | null; now: Date | null } {
  const now = useNow();
  return { cycle: cycle && now ? withLiveStatus(cycle, now) : cycle, now };
}

const DOT: Record<TimingTone, string> = {
  open: "bg-emerald-500",
  soon: "bg-sky-500",
  closed: "bg-stone-400",
  plain: "bg-stone-300 dark:bg-stone-600",
};

/**
 * The "When" answer at the top of a profile ("Apply by Oct 3 · in 5 days", "Anytime",
 * "Usually recruits in fall"), recomputed on the reader's day. `unknown` renders when no
 * dated evidence or pattern exists.
 */
export function JoinWhen({
  cycle: built,
  joining,
  seasons,
  joinModes = [],
  later = null,
  unknown,
}: {
  cycle: CycleSummary | null;
  joining: JoiningSummary;
  seasons: RecruitingSeason[];
  joinModes?: readonly JoinMode[];
  /** The next round the club's own pages announce for a later term (`laterRound`). */
  later?: { termKey: string; processTypes: JoinMode[]; noCuts?: boolean } | null;
  unknown: ReactNode;
}) {
  const { cycle, now } = useLiveCycle(built);
  const ref = now ?? new Date(built?.deadline?.at ?? built?.opens?.at ?? Date.now());
  const t = joinTiming({ cycle, joining, seasons, joinModes, later }, ref, now);
  if (!t) return <>{unknown}</>;
  return (
    <span className="flex items-start gap-2">
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[t.tone]}`} />
      <span className="min-w-0">
        <span className="tabular font-medium">{t.text}</span>
        {t.sub ? <span className="block text-xs text-stone-500 dark:text-stone-400">{t.sub}</span> : null}
      </span>
    </span>
  );
}

/**
 * The featured application link. Prominent ("Apply") only while a dated cycle is open or
 * when the club is open to everyone; a link tied to a closed or undated cycle is shown
 * plainly and never as "Apply now".
 */
export function ApplyLink({
  url,
  label,
  term = null,
  cycle: built,
  open,
  fixture,
}: {
  url: string;
  label: string | null;
  /** The term the link's own words name, when it isn't the current round's link: once that round is over it reads "Last round's form". */
  term?: string | null;
  /** The club's current recruiting cycle: a closed round demotes the button. */
  cycle: CycleSummary | null;
  /** The club says anyone can join. */
  open: boolean;
  fixture: boolean;
}) {
  const { cycle, now } = useLiveCycle(built);
  const live = cycle ? isRecruitingNow(cycle.status) : false;
  const closed = cycle?.status === "closed";
  const { text, primary, past } = applyLinkText({ url, label, term, live, closed, open }, now);
  const due = live && cycle?.deadline && now ? ` · due ${relativeDateValue(cycle.deadline, now)}` : "";
  const className = primary
    ? "hc-btn-primary"
    : "inline-flex h-11 items-center gap-1.5 rounded-full border border-stone-300 px-4 text-sm text-stone-700 hover:border-stone-500 hover:text-stone-900 sm:h-9 dark:border-stone-700 dark:text-stone-300 dark:hover:text-stone-100";
  const round = closed ? formatTerm(cycle!.termKey) : past && term ? formatTerm(term) : null;
  const aria = `${text}${label ? `: ${label}` : ""}${round ? ` (${round} round${closed ? " closed" : ""})` : ""} (opens in a new tab)`;
  if (fixture)
    return (
      <span className={className} data-tip="Demo link — fixture data does not point anywhere real">
        {text}
      </span>
    );
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={aria}
      data-track="apply-click"
      className={className}
    >
      {text}
      {due}
      <LinkGlyph kind="apply" className="size-4" />
    </a>
  );
}

/** "in 3 days" / "2 days ago" next to an exact date, computed on the reader's day. */
export function RelativeDate({ value }: { value: CycleSummary["deadline"] }) {
  const now = useNow();
  if (!value || !now) return null;
  return <span className="text-stone-500 dark:text-stone-400"> · {relativeDateValue(value, now)}</span>;
}

/**
 * The join button for an open club with no application link: it names where it goes
 * (website, else Instagram, else email), from links the club already has.
 */
export function OpenJoinLink({
  target,
  fixture,
  quiet = false,
}: {
  target: { kind: "website" | "instagram" | "email" | "mailing_list"; url: string; text: string };
  fixture: boolean;
  /** Outline style for a "check how to apply" link (not a confirmed way in). */
  quiet?: boolean;
}) {
  const className = quiet
    ? "inline-flex h-11 items-center gap-1.5 rounded-full border border-stone-300 px-4 text-sm text-stone-700 hover:border-stone-500 hover:text-stone-900 sm:h-9 dark:border-stone-700 dark:text-stone-300 dark:hover:text-stone-100"
    : "hc-btn-primary";
  if (fixture)
    return (
      <span className={className} data-tip="Demo link — fixture data does not point anywhere real">
        {target.text}
      </span>
    );
  return (
    <a
      href={target.url}
      target={target.url.startsWith("mailto:") ? undefined : "_blank"}
      rel="noopener noreferrer"
      data-track="apply-click"
      className={className}
    >
      {target.text}
      <LinkGlyph kind="apply" className="size-4" />
    </a>
  );
}

/**
 * The cycle card's "Opens" row. Once the opening date has passed with no deadline listed it
 * reads "Started … · no end date listed" (the board's wording), so a past opening never sits
 * there with no status. Before mount, or for a past term, it stays "Opens".
 */
export function OpensRow({ cycle, children }: { cycle: CycleSummary; children?: ReactNode }) {
  const now = useNow();
  if (!cycle.opens) return null;
  const started =
    now !== null &&
    !cycle.deadline &&
    cycle.statedStatus !== "closed" &&
    !isPastTerm(cycle.termKey, now) &&
    dateValueStart(cycle.opens).getTime() <= now.getTime();
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3 py-2 text-sm">
      <dt className="text-stone-500 dark:text-stone-400">{started ? "Started" : "Opens"}</dt>
      <dd className="min-w-0">
        <span className="tabular">{formatDateValue(cycle.opens, now ?? new Date(cycle.opens.at))}</span>
        {started ? (
          <span className="text-stone-500 dark:text-stone-400"> · no end date listed, check their site</span>
        ) : null}
        {children}
      </dd>
    </div>
  );
}
