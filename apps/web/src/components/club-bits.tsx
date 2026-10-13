"use client";

import { CYCLE_STATUS_LABEL, dateValueEnd, type CycleStatus } from "@hci/core/browser";
import { withLiveStatus, type CycleSummary, type JoiningSummary } from "@hci/db/local";
import { JOINING_FILTERS, accessDisagrees, accessText } from "@/lib/joining";
import { joinPills } from "@/lib/joining-pills";
import { formatDay, formatTerm, relativeDateValue } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { Pill, type Tone } from "./ui";

const STATUS_TONE: Record<CycleStatus, Tone> = {
  open: "green",
  deadline_ahead: "green",
  upcoming: "blue",
  closed: "neutral",
  unknown: "muted",
};

/**
 * Recruiting status, recomputed from the cycle's dates in the viewer's browser (pages are
 * prebuilt, so the build-time status may be out of date). Before mount it shows the
 * build-time status without relative wording.
 */
export function CycleStatusPill({
  cycle: built,
  hideClosedAfterDays,
}: {
  cycle: CycleSummary;
  /** Render nothing for a cycle that closed more than this many days ago (lists). */
  hideClosedAfterDays?: number;
}) {
  const liveNow = useNow();
  const now = liveNow ?? new Date(built.deadline?.at ?? built.opens?.at ?? Date.now());
  const cycle = liveNow ? withLiveStatus(built, liveNow) : built;
  const deadline = formatDay(cycle.deadline, now);
  let text: string = CYCLE_STATUS_LABEL[cycle.status];
  if ((cycle.status === "open" || cycle.status === "deadline_ahead") && cycle.deadline) {
    text = liveNow ? `Due ${deadline} · ${relativeDateValue(cycle.deadline, liveNow)}` : `Due ${deadline}`;
  } else if (cycle.status === "upcoming" && cycle.opens) {
    text = `Opens ${formatDay(cycle.opens, now)}`;
  } else if (cycle.status === "upcoming" && cycle.deadline) {
    text = `${formatTerm(cycle.termKey)} · due ${deadline}`;
  } else if (cycle.status === "closed") {
    // No date: the club said its applications closed ("… for the Fall 2026 semester have closed").
    text = cycle.deadline ? `Closed ${deadline}` : `${formatTerm(cycle.termKey)} applications closed`;
  }
  if (
    hideClosedAfterDays !== undefined &&
    liveNow &&
    cycle.status === "closed" &&
    (!cycle.deadline || liveNow.getTime() - dateValueEnd(cycle.deadline).getTime() > hideClosedAfterDays * 86_400_000)
  )
    return null;
  // Due within three days: say so in amber.
  const soon =
    liveNow !== null &&
    (cycle.status === "open" || cycle.status === "deadline_ahead") &&
    cycle.deadline !== null &&
    dateValueEnd(cycle.deadline).getTime() - liveNow.getTime() < 3 * 86_400_000;
  return (
    <Pill
      tone={soon ? "amber" : STATUS_TONE[cycle.status]}
      title={`${formatTerm(cycle.termKey)} recruiting — ${CYCLE_STATUS_LABEL[cycle.status]}`}
    >
      {cycle.status === "open" || cycle.status === "deadline_ahead" ? (
        <span className="size-1.5 rounded-full bg-current" />
      ) : null}
      {text}
    </Pill>
  );
}

/**
 * How general members join, from the derived joining facts (ADR 0041): the processes a
 * source names ("Comp, no cuts", never beside a contradicting "Open membership"; see
 * `joinPills`), "No comp" from the College directory alone, or "Sources differ". Processes
 * only for a board or a team never show here. With `max`, extra pills collapse into "+1".
 * `tips` makes each pill reachable by Tab and tap, so its explanation shows on a phone; leave
 * it off inside a row whose tap opens the club.
 */
export function JoiningPills({
  joining,
  max,
  tips = false,
}: {
  joining: JoiningSummary;
  max?: number;
  tips?: boolean;
}) {
  if (joining.access === "mixed" && !accessDisagrees(joining))
    return (
      <Pill
        tone="muted"
        title="The club names both: one group holds this process, another is open to anyone."
        focusable={tips}
      >
        {accessText(joining)}
      </Pill>
    );
  if (joining.access === "mixed")
    return (
      <Pill tone="amber" title="Sources disagree about how members join; the profile shows both." focusable={tips}>
        Joining: sources differ
      </Pill>
    );
  if (joining.access) {
    const { pills, hidden } = joinPills(joining.general, joining.noCuts, max);
    return (
      <>
        {pills.map((p) => (
          <Pill key={p.label} tone={p.tone} title={p.tip} focusable={tips}>
            {p.label}
          </Pill>
        ))}
        {hidden.length ? (
          <Pill tone="muted" title={hidden.join(", ")} focusable={tips}>
            +{hidden.length}
          </Pill>
        ) : null}
      </>
    );
  }
  if (joining.comp === false)
    return (
      <Pill tone="green" title={JOINING_FILTERS.noComp.help} focusable={tips}>
        {JOINING_FILTERS.noComp.label}
      </Pill>
    );
  return null;
}
