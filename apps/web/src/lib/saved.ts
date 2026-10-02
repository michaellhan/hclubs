import { dateValueEnd } from "@hci/core/browser";
import { withLiveStatus, type ListedClub } from "@hci/db/local";
import { MAX_SAVED } from "./use-saved";

/** Slugs from a shared `/saved?clubs=a,b` link: valid slug characters only, de-duped, capped. */
export function parseClubsParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9-]+$/.test(s)),
    ),
  ].slice(0, MAX_SAVED);
}

export interface SavedState {
  /** 0 due soonest, 1 open with no deadline, 2 opens later, 3 everything else, 4 ended. */
  group: 0 | 1 | 2 | 3 | 4;
  /** The live cycle worth showing, or null (closed past-term cycles are not news). */
  cycle: ReturnType<typeof withLiveStatus<NonNullable<ListedClub["currentCycle"]>>> | null;
  /** When it matters (deadline, else opening), ms since epoch; Infinity if no date. */
  at: number;
}

/** Where a saved club sits in "what should I act on first", recomputed against `now`. */
export function savedState(club: ListedClub, now: Date): SavedState {
  const cycle = club.currentCycle ? withLiveStatus(club.currentCycle, now) : null;
  if (club.activityStatus === "defunct") return { group: 4, cycle: null, at: Infinity };
  if (cycle && (cycle.status === "open" || cycle.status === "deadline_ahead")) {
    const at = cycle.deadline ? dateValueEnd(cycle.deadline).getTime() : Infinity;
    return { group: cycle.deadline ? 0 : 1, cycle, at };
  }
  if (cycle && cycle.status === "upcoming") {
    const d = cycle.opens ?? cycle.deadline;
    return { group: 2, cycle, at: d ? dateValueEnd(d).getTime() : Infinity };
  }
  return { group: 3, cycle: cycle && cycle.status === "closed" ? cycle : null, at: Infinity };
}

/** Most urgent first: due soonest, open without a date, opening soon, the rest; ties by name. */
export function sortSaved<T extends ListedClub>(clubs: readonly T[], now: Date): { club: T; state: SavedState }[] {
  return clubs
    .map((club) => ({ club, state: savedState(club, now) }))
    .sort(
      (a, b) =>
        a.state.group - b.state.group ||
        (a.state.at === b.state.at ? 0 : a.state.at < b.state.at ? -1 : 1) ||
        a.club.name.localeCompare(b.club.name),
    );
}

/** `slugs` with old slugs replaced by their current ones (order kept, duplicates dropped). PURE. */
export function migrateSlugs(slugs: readonly string[], moved: ReadonlyMap<string, string>): string[] {
  return [...new Set(slugs.map((s) => moved.get(s) ?? s))];
}
