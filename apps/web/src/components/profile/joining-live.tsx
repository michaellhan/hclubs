"use client";

import {
  isRecruitingNow,
  type CycleStatus,
  type RecruitingSeason,
} from "@hci/core/browser";
import { withLiveStatus, type CycleSummary, type JoiningSummary } from "@hci/db/local";
import { formatDateValue, formatTerm, relativeDateValue } from "@/lib/format";
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

const SEASON_WORD: Record<RecruitingSeason, string> = {
  fall: "fall",
  spring: "spring",
  summer: "summer",
  winter: "winter",
  rolling: "on a rolling basis",
};

/** One sentence answering "can I join right now?", from dated evidence only. */
export function JoinStatusLine({
  cycle: built,
  joining,
  seasons,
}: {
  cycle: CycleSummary | null;
  joining: JoiningSummary;
  seasons: RecruitingSeason[];
}) {
  const { cycle, now } = useLiveCycle(built);
  const ref = now ?? new Date(built?.deadline?.at ?? built?.opens?.at ?? Date.now());
  const pattern = seasons.length
    ? `Usually recruits ${seasons.map((s) => (s === "rolling" ? SEASON_WORD[s] : `in ${SEASON_WORD[s]}`)).join(" and ")}`
    : null;
  let text: string | null = null;
  let tone: "open" | "soon" | "closed" | "plain" = "plain";
  const status: CycleStatus | null = cycle?.status ?? null;
  if (cycle && status && isRecruitingNow(status)) {
    tone = "open";
    text = cycle.deadline
      ? `${formatTerm(cycle.termKey)} applications due ${formatDateValue(cycle.deadline, ref)}${now ? ` (${relativeDateValue(cycle.deadline, now)})` : ""}`
      : `${formatTerm(cycle.termKey)} applications are open`;
  } else if (cycle && status === "upcoming") {
    tone = "soon";
    text = cycle.opens
      ? `${formatTerm(cycle.termKey)} applications open ${formatDateValue(cycle.opens, ref)}`
      : `${formatTerm(cycle.termKey)} applications open soon`;
  } else if (cycle && status === "closed") {
    tone = "closed";
    text = `${formatTerm(cycle.termKey)} applications closed${cycle.deadline ? ` ${formatDateValue(cycle.deadline, ref)}` : ""}`;
    if (pattern) text += ` · ${pattern.toLowerCase()}`;
  } else if (joining.access === "open") {
    // Open in general, with a board or team that selects: don't headline "anyone" alone.
    text = joining.roles.length
      ? "Open membership; some roles or teams are selective"
      : "Open membership: anyone can join";
  } else if (pattern) {
    text = `${pattern} · no current dates on record`;
  } else if (joining.access === null && joining.comp === false) {
    text = "No comp, per the College directory";
  }
  if (!text) return null;
  const dot = { open: "bg-emerald-500", soon: "bg-sky-500", closed: "bg-stone-400", plain: "bg-stone-300" }[tone];
  return (
    <p className="flex items-start gap-2 text-sm text-stone-700 dark:text-stone-300">
      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />
      <span>
        {text}
        {tone !== "plain" ? (
          <>
            {" · "}
            <a href="#how-to-join" className="text-stone-500 underline underline-offset-2 dark:text-stone-400">
              details
            </a>
          </>
        ) : null}
      </span>
    </p>
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
  cycle: built,
  open,
  fixture,
}: {
  url: string;
  label: string | null;
  /** The recruiting cycle this link belongs to, when it is that cycle's application URL. */
  cycle: CycleSummary | null;
  /** The club says anyone can join. */
  open: boolean;
  fixture: boolean;
}) {
  const { cycle, now } = useLiveCycle(built);
  const live = cycle ? isRecruitingNow(cycle.status) : false;
  const closed = cycle?.status === "closed";
  const primary = live || (open && !closed);
  const text = live
    ? "Apply"
    : open && !closed
      ? "Join"
      : closed
        ? `${formatTerm(cycle!.termKey)} application (closed)`
        : "How to apply";
  const due = live && cycle?.deadline && now ? ` · due ${relativeDateValue(cycle.deadline, now)}` : "";
  const className = primary
    ? "inline-flex h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-hover sm:h-9"
    : "inline-flex h-11 items-center gap-1.5 rounded-full border border-stone-300 px-4 text-sm text-stone-700 hover:border-stone-500 hover:text-stone-900 sm:h-9 dark:border-stone-700 dark:text-stone-300 dark:hover:text-stone-100";
  const aria = `${text}${label ? `: ${label}` : ""} (opens in a new tab)`;
  if (fixture)
    return (
      <span className={className} title="Demo link — fixture data does not point anywhere real">
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
