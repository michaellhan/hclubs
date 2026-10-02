import type { DateValue } from "./fields/values";
import { dateValueEnd, dateValueStart } from "./fields/value-utils";
import { compareTermKeys, termForDate, termKey } from "./term-utils";
import type { JoinMode } from "./enum-values";

/**
 * Recruiting-cycle status is COMPUTED at read time from date claims and `now`
 * (CLAUDE.md §8); it is never stored as a fact unless a source states it.
 *
 *  - "open":          opening date has passed (or source states open) and deadline not passed
 *  - "deadline_ahead": a future deadline is known but the opening date is not
 *  - "upcoming":      opening date is in the future
 *  - "closed":        deadline has passed (or source states closed)
 *  - "unknown":       not enough information
 */
export type CycleStatus = "open" | "deadline_ahead" | "upcoming" | "closed" | "unknown";

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  open: "Applications open",
  deadline_ahead: "Deadline ahead",
  upcoming: "Opens soon",
  closed: "Closed",
  unknown: "Status unknown",
};

export function computeCycleStatus(
  cycle: {
    opensAt: DateValue | null;
    deadline: DateValue | null;
    statedStatus: "open" | "closed" | null;
    /** The cycle's term: a past term's cycle is never current (ADR 0031). */
    termKey?: string;
    /**
     * When a club or official page last showed this cycle's facts. A bare "applications are
     * open" (no dates) seen longer ago than `STATED_OPEN_FRESH_DAYS` is no longer "open"
     * (ADR 0041): recruiting windows are short, and the page may have changed since.
     */
    lastVerifiedAt?: string | null;
  },
  now: Date,
): CycleStatus {
  const status = statusFromDates(cycle, now);
  if (
    status === "open" &&
    cycle.statedStatus === "open" &&
    !cycle.deadline &&
    cycle.lastVerifiedAt &&
    now.getTime() - Date.parse(cycle.lastVerifiedAt) > STATED_OPEN_FRESH_DAYS * 86_400_000
  )
    return "unknown";
  if (
    cycle.termKey &&
    status !== "closed" &&
    compareTermKeys(cycle.termKey, termKey(termForDate(now))) < 0 &&
    !(cycle.deadline && dateValueEnd(cycle.deadline).getTime() > now.getTime())
  )
    // "Applications are open" said in an earlier term, with no date still ahead.
    return "unknown";
  if (
    status === "deadline_ahead" &&
    cycle.termKey &&
    compareTermKeys(cycle.termKey, termKey(termForDate(now))) > 0 &&
    cycle.deadline &&
    dateValueEnd(cycle.deadline).getTime() - now.getTime() > FAR_DEADLINE_DAYS * 86_400_000
  )
    // Next term's deadline months away, opening date unknown: not "recruiting now".
    return "upcoming";
  return status;
}

/**
 * A deadline in a later term this far off (with no opening date) is "upcoming", not
 * "deadline ahead": in October a February deadline doesn't mean applications are open. Short
 * enough that August's notice of a September deadline still counts as recruiting.
 */
export const FAR_DEADLINE_DAYS = 75;

/** How long an undated "applications are open" stays "open" after we last saw it. */
export const STATED_OPEN_FRESH_DAYS = 21;

function statusFromDates(
  cycle: { opensAt: DateValue | null; deadline: DateValue | null; statedStatus: "open" | "closed" | null },
  now: Date,
): CycleStatus {
  const t = now.getTime();
  const deadlineEnd = cycle.deadline ? dateValueEnd(cycle.deadline).getTime() : null;
  // An opening after the deadline can't both be right (often an event or results date read
  // as an opening); the stated deadline is the actionable fact, so the opening is ignored.
  const opensStart = cycle.opensAt && !opensAfterDeadline(cycle) ? dateValueStart(cycle.opensAt).getTime() : null;

  if (deadlineEnd !== null && t > deadlineEnd) return "closed";
  if (opensStart !== null && t < opensStart) return "upcoming";
  if (cycle.statedStatus === "closed") return "closed";
  if (opensStart !== null && t >= opensStart)
    return deadlineEnd !== null || cycle.statedStatus === "open" ? "open" : "unknown";
  if (cycle.statedStatus === "open") return "open";
  if (deadlineEnd !== null) return "deadline_ahead";
  return "unknown";
}

/** The cycle's stated opening is after its stated deadline (inconsistent sources). */
export function opensAfterDeadline(cycle: { opensAt: DateValue | null; deadline: DateValue | null }): boolean {
  return Boolean(
    cycle.opensAt && cycle.deadline && dateValueStart(cycle.opensAt).getTime() > dateValueEnd(cycle.deadline).getTime(),
  );
}

/** "Recruiting now" = the cycle is open or has a known future deadline. */
export function isRecruitingNow(status: CycleStatus): boolean {
  return status === "open" || status === "deadline_ahead";
}

/** The process a cycle's next step is phrased around (application first: "Apply by …"). */
export type StepProcess = "application" | "audition" | "tryout" | "comp";
const STEP_ORDER: readonly StepProcess[] = ["application", "audition", "tryout", "comp"];

/** The process to name in a cycle's next step: the cycle's own, else the club's. PURE. */
export function primaryProcess(
  cycleProcesses: readonly JoinMode[],
  clubModes: readonly JoinMode[] = [],
): StepProcess | null {
  const modes = cycleProcesses.length ? cycleProcesses : clubModes;
  return STEP_ORDER.find((p) => modes.includes(p)) ?? null;
}

