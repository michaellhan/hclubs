import { JOIN_MODE_LABEL, JOIN_ROLE_LABEL, type JoinMode } from "@hci/core/browser";
import type { JoiningSummary } from "@hci/db/local";

/**
 * Words for the derived joining facts (ADR 0041), shared by the directory filters, chips,
 * home presets, result rows, profiles and compare, so a fact reads the same everywhere.
 * Labels say only what the evidence supports; caveats live in `help`.
 */
export const JOINING_FILTERS = {
  recruitingNow: {
    label: "Recruiting now",
    help: "Applications are open, or a dated deadline is still ahead.",
  },
  openJoin: {
    label: "Open membership",
    help: "A source says anyone can join, or that you become a member by showing up — no application, comp, audition or tryout for general members.",
  },
  noComp: {
    label: "No comp",
    help: "The College's directory or the club says there's no comp. There may still be an application or audition.",
  },
  freshmenEligible: {
    label: "First-years eligible",
    help: "A source says first-years, all class years, or all Harvard undergraduates can join.",
  },
  noDues: {
    label: "No dues",
    help: "A source (usually the College's directory) says no dues are required. Other costs may apply.",
  },
} as const;
export type JoiningFilterKey = keyof typeof JOINING_FILTERS;

/** The processes students filter by; open and attendance-based membership are "Open membership". */
export const PROCESS_MODES: JoinMode[] = ["application", "comp", "audition", "tryout", "invite_only"];

const OPEN: JoinMode[] = ["open", "attendance_based"];
const lower = (m: JoinMode) => (m === "invite_only" ? "invitation" : JOIN_MODE_LABEL[m].toLowerCase());

/**
 * One line for how general members join: "Open membership", "Application, then comp",
 * "Comp (no cuts)", or null when nothing is known. Mixed sources read "Sources differ".
 */
export function accessText(j: JoiningSummary): string | null {
  if (j.access === "open")
    return j.general.includes("attendance_based") && !j.general.includes("open")
      ? "Open membership (by attendance)"
      : "Open membership";
  if (j.access === "mixed")
    return `Sources differ: ${[...new Set(j.general.map((m) => (OPEN.includes(m) ? "open" : lower(m))))].join(" or ")}`;
  if (j.access === "process") {
    const modes = j.general.filter((m) => PROCESS_MODES.includes(m));
    const text = modes.map((m, i) => (i ? lower(m) : JOIN_MODE_LABEL[m])).join(", ");
    return j.noCuts ? `${text} (no cuts)` : text;
  }
  if (j.comp === false) return "No comp";
  return null;
}

/** "Selective only for board and leadership roles and competition teams", or null. */
export function rolesText(j: JoiningSummary): string | null {
  if (!j.roles.length) return null;
  const parts = [...new Set(j.roles.map((r) => `${lower(r.mode)} for ${JOIN_ROLE_LABEL[r.role]}`))];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!;
  return `Also: ${list}`;
}
