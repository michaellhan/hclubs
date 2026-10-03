import {
  JOIN_MODE_LABEL,
  isRecruitingNow,
  type CycleStatus,
  type DateValue,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core/browser";
import { followingSeason, recruitingSeasonForDate } from "@hci/db/local";
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
  /** The College directory lists no comping requirement (an application may remain). */
  noComp?: boolean;
  /** A source says anyone can join (derived `joining.access = open`). */
  openAccess?: boolean;
  /** A source says the organization ended: it's named once and left out of the rest. */
  ended?: boolean;
}

/**
 * The compare table's "Next chance" cell: when a student can next get in, from the live
 * cycle status and the club's sourced recruiting pattern (never a guessed date). Mirrors the
 * recruiting board: open membership = join anytime; an open round = its deadline; rolling;
 * otherwise the next usual term. Null when nothing is known. PURE.
 */
/** `nextChanceText` for a closed round with no pattern to point to. */
export const NO_NEXT_ROUND = "No next round known, check with the club";

export function nextChanceText(
  c: Pick<SummaryClub, "cycle" | "seasons" | "openAccess">,
  now: Date,
  fmt: (d: DateValue) => string | null = (d) => formatDay(d, now),
): string | null {
  const cy = c.cycle;
  if (cy && isRecruitingNow(cy.status))
    return cy.deadline ? `Recruiting now · due ${fmt(cy.deadline)}` : "Recruiting now";
  if (c.openAccess) return "Join anytime (open membership)";
  if (cy && cy.status === "upcoming") return `${formatTerm(cy.termKey)} round announced`;
  if (c.seasons.includes("rolling")) return "Recruits on a rolling basis";
  const season = recruitingSeasonForDate(now);
  const next = followingSeason(season);
  const closedNow = cy?.status === "closed" && cy.termKey.endsWith(`-${season}`);
  if (c.seasons.includes(season) && !closedNow && season !== "summer")
    return `Usually recruits this ${season}; no dates yet`;
  if (c.seasons.includes(next)) return `Usually recruits again in ${next === "spring" ? "Spring" : "Fall"}`;
  // A round that already closed with no pattern: say what to do rather than a bare Unknown.
  if (cy?.status === "closed") return NO_NEXT_ROUND;
  return null;
}

const SELECTIVE: JoinMode[] = ["application", "comp", "audition", "tryout", "invite_only"];

/** "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function joinPhrase(modes: JoinMode[]): string {
  const sel = modes.filter((m) => SELECTIVE.includes(m));
  if (!sel.length) {
    // "open membership", "attendance-based membership", "open, attendance-based membership".
    const open = modes.includes("open");
    const attendance = modes.includes("attendance_based");
    if (open || attendance)
      return `${[open ? "open" : "", attendance ? "attendance-based" : ""].filter(Boolean).join(", ")} membership`;
  }
  const words = (sel.length ? sel : modes).map((m) =>
    m === "invite_only"
      ? "invitation only"
      : `${/^[aeiou]/i.test(JOIN_MODE_LABEL[m]) ? "an" : "a"} ${JOIN_MODE_LABEL[m].toLowerCase()}`,
  );
  return listNames(words);
}

/** "in fall and spring", "on a rolling basis", "in fall, or on a rolling basis". */
function seasonsPhrase(seasons: RecruitingSeason[]): string {
  const terms = seasons.filter((x) => x !== "rolling");
  const rolling = seasons.includes("rolling");
  if (!terms.length) return "on a rolling basis";
  return `in ${listNames(terms)}${rolling ? ", or on a rolling basis" : ""}`;
}

export function compareSummary(all: SummaryClub[], now: Date): string[] {
  if (all.length < 2) return [];
  const out: string[] = [];
  const gone = all.filter((c) => c.ended).map((c) => c.name);
  if (gone.length) out.push(`${listNames(gone)} ${gone.length === 1 ? "is" : "are"} no longer active.`);
  const clubs = all.filter((c) => !c.ended);
  if (!clubs.length) return out;

  // How to join.
  const withJoin = clubs.filter((c) => c.joinModes.length);
  const noJoin = clubs.filter((c) => !c.joinModes.length).map((c) => c.name);
  if (withJoin.length) {
    const phrases = withJoin.map((c) => ({ name: c.name, phrase: joinPhrase(c.joinModes) }));
    const same = phrases.every((p) => p.phrase === phrases[0]!.phrase);
    let s =
      same && phrases.length > 1
        ? `${listNames(phrases.map((p) => p.name))} ${phrases.length === 2 ? "both" : "all"} use ${phrases[0]!.phrase}.`
        : `${phrases.map((p) => `${p.name} uses ${p.phrase}`).join("; ")}.`;
    const flagOnly = clubs.filter((c) => !c.joinModes.length && c.noComp).map((c) => c.name);
    const silent = noJoin.filter((n) => !flagOnly.includes(n));
    if (flagOnly.length) s += ` The College directory lists no comping requirement for ${listNames(flagOnly)}.`;
    if (silent.length) s += ` ${listNames(silent)} ${silent.length === 1 ? "doesn't" : "don't"} say how to join.`;
    out.push(s.charAt(0).toUpperCase() + s.slice(1));
  }

  // Recruiting now / dates.
  const dated = clubs.filter((c) => c.cycle && c.cycle.status !== "unknown");
  if (dated.length) {
    const parts = dated.map((c) => {
      const cy = c.cycle!;
      const due = cy.deadline ? formatDay(cy.deadline, now) : null;
      if (isRecruitingNow(cy.status)) return `${c.name} is recruiting${due ? ` (due ${due})` : ""}`;
      if (cy.status === "upcoming") return `${c.name}'s ${formatTerm(cy.termKey)} recruiting hasn't opened yet`;
      return `${c.name}'s ${formatTerm(cy.termKey)} recruiting closed${due ? ` ${due}` : ""}`;
    });
    const pattern = clubs.filter((c) => !dated.includes(c) && c.seasons.length);
    let s = `${parts.join("; ")}.`;
    if (pattern.length)
      s += ` ${pattern.map((c) => `${c.name} usually recruits ${seasonsPhrase(c.seasons)}`).join("; ")}, with no current dates on record.`;
    out.push(s);
  } else {
    const pattern = clubs.filter((c) => c.seasons.length);
    if (pattern.length)
      out.push(
        `None has dated recruiting on record; ${pattern.map((c) => `${c.name} usually recruits ${seasonsPhrase(c.seasons)}`).join("; ")}.`,
      );
  }

  // Next term's round: who usually recruits again (a pattern, never a date).
  const season = recruitingSeasonForDate(now);
  const next = followingSeason(season);
  const again = clubs.filter((c) => c.seasons.includes(next) && !c.openAccess).map((c) => c.name);
  if (again.length && again.length < clubs.length)
    out.push(`Only ${listNames(again)} usually ${again.length === 1 ? "recruits" : "recruit"} in ${next}.`);

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
