"use client";

import {
  CYCLE_STATUS_LABEL,
  JOIN_MODE_HELP,
  JOIN_MODE_LABEL,
  dateValueEnd,
  type CycleStatus,
  type JoinMode,
} from "@hci/core/browser";
import { withLiveStatus, type CycleSummary, type JoiningSummary } from "@hci/db/local";
import { JOINING_FILTERS } from "@/lib/joining";
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
    text = cycle.deadline ? `Closed ${deadline}` : `Closed · ${formatTerm(cycle.termKey)}`;
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

const SELECTIVE = new Set<JoinMode>(["application", "comp", "audition", "tryout", "invite_only"]);

/**
 * Join-mode pills, selective modes first (they're what a student needs to prepare for).
 * With `max`, extra modes collapse into "+1".
 */
export function JoinModePills({ modes, max }: { modes: JoinMode[]; max?: number }) {
  if (modes.length === 0) return null;
  const sorted = [...modes].sort((a, b) => Number(SELECTIVE.has(b)) - Number(SELECTIVE.has(a)));
  const shown = max ? sorted.slice(0, max) : sorted;
  const rest = sorted.slice(shown.length);
  return (
    <>
      {shown.map((m) => (
        <Pill key={m} tone={SELECTIVE.has(m) ? "neutral" : "green"} title={JOIN_MODE_HELP[m]}>
          {JOIN_MODE_LABEL[m]}
        </Pill>
      ))}
      {rest.length ? (
        <Pill tone="muted" title={rest.map((m) => JOIN_MODE_LABEL[m]).join(", ")}>
          +{rest.length}
        </Pill>
      ) : null}
    </>
  );
}

/**
 * How general members join, from the derived joining facts (ADR 0041): the processes a
 * source names, "No cuts" for a completion-based comp, "No comp" from the College directory
 * alone, or "Sources differ". Processes only for a board or a team never show here.
 */
export function JoiningPills({ joining, max }: { joining: JoiningSummary; max?: number }) {
  if (joining.access === "mixed")
    return (
      <Pill tone="amber" title="Sources disagree about how members join; the profile shows both.">
        Joining: sources differ
      </Pill>
    );
  if (joining.access)
    return (
      <>
        <JoinModePills modes={joining.general} {...(max ? { max } : {})} />
        {joining.noCuts ? (
          <Pill tone="green" title="A source says everyone who completes the comp (or audition) becomes a member.">
            No cuts
          </Pill>
        ) : null}
      </>
    );
  if (joining.comp === false)
    return (
      <Pill tone="green" title={JOINING_FILTERS.noComp.help}>
        {JOINING_FILTERS.noComp.label}
      </Pill>
    );
  return null;
}
