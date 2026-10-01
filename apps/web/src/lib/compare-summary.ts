import {
  JOIN_MODE_LABEL,
  isRecruitingNow,
  type CycleStatus,
  type DateValue,
  type JoinMode,
  type RecruitingSeason,
} from "@hci/core/browser";
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

export function compareSummary(clubs: SummaryClub[], now: Date): string[] {
  if (clubs.length < 2) return [];
  const out: string[] = [];

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
    const parts = [
      yes.length ? `${listNames(yes)} ${yes.length === 1 ? "takes" : "take"} first-years` : null,
      no.length ? `${listNames(no)} ${no.length === 1 ? "doesn't" : "don't"}` : null,
    ].filter(Boolean);
    if (parts.length) out.push(`${parts.join("; ")}.`);
  }
  return out;
}