const DUE: Record<StepProcess | "none", string> = {
  application: "Apply by",
  comp: "Comp deadline",
  audition: "Audition deadline",
  tryout: "Tryout deadline",
  none: "Deadline",
};
const OPENS: Record<StepProcess | "none", string> = {
  application: "Applications open",
  comp: "Comp starts",
  audition: "Auditions start",
  tryout: "Tryouts start",
  none: "Opens",
};
const STARTED: Record<StepProcess | "none", string> = {
  application: "Applications opened",
  comp: "Comp started",
  audition: "Auditions started",
  tryout: "Tryouts started",
  none: "Opened",
};
const OPEN_NOW: Record<StepProcess | "none", string> = {
  application: "Applications open now",
  comp: "Comp open now",
  audition: "Auditions open now",
  tryout: "Tryouts open now",
  none: "Open now",
};

/**
 * What a student does next, in one line: "Apply by Oct 9, 11:59 PM EDT", "Comp starts Oct 5",
 * "Auditions started Sep 5 · no deadline listed". Wording follows the process (a comp or an
 * audition is not an "application"; CLAUDE.md §9) and the computed status; dates are formatted
 * by the caller (`fmt`), so a date-only deadline never gains a time. PURE.
 */
export function nextStepText(
  cycle: {
    status: CycleStatus;
    opens: DateValue | null;
    deadline: DateValue | null;
    processTypes: readonly JoinMode[];
  },
  clubModes: readonly JoinMode[],
  fmt: (d: DateValue) => string,
): string {
  const p = primaryProcess(cycle.processTypes, clubModes) ?? "none";
  switch (cycle.status) {
    case "open":
    case "deadline_ahead":
      return cycle.deadline ? `${DUE[p]} ${fmt(cycle.deadline)}` : `${OPEN_NOW[p]} · no deadline listed`;
    case "upcoming":
      if (cycle.opens && !opensAfterDeadline({ opensAt: cycle.opens, deadline: cycle.deadline }))
        return `${OPENS[p]} ${fmt(cycle.opens)}`;
      return cycle.deadline ? `${DUE[p]} ${fmt(cycle.deadline)}` : "Dates not listed";
    case "closed":
      return cycle.deadline ? `Closed ${fmt(cycle.deadline)}` : "Closed";
    case "unknown":
      return cycle.opens ? `${startedText(p, cycle.opens, fmt)} · no deadline listed` : "Dates not listed";
  }
}

/** "Comp started Sep 6": the opening date of a round already under way. PURE. */
export function startedText(p: StepProcess | "none", opens: DateValue, fmt: (d: DateValue) => string): string {
  return `${STARTED[p]} ${fmt(opens)}`;
}

/**
 * The profile's wording for a round that started with no deadline: the board's started wording
 * plus what to do about the missing end date. Never claims the round is still open. PURE.
 */
export function startedProfileText(
  cycle: { opens: DateValue; processTypes: readonly JoinMode[] },
  clubModes: readonly JoinMode[],
  fmt: (d: DateValue) => string,
): string {
  const p = primaryProcess(cycle.processTypes, clubModes) ?? "none";
  return `${startedText(p, cycle.opens, fmt)} · no end date listed, check their site`;
}

/** Why an "open to anyone" club's join button names where it goes. */
export interface OpenJoinLink {
  kind: string;
  url: string;
}

/**
 * Where an open-membership student goes to join, from links the club already has, never
 * invented: its website, else Instagram, else an email address. PURE.
 */
export function openJoinTarget(
  links: readonly OpenJoinLink[],
): { kind: "website" | "instagram" | "email"; url: string; text: string } | null {
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  };
  const site = links.find((l) => l.kind === "website" && host(l.url));
  if (site) return { kind: "website", url: site.url, text: `Visit ${host(site.url)} to join` };
  const ig = links.find((l) => l.kind === "instagram");
  if (ig) return { kind: "instagram", url: ig.url, text: "Join via Instagram" };
  const mail = links.find((l) => l.kind === "email");
  if (mail) return { kind: "email", url: mail.url, text: "Email to join" };
  return null;
}

/**
 * The next-step link for a club that recruits (an application, comp or a usual season) but
 * has no application link on record: it points at the club's own site/Instagram/email and
 * says only "check", never that the link is the application. PURE.
 */
export function checkHowToJoinTarget(
  links: readonly OpenJoinLink[],
): { kind: "website" | "instagram" | "email"; url: string; text: string } | null {
  const t = openJoinTarget(links);
  if (!t) {
    // No site of its own: the Harvard/program page about the club is still where to check.
    const page = ["harvard_directory", "other"]
      .flatMap((k) => links.filter((l) => l.kind === k))
      .find((l) => /^https?:\/\//.test(l.url));
    if (!page) return null;
    try {
      const host = new URL(page.url).hostname.replace(/^www\./, "");
      return { kind: "website", url: page.url, text: `Check how to apply at ${host}` };
    } catch {
      return null;
    }
  }
  if (t.kind === "website") return { ...t, text: t.text.replace(/^Visit (.+) to join$/, "Check how to apply at $1") };
  if (t.kind === "instagram") return { ...t, text: "Check their Instagram for how to apply" };
  return { ...t, text: "Email to ask how to apply" };
}

/** Button text for an open club's featured sign-up link, naming its destination. PURE. */
export function openJoinLinkText(url: string): string {
  let h: URL;
  try {
    h = new URL(url);
  } catch {
    return "Join";
  }
  const host = h.hostname.replace(/^www\./, "");
  if (
    host === "forms.gle" ||
    (host === "docs.google.com" && h.pathname.startsWith("/forms")) ||
    host.endsWith("typeform.com")
  )
    return "Join via sign-up form";
  return `Join at ${host}`;
}
