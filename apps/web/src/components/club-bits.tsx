"use client";

import { CYCLE_STATUS_LABEL, JOIN_MODE_LABEL, type CycleStatus, type JoinMode } from "@hci/core";
import { withLiveStatus, type CycleSummary } from "@hci/db/local";
import { formatDateValue, formatTerm, relativeDateValue } from "@/lib/format";
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
export function CycleStatusPill({ cycle: built }: { cycle: CycleSummary }) {
  const liveNow = useNow();
  const now = liveNow ?? new Date(built.deadline?.at ?? built.opens?.at ?? Date.now());
  const cycle = liveNow ? withLiveStatus(built, liveNow) : built;
  const deadline = formatDateValue(cycle.deadline, now);
  let text: string = CYCLE_STATUS_LABEL[cycle.status];
  if ((cycle.status === "open" || cycle.status === "deadline_ahead") && cycle.deadline) {
    text = liveNow ? `Due ${deadline} · ${relativeDateValue(cycle.deadline, liveNow)}` : `Due ${deadline}`;
  } else if (cycle.status === "upcoming" && cycle.opens) {
    text = `Opens ${formatDateValue(cycle.opens, now)}`;
  } else if (cycle.status === "closed") {
    text = `Closed · ${formatTerm(cycle.termKey)}`;
  }
  return (
    <Pill
      tone={STATUS_TONE[cycle.status]}
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

export function JoinModePills({ modes }: { modes: JoinMode[] }) {
  if (modes.length === 0) return null;
  return (
    <>
      {modes.map((m) => (
        <Pill key={m} tone={SELECTIVE.has(m) ? "neutral" : "green"}>
          {JOIN_MODE_LABEL[m]}
        </Pill>
      ))}
    </>
  );
}
