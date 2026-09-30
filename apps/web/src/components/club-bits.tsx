import { CYCLE_STATUS_LABEL, JOIN_MODE_LABEL, type CycleStatus, type JoinMode } from "@hci/core";
import type { CycleSummary } from "@hci/db";
import { formatDateValue, formatTerm, relativeDateValue } from "@/lib/format";
import { Pill, type Tone } from "./ui";

const STATUS_TONE: Record<CycleStatus, Tone> = {
  open: "green",
  deadline_ahead: "green",
  upcoming: "blue",
  closed: "neutral",
  unknown: "muted",
};

export function CycleStatusPill({ cycle, now }: { cycle: CycleSummary; now: Date }) {
  const deadline = formatDateValue(cycle.deadline, now);
  let text: string = CYCLE_STATUS_LABEL[cycle.status];
  if ((cycle.status === "open" || cycle.status === "deadline_ahead") && cycle.deadline) {
    text = `Due ${deadline} · ${relativeDateValue(cycle.deadline, now)}`;
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
  if (modes.length === 0) return <Pill tone="muted">Joining: unknown</Pill>;
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
