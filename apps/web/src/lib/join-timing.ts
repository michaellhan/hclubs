import {
  dateValueStart,
  isRecruitingNow,
  startedProfileText,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core/browser";
import { isPastTerm, startedWindowDays, type CycleSummary, type JoiningSummary } from "@hci/db/local";
import { NO_NEXT_ROUND, nextChanceText } from "./compare-summary";
import { formatDateValue, formatDay, formatTerm, relativeDateValue } from "./format";

export type TimingTone = "open" | "soon" | "closed" | "plain";

/** The profile's "When" answer: a short headline, an optional second line, and a status tone. */
export interface JoinTiming {
  text: string;
  sub: string | null;
  tone: TimingTone;
}

const SEASON_WORD: Record<RecruitingSeason, string> = {
  fall: "in fall",
  spring: "in spring",
  summer: "in summer",
  winter: "in winter",
  rolling: "on a rolling basis",
};

const lowerFirst = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

/**
 * "By when?" for the top of a profile, from dated evidence only (CLAUDE.md §8). `cycle` must
 * already carry its live status; `now` is null before mount (prebuilt HTML), so relative words
 * ("in 3 days") are left out and `ref` stands in for formatting. Null when nothing is known:
 * the caller says "Unknown" rather than guessing. PURE.
 */
export function joinTiming(
  {
    cycle,
    joining,
    seasons,
    joinModes,
  }: {
    cycle: CycleSummary | null;
    joining: Pick<JoiningSummary, "access">;
    seasons: readonly RecruitingSeason[];
    joinModes: readonly JoinMode[];
  },
  ref: Date,
  now: Date | null,
): JoinTiming | null {
  const status = cycle?.status ?? null;
  const term = cycle ? formatTerm(cycle.termKey) : "";
  const fmt = (d: CycleSummary["deadline"]) => formatDateValue(d, ref) ?? "";
  const pattern = seasons.length ? `Usually recruits ${seasons.map((s) => SEASON_WORD[s]).join(" and ")}` : null;

  if (cycle && status && isRecruitingNow(status)) {
    return cycle.deadline
      ? {
          text: `Apply by ${fmt(cycle.deadline)}${now ? ` · ${relativeDateValue(cycle.deadline, now)}` : ""}`,
          sub: `${term} applications are open`,
          tone: "open",
        }
      : { text: "Applications open now", sub: `${term} · no deadline listed`, tone: "open" };
  }
  if (cycle && status === "upcoming") {
    return {
      text: cycle.opens ? `Applications open ${fmt(cycle.opens)}` : "Applications open soon",
      sub: cycle.deadline ? `${term} · due ${fmt(cycle.deadline)}` : term,
      tone: "soon",
    };
  }
  // Open membership outlasts a closed round: "closed" beside "Open membership" would contradict it.
  if (joining.access === "open") {
    const byAttending = joinModes.includes("attendance_based") && !joinModes.includes("open");
    return { text: "Anytime", sub: byAttending ? "Join by coming to meetings" : "No deadline to join", tone: "plain" };
  }
  if (cycle && status === "closed") {
    // The same "next chance" the compare table and board use: a pattern, never a date.
    const next = nextChanceText({ cycle, seasons: [...seasons], openAccess: false }, ref, (d) => formatDay(d, ref));
    // A closed round's hour doesn't matter any more: the day is enough.
    return {
      text: `${term} round closed${cycle.deadline ? ` ${formatDay(cycle.deadline, ref)}` : ""}`,
      sub: !next ? null : next === NO_NEXT_ROUND ? "No next round announced yet" : `Next: ${lowerFirst(next)}`,
      tone: "closed",
    };
  }
  if (
    cycle &&
    cycle.opens &&
    !cycle.deadline &&
    status === "unknown" &&
    !isPastTerm(cycle.termKey, ref) &&
    dateValueStart(cycle.opens).getTime() <= ref.getTime()
  ) {
    // Started, no end date: stop calling it live once it is older than the board's window.
    const age = (ref.getTime() - dateValueStart(cycle.opens).getTime()) / 86_400_000;
    const [text = "", ...rest] = startedProfileText(
      { opens: cycle.opens, processTypes: cycle.processTypes },
      joinModes,
      fmt,
    ).split(" · ");
    return {
      text,
      sub: rest.join(" · ") || null,
      tone: age <= startedWindowDays(cycle.processTypes, joinModes) ? "soon" : "plain",
    };
  }
  if (pattern) return { text: pattern, sub: "No dates for this term on record yet", tone: "plain" };
  return null;
}
