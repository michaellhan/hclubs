import type { RecruitingSeason } from "@hci/core";
import type { ClubProfile } from "@hci/db";
import { announcedLaterRound, lastPastRound } from "@hci/db/local";
import { joinTiming } from "./join-timing";

/**
 * The next round the club's own pages announce for a later term, as of the build (the live
 * cell re-checks the term on the reader's day): only its term and process.
 */
export function laterRound(club: Pick<ClubProfile, "cycles">, now: Date = new Date()) {
  const later = announcedLaterRound(club.cycles, now);
  return later
    ? { termKey: later.termKey, processTypes: later.processTypes, ...(later.noCuts ? { noCuts: true } : {}) }
    : null;
}

/** The club's most recent evidenced round from an earlier term, as of `now` ("Last comp: Spring 2026"). */
export function lastRound(club: Pick<ClubProfile, "cycles">, now: Date = new Date()) {
  return lastPastRound(club.cycles, now);
}

/**
 * "When" has an answer at build time (a round or a usual season). The live cell may refine it.
 * Checked at the round's own date and at build time: a date-only opening is still "upcoming" at
 * its UTC midnight (the evening before, in Boston), where a started round with no deadline
 * (Lampoon's "Comp started Sep 6") has nothing to say yet.
 */
export function whenKnown(
  club: Pick<ClubProfile, "currentCycle" | "joining" | "joinModes" | "cycles">,
  seasons: readonly RecruitingSeason[],
  now: Date = new Date(),
): boolean {
  const roundDate = club.currentCycle?.deadline?.at ?? club.currentCycle?.opens?.at;
  const refs = roundDate ? [new Date(roundDate), now] : [now];
  return refs.some(
    (ref) =>
      joinTiming(
        {
          cycle: club.currentCycle,
          joining: club.joining,
          seasons,
          joinModes: club.joinModes,
          later: laterRound(club, ref),
          last: lastRound(club, ref),
        },
        ref,
        null,
      ) !== null,
  );
}
