import {
  JOIN_MODE_LABEL,
  compareTermKeys,
  isRecruitingNow,
  termForDate,
  termKey,
  type CycleStatus,
  type DateValue,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core/browser";
import {
  followingSeason,
  isPastTerm,
  isRecentPastTerm,
  recruitingSeasonForDate,
  usualNextRound,
  type PastRound,
} from "@hci/db/local";
import { formatDay, formatRange, formatTerm } from "./format";

/**
 * A short, neutral summary of a comparison, built only from the structured facts in the
 * table (never generated text, never a judgment of which club is better). Each sentence
 * covers one dimension and says plainly which clubs don't publish it. PURE.
 */
export interface SummaryClub {
  name: string;
  joinModes: JoinMode[];
  hours: { min: number | null; max: number | null } | null;
  seasons: RecruitingSeason[];
  cycle: { status: CycleStatus; termKey: string; deadline: DateValue | null } | null;
  firstYears: boolean | null;
  /** No comp is required (an application may remain); stated plainly, without naming a source. */
  noComp?: boolean;
  /** A source says anyone can join (derived `joining.access = open`). */
  openAccess?: boolean;
  /** A source says the organization ended: it's named once and left out of the rest. */
  ended?: boolean;
  /** The next round the club's own pages announce for a later term (`announcedLaterRound`). */
  later?: AnnouncedRound | null;
  /** The club's most recent evidenced round from an earlier term (`lastPastRound`). */
  last?: PastRound | null | undefined;
  /** Its one comp, audition or tryout admits everyone who completes it (`joining.noCuts`). */
  noCuts?: boolean;
}

/** A round announced for a later term, before any date: its term and process. */
export type AnnouncedRound = {
  termKey: string;
  processTypes: readonly JoinMode[];
  /** The round's own facts say its comp, audition or tryout has no cuts (`cycleNoCuts`). */
  noCuts?: boolean | undefined;
};

const ROUND_NOUN: Partial<Record<JoinMode, string>> = {
  audition: "auditions",
  tryout: "tryouts",
  comp: "comp",
  application: "applications",
};

/**
 * "Next auditions: Fall 2027": the round the club's own pages announce, named by its process
 * (the round's own, else how the club's members join when that is one process), never with a
 * date the club hasn't given. A round its own facts say has no cuts says so ("Next comp:
 * Spring 2027, no cuts"); a comp alone never implies selectivity (§9). PURE.
 */
export function announcedRoundText(later: AnnouncedRound, joinModes: readonly JoinMode[] = []): string {
  const noCuts = later.noCuts && later.processTypes.some((m) => NO_CUT_MODES.includes(m));
  return `Next ${announcedRoundNoun(later, joinModes)}: ${formatTerm(later.termKey)}${noCuts ? ", no cuts" : ""}`;
}

const NO_CUT_MODES: readonly JoinMode[] = ["comp", "audition", "tryout"];

/**
 * "Last comp: Spring 2026": when the club last recruited, from a round on record in an earlier
 * term. History only, never "usually" (one round isn't a pattern, CLAUDE.md §2.2). PURE.
 */
export function lastRoundText(last: PastRound, joinModes: readonly JoinMode[] = []): string {
  return `Last ${announcedRoundNoun(last, joinModes)}: ${formatTerm(last.termKey)}`;
}

/** The last round, while it is still an earlier term and no more than a year back. PURE. */
export function recentLast(last: PastRound | null | undefined, now: Date): PastRound | null {
  return last && isRecentPastTerm(last.termKey, now) ? last : null;
}

function announcedRoundNoun(later: Pick<AnnouncedRound, "processTypes">, joinModes: readonly JoinMode[]): string {
  const own = later.processTypes.filter((m) => ROUND_NOUN[m]);
  const club = joinModes.filter((m) => ROUND_NOUN[m]);
  const mode = own.length === 1 ? own[0] : own.length === 0 && club.length === 1 ? club[0] : undefined;
  return (mode && ROUND_NOUN[mode]) ?? "round";
}

/**
 * The compare table's "Next chance" cell: when a student can next get in, from the live
 * cycle status and the club's sourced recruiting pattern (never a guessed date). Mirrors the
 * recruiting board: open membership = join anytime; an open round = its deadline; a round the
 * club announced for a later term; rolling; otherwise the next usual term. Null when nothing
 * is known. PURE.
 */
/** `nextChanceText` for a closed round with no pattern to point to. */
export const NO_NEXT_ROUND = "No next round known, check with the club";

export function nextChanceText(
  c: NextChanceInput,
  now: Date,
  fmt: (d: DateValue) => string | null = (d) => formatDay(d, now),
): string | null {
  return nextChance(c, now, fmt, false);
}

type NextChanceInput = Pick<SummaryClub, "cycle" | "openAccess" | "later" | "last"> & {
  seasons: readonly RecruitingSeason[];
  joinModes?: readonly JoinMode[] | undefined;
};

/**
 * The same decision as `nextChanceText`, worded for a row or a profile's second line: no
 * "Usually recruits …" lead-in (the pattern is stated elsewhere) and null for "no next round
 * known". Directory rows, /saved, the profile and compare therefore always agree. PURE.
 */
export function nextChanceShort(
  c: NextChanceInput,
  now: Date,
  fmt: (d: DateValue) => string | null = (d) => formatDay(d, now),
): string | null {
  const t = nextChance(c, now, fmt, true);
  return t === NO_NEXT_ROUND ? null : t;
}

function nextChance(
  c: NextChanceInput,
  now: Date,
  fmt: (d: DateValue) => string | null,
  short: boolean,
): string | null {
  const cy = c.cycle;
  if (cy && isRecruitingNow(cy.status))
    return cy.deadline ? `Recruiting now · due ${fmt(cy.deadline)}` : "Recruiting now";
  if (c.openAccess) return "Join anytime (open membership)";
  if (cy && cy.status === "upcoming") return `${formatTerm(cy.termKey)} round announced`;
  // The club named its next round: that outranks its usual seasons (ADR 0051 amendment).
  if (c.later && compareTermKeys(c.later.termKey, termKey(termForDate(now))) > 0)
    return announcedRoundText(c.later, c.joinModes);
  if (c.seasons.includes("rolling")) return "Recruits on a rolling basis";
  const season = recruitingSeasonForDate(now);
  // This term's round, not last year's same season.
  const closedNow = cy?.status === "closed" && cy.termKey.endsWith(`-${season}`) && !isPastTerm(cy.termKey, now);
  const usual = usualNextRound(c.seasons, now);
  if (usual?.thisTerm && !closedNow) return `Usually recruits this ${season}; no dates yet`;
  // This term's round closed, or (late in the term) most likely passed: point to the next one.
  const after = usual?.thisTerm ? usualNextRound(c.seasons, now, true) : usual;
  if (after) {
    // Late in the term with no round on record: it's the pattern talking, so say so ("likely").
    if (short)
      return after.nextYear ? `Next round likely next ${after.season}` : `Next round likely in ${after.season}`;
    if (c.seasons.includes(season) && !closedNow)
      return after.nextYear
        ? `Usually recruits ${seasonsPhrase(c.seasons)}; again next ${after.season}`
        : `Usually recruits ${seasonsPhrase(c.seasons)}; next likely in ${after.season}`;
    return after.nextYear
      ? `Usually recruits again next ${after.season}`
      : `Usually recruits again in ${after.season === "spring" ? "Spring" : "Fall"}`;
  }
  // A round that already closed with no pattern: say what to do rather than a bare Unknown.
  if (cy?.status === "closed") return NO_NEXT_ROUND;
  // No pattern and no round this term: when the club last recruited is still worth knowing.
  const last = recentLast(c.last, now);
  if (last)
    return short ? lastRoundText(last, c.joinModes) : `${lastRoundText(last, c.joinModes)}; no next round known`;
  return null;
}

const SELECTIVE: JoinMode[] = ["application", "comp", "audition", "tryout", "invite_only"];

/** "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const article = (m: JoinMode) =>
  m === "invite_only"
    ? "invitation only"
    : `${/^[aeiou]/i.test(JOIN_MODE_LABEL[m]) ? "an" : "a"} ${JOIN_MODE_LABEL[m].toLowerCase()}`;

/**
 * "open membership", "a comp", "an audition with no cuts", "open membership (an audition with
 * no cuts)": how general members join, with a no-cut process kept beside an open club's
 * membership (the Band: anyone who wants to join can, through an audition that cuts no one).
 */
function joinPhrase(c: Pick<SummaryClub, "joinModes" | "openAccess" | "noCuts">, inParens = false): string {
  const modes = c.joinModes;
  const sel = modes.filter((m) => SELECTIVE.includes(m));
  const open = modes.includes("open");
  const attendance = modes.includes("attendance_based");
  // "open membership", "attendance-based membership", "open, attendance-based membership".
  const membership = `${[open ? "open" : "", attendance ? "attendance-based" : ""].filter(Boolean).join(", ") || "open"} membership`;
  if (!sel.length && (open || attendance || c.openAccess)) return membership;
  const words = (sel.length ? sel : modes).map(article);
  const process = c.noCuts && sel.length === 1 ? `${words[0]} with no cuts` : listNames(words);
  if (!c.openAccess || !sel.length) return process;
  // Already inside parentheses ("Band (open membership, an audition with no cuts)"): a comma.
  return inParens ? `${membership}, ${process}` : `${membership} (${process})`;
}

/** "A, B and C use an audition; D uses a comp": clubs that join the same way named together. */
function groupedPhrases(phrases: { name: string; phrase: string }[]): string {
  const groups = new Map<string, string[]>();
  for (const p of phrases) groups.set(p.phrase, [...(groups.get(p.phrase) ?? []), p.name]);
  if (groups.size === 1 && phrases.length > 1)
    return `${listNames(phrases.map((p) => p.name))} ${phrases.length === 2 ? "both" : "all"} use ${phrases[0]!.phrase}`;
  return [...groups]
    .map(([phrase, names]) => `${listNames(names)} ${names.length === 1 ? "uses" : "use"} ${phrase}`)
    .join("; ");
}

/** "in fall and spring", "on a rolling basis", "in fall, or on a rolling basis". */
function seasonsPhrase(seasons: readonly RecruitingSeason[]): string {
  const terms = seasons.filter((x) => x !== "rolling");
  const rolling = seasons.includes("rolling");
  if (!terms.length) return "on a rolling basis";
  return `in ${listNames(terms)}${rolling ? ", or on a rolling basis" : ""}`;
}

/** The announced later round, when it is still ahead of `now`. */
function laterOf(c: SummaryClub, now: Date): AnnouncedRound | null {
  return c.later && compareTermKeys(c.later.termKey, termKey(termForDate(now))) > 0 ? c.later : null;
}

/** "Pitches (next auditions: Fall 2027)": the row's wording, lower-cased after the name. */
function announcedClause(c: SummaryClub, later: AnnouncedRound): string {
  const t = announcedRoundText(later, c.joinModes);
  return `${c.name} (${t.charAt(0).toLowerCase()}${t.slice(1)})`;
}

/** "HIA (last comp: Spring 2026)". */
function lastClause(c: SummaryClub, last: PastRound): string {
  const t = lastRoundText(last, c.joinModes);
  return `${c.name} (${t.charAt(0).toLowerCase()}${t.slice(1)})`;
}

const recruitingNow = (c: SummaryClub) => Boolean(c.cycle && isRecruitingNow(c.cycle.status));

export function compareSummary(all: SummaryClub[], now: Date): string[] {
  if (all.length < 2) return [];
  const out: string[] = [];
  const gone = all.filter((c) => c.ended).map((c) => c.name);
  if (gone.length) out.push(`${listNames(gone)} ${gone.length === 1 ? "is" : "are"} no longer active.`);
  const clubs = all.filter((c) => !c.ended);
  if (!clubs.length) return out;

  // Who can be joined now, first: it's the question a student brings to a comparison.
  const joinNow = clubs.filter((c) => c.openAccess || recruitingNow(c));
  if (joinNow.length) {
    const parts = joinNow.map((c) => {
      if (c.openAccess) return `${c.name} (${joinPhrase(c, true)})`;
      const due = c.cycle?.deadline ? formatDay(c.cycle.deadline, now) : null;
      return `${c.name} (${due ? `applications due ${due}` : "applications open"})`;
    });
    out.push(`Can join now: ${parts.join("; ")}.`);
  }

  // How to join: open clubs were just named with their membership.
  const rest = clubs.filter((c) => !c.openAccess);
  const withJoin = rest.filter((c) => c.joinModes.length);
  const noJoin = rest.filter((c) => !c.joinModes.length).map((c) => c.name);
  if (withJoin.length || noJoin.length) {
    let s = withJoin.length ? `${groupedPhrases(withJoin.map((c) => ({ name: c.name, phrase: joinPhrase(c) })))}.` : "";
    const flagOnly = rest.filter((c) => !c.joinModes.length && c.noComp).map((c) => c.name);
    const silent = noJoin.filter((n) => !flagOnly.includes(n));
    if (flagOnly.length) s += ` ${listNames(flagOnly)} ${flagOnly.length === 1 ? "has" : "have"} no comp.`;
    // "doesn't say how to join" only beside clubs that do say.
    if (silent.length && (withJoin.length || joinNow.length))
      s += ` ${listNames(silent)} ${silent.length === 1 ? "doesn't" : "don't"} say how to join.`;
    s = s.trim();
    if (s) out.push(s.charAt(0).toUpperCase() + s.slice(1));
  }

  // Dates: rounds closed or opening later (live rounds were named above), announced next
  // rounds, usual seasons, and when the club last recruited.
  const dated = clubs.filter((c) => c.cycle && c.cycle.status !== "unknown" && !recruitingNow(c) && !c.openAccess);
  const undated = clubs.filter((c) => !c.openAccess && !recruitingNow(c) && !dated.includes(c));
  const announced = undated.filter((c) => laterOf(c, now));
  const pattern = undated.filter((c) => !laterOf(c, now) && c.seasons.length);
  const lastOnly = undated.flatMap((c) => {
    const last = !laterOf(c, now) && !c.seasons.length ? recentLast(c.last, now) : null;
    return last ? [lastClause(c, last)] : [];
  });
  const parts = dated.map((c) => {
    const cy = c.cycle!;
    const due = cy.deadline ? formatDay(cy.deadline, now) : null;
    if (cy.status === "upcoming") return `${c.name}'s ${formatTerm(cy.termKey)} recruiting hasn't opened yet`;
    const closed = `${c.name}'s ${formatTerm(cy.termKey)} recruiting closed${due ? ` ${due}` : ""}`;
    // A closed round beside an announced next one: say when to try again.
    const later = laterOf(c, now);
    return later ? `${closed}; ${announcedRoundText(later, c.joinModes).replace(/^Next/, "next")}` : closed;
  });
  // A round the club announced for a later term outranks its usual seasons (same as the rows).
  for (const c of announced) parts.push(announcedClause(c, c.later!));
  parts.push(...lastOnly);
  const patternText = pattern.map((c) => `${c.name} usually recruits ${seasonsPhrase(c.seasons)}`).join("; ");
  if (dated.length) {
    let s = `${parts.join("; ")}.`;
    if (pattern.length) s += ` ${patternText}, with no dates yet.`;
    out.push(s);
  } else if (parts.length || pattern.length) {
    const bits = [...parts, ...(patternText ? [patternText] : [])].join("; ");
    out.push(joinNow.length ? `${bits.charAt(0).toUpperCase()}${bits.slice(1)}.` : `No dates yet; ${bits}.`);
  }

  // Next term's round: who usually recruits again. Only clubs the lines above haven't already
  // described by their pattern, and never a club that announced its own next round.
  const season = recruitingSeasonForDate(now);
  const next = followingSeason(season);
  const stated = new Set(clubs.filter((c) => !c.cycle || c.cycle.status === "unknown").map((c) => c.name));
  const again = clubs.filter(
    (c) => c.seasons.includes(next) && !c.openAccess && !laterOf(c, now) && !stated.has(c.name),
  );
  if (again.length && again.length < clubs.length)
    out.push(
      `${listNames(again.map((c) => c.name))} also usually ${again.length === 1 ? "recruits" : "recruit"} in ${next}.`,
    );

  // Time commitment.
  const timed = clubs.filter((c) => c.hours && formatRange(c.hours));
  if (timed.length) {
    const s = timed.map((c) => `${c.name} reports ${formatRange(c.hours!, "h/week")}`).join("; ");
    const silent = clubs.filter((c) => !timed.includes(c)).map((c) => c.name);
    out.push(
      `${s}${silent.length ? `; ${listNames(silent)} ${silent.length === 1 ? "doesn't" : "don't"} publish one` : ""}.`,
    );
  }

  // First-years.
  const fy = clubs.filter((c) => c.firstYears !== null);
  if (fy.length) {
    const yes = fy.filter((c) => c.firstYears).map((c) => c.name);
    const no = fy.filter((c) => c.firstYears === false).map((c) => c.name);
    const silent = clubs.filter((c) => c.firstYears === null).map((c) => c.name);
    const parts = [
      yes.length ? `${listNames(yes)} ${yes.length === 1 ? "takes" : "take"} first-years` : null,
      no.length ? `${listNames(no)} ${no.length === 1 ? "doesn't" : "don't"}` : null,
      // Only when the known ones differ from the rest: say who doesn't say.
      silent.length ? `${listNames(silent)} ${silent.length === 1 ? "doesn't" : "don't"} say` : null,
    ].filter(Boolean);
    if (parts.length) out.push(`${parts.join("; ")}.`);
  }
  return out;
}
