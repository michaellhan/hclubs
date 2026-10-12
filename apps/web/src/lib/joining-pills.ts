import { JOIN_MODE_HELP, JOIN_MODE_LABEL, SELECTIVE_JOIN_MODES, type JoinMode } from "@hci/core/browser";

export interface JoinPill {
  label: string;
  tone: "neutral" | "green";
  tip: string;
}

const NO_CUTS_TIP = "A source says everyone who completes the comp (or audition) becomes a member.";

/**
 * The pills that say how general members join, without contradicting themselves:
 * - a selective process (comp, audition, ...) outranks "Open membership" / "Attendance-based",
 *   since it's what a student has to prepare for;
 * - "No cuts" folds into that process ("Audition, no cuts") instead of sitting beside "Open";
 * - open membership and attendance-based collapse to one pill ("Open membership").
 * Selective modes come first; `max` caps the list and the rest are named in `hidden`. PURE.
 */
export function joinPills(
  modes: readonly JoinMode[],
  noCuts: boolean,
  max?: number,
): { pills: JoinPill[]; hidden: string[] } {
  const selective = modes.filter((m) => SELECTIVE_JOIN_MODES.includes(m));
  const pills: JoinPill[] = selective.map((m, i) => ({
    label: noCuts && i === 0 ? `${JOIN_MODE_LABEL[m]}, no cuts` : JOIN_MODE_LABEL[m],
    tone: "neutral",
    tip: noCuts && i === 0 ? `${JOIN_MODE_HELP[m]} ${NO_CUTS_TIP}` : JOIN_MODE_HELP[m],
  }));
  if (!selective.length) {
    // Open and attendance-based say the same thing to a student: show the one stated first.
    const open: JoinMode | undefined = modes.includes("open")
      ? "open"
      : modes.includes("attendance_based")
        ? "attendance_based"
        : undefined;
    if (open) pills.push({ label: JOIN_MODE_LABEL[open], tone: "green", tip: JOIN_MODE_HELP[open] });
  }
  const shown = max ? pills.slice(0, max) : pills;
  return { pills: shown, hidden: pills.slice(shown.length).map((p) => p.label) };
}
