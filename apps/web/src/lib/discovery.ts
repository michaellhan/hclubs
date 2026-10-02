import { ClubFilters, INTENTS, isSparseClub, passesFilters, type IndexClub } from "@hci/db/local";
import { JOINING_FILTERS } from "./joining";

/**
 * Home-page discovery links (ADR 0034). Every preset is an ordinary, shareable directory URL;
 * its count is what that URL shows when browsing (clubs with little info hidden). A preset
 * whose data is too thin is not shown at all. Topics live in the intents and categories
 * below the search box, so presets are only the joining facts (ADR 0040).
 */
export const MIN_PRESET_CLUBS = 10;
/** Fewer than this and a topic tile looks thinner than the search it sits beside. */
export const MIN_INTENT_CLUBS = 6;
/** Intent tiles shown on a phone before "Show all". */
export const MOBILE_INTENT_TILES = 12;

/** Which groups start hidden on a phone: those that begin after `limit` tiles. PURE. */
export function mobileHiddenGroups(sizes: readonly number[], limit = MOBILE_INTENT_TILES): boolean[] {
  let before = 0;
  return sizes.map((n) => {
    const hidden = before >= limit;
    before += n;
    return hidden;
  });
}

interface Preset {
  label: string;
  href: string;
  filters: Partial<ClubFilters>;
}

export const PRESETS: Preset[] = [
  {
    label: "First-years, no comp",
    href: "/clubs?freshmen=1&nocomp=1",
    filters: { freshmenEligible: true, noComp: true },
  },
  { label: JOINING_FILTERS.openJoin.label, href: "/clubs?open=1", filters: { openJoin: true } },
  { label: JOINING_FILTERS.noComp.label, href: "/clubs?nocomp=1", filters: { noComp: true } },
  { label: JOINING_FILTERS.freshmenEligible.label, href: "/clubs?freshmen=1", filters: { freshmenEligible: true } },
  { label: JOINING_FILTERS.noDues.label, href: "/clubs?nodues=1", filters: { noDues: true } },
];

function count(clubs: readonly IndexClub[], f: Partial<ClubFilters>): number {
  const filters = ClubFilters.parse(f);
  return clubs.filter((c) => passesFilters(c, filters) && !isSparseClub(c)).length;
}

export function presetCounts(clubs: readonly IndexClub[]) {
  return PRESETS.map((p) => ({ ...p, count: count(clubs, p.filters) })).filter((p) => p.count >= MIN_PRESET_CLUBS);
}

export function intentCounts(clubs: readonly IndexClub[]) {
  return INTENTS.map((i) => ({ ...i, count: count(clubs, { intent: i.slug }) })).filter(
    (i) => i.count >= MIN_INTENT_CLUBS,
  );
}
