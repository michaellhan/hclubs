import { ClubFilters, INTENTS, isSparseClub, passesFilters, type IndexClub } from "@hci/db/local";

/**
 * Home-page discovery links (ADR 0034). Every preset is an ordinary, shareable directory URL;
 * its count is what that URL shows when browsing (clubs with little info hidden). A preset
 * whose data is too thin is not shown at all.
 */
export const MIN_PRESET_CLUBS = 10;
export const MIN_INTENT_CLUBS = 4;

interface Preset {
  label: string;
  href: string;
  filters: Partial<ClubFilters>;
}

export const PRESETS: Preset[] = [
  { label: "No comp or application", href: "/clubs?open=1", filters: { openJoin: true } },
  { label: "Open to first-years", href: "/clubs?freshmen=1", filters: { freshmenEligible: true } },
  { label: "No dues", href: "/clubs?nodues=1", filters: { noDues: true } },
  {
    label: "Consulting & business",
    href: "/clubs?category=pre-professional",
    filters: { categories: ["pre-professional"] },
  },
  { label: "Finance & quant", href: "/clubs?do=invest", filters: { intent: "invest" } },
  {
    label: "Tech & startups",
    href: "/clubs?category=technology&category=entrepreneurship",
    filters: { categories: ["technology", "entrepreneurship"] },
  },
  {
    label: "Arts & performance",
    href: "/clubs?category=performing-arts",
    filters: { categories: ["performing-arts"] },
  },
  { label: "Service", href: "/clubs?category=public-service", filters: { categories: ["public-service"] } },
  {
    label: "Publications",
    href: "/clubs?category=publications-media",
    filters: { categories: ["publications-media"] },
  },
  { label: "Competitive teams", href: "/clubs?do=compete", filters: { intent: "compete" } },
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
