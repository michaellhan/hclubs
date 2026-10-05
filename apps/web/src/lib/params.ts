import {
  JOIN_MODES,
  ORG_TYPES,
  RECOGNITION_STATUSES,
  RECRUITING_SEASONS,
  type JoinMode,
  type OrgType,
  type RecognitionStatus,
  type RecruitingSeason,
  JOIN_MODE_LABEL,
  RECOGNITION_STATUS_LABEL,
  RECRUITING_SEASON_LABEL,
} from "@hci/core/browser";
import { ClubFilters, INTENTS, isSortKey, type CategoryWithCount, type SortKey } from "@hci/db/local";
import { JOINING_FILTERS } from "./joining";

const PUBLIC_SORTS: ReadonlySet<SortKey> = new Set(["relevance", "popularity", "name"]);

/**
 * URL search params ⇄ directory query. Filters live in the URL so every view is
 * shareable (CLAUDE.md §13). Unknown/invalid values are dropped, never thrown.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

const list = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
const flag = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "1" || s === "true" || s === "on";
};

/** The values that are one of `allowed` (or match it, for a pattern); the rest are dropped. */
function validList<T extends string>(allowed: readonly T[] | RegExp, values: string[]): T[] {
  return values.filter((v): v is T => (allowed instanceof RegExp ? allowed.test(v) : allowed.includes(v as T)));
}
const SLUG = /^[a-z0-9-]+$/;

/** `hours=N`: a positive number up to 100, else ignored. PURE. */
export function hoursParam(v: string | string[] | undefined): number | null {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

export interface DirectoryParams {
  q: string | null;
  filters: ClubFilters;
  sort: SortKey;
  page: number;
  /** `?all=1`: also list clubs with little info (hidden by default when browsing). */
  showAll: boolean;
}

export function parseDirectoryParams(sp: RawSearchParams): DirectoryParams {
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 100) || null;
  const filters = ClubFilters.parse({
    categories: validList<string>(SLUG, list(sp.category)),
    joinModes: validList<JoinMode>(JOIN_MODES, list(sp.join)),
    recognition: validList<RecognitionStatus>(RECOGNITION_STATUSES, list(sp.recognition)),
    orgTypes: validList<OrgType>(ORG_TYPES, list(sp.type)),
    recruitingNow: flag(sp.recruiting),
    freshmenEligible: flag(sp.freshmen),
    includeInactive: flag(sp.inactive),
    includeGraduate: flag(sp.grad),
    recruitingSeasons: validList<RecruitingSeason>(RECRUITING_SEASONS, list(sp.season)),
    openJoin: flag(sp.open),
    noComp: flag(sp.nocomp),
    noDues: flag(sp.nodues),
    noExperience: flag(sp.noexp),
    intent: validList<string>(SLUG, list(sp.do))[0] ?? null,
    maxHours: hoursParam(sp.hours),
  });
  const sortRaw = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort;
  // "updated" and "completeness" are no longer offered (ADR 0039): one sorted by crawl
  // times, the other by how documented a club is. Old links get the default order.
  // A ranked intent ("Meet people": open clubs first) is ordered by its rule, like a search.
  const rankedIntent = INTENTS.some((i) => i.slug === filters.intent && i.rank);
  const sort: SortKey =
    isSortKey(sortRaw) && PUBLIC_SORTS.has(sortRaw) ? sortRaw : q || rankedIntent ? "relevance" : "popularity";
  const pageNum = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  return {
    q,
    filters,
    sort,
    page: Number.isInteger(pageNum) && pageNum > 0 ? Math.min(pageNum, 500) : 1,
    showAll: flag(sp.all),
  };
}

export function toSearchParams(p: Partial<DirectoryParams>): URLSearchParams {
  const out = new URLSearchParams();
  if (p.q) out.set("q", p.q);
  const f = p.filters;
  if (f) {
    for (const c of f.categories) out.append("category", c);
    for (const j of f.joinModes) out.append("join", j);
    for (const r of f.recognition) out.append("recognition", r);
    for (const t of f.orgTypes) out.append("type", t);
    for (const s of f.recruitingSeasons) out.append("season", s);
    if (f.recruitingNow) out.set("recruiting", "1");
    if (f.freshmenEligible) out.set("freshmen", "1");
    if (f.includeInactive) out.set("inactive", "1");
    if (f.includeGraduate) out.set("grad", "1");
    if (f.openJoin) out.set("open", "1");
    if (f.noComp) out.set("nocomp", "1");
    if (f.noDues) out.set("nodues", "1");
    if (f.noExperience) out.set("noexp", "1");
    if (f.intent) out.set("do", f.intent);
    if (f.maxHours !== null) out.set("hours", String(f.maxHours));
  }
  if (p.sort && p.sort !== (p.q ? "relevance" : "popularity")) out.set("sort", p.sort);
  if (p.page && p.page > 1) out.set("page", String(p.page));
  if (p.showAll) out.set("all", "1");
  return out;
}

export function hrefWith(base: DirectoryParams, patch: Partial<DirectoryParams>): string {
  const qs = toSearchParams({ ...base, ...patch, page: patch.page ?? 1 }).toString();
  return qs ? `/clubs?${qs}` : "/clubs";
}

export function activeFilterCount(f: ClubFilters): number {
  return (
    f.categories.length +
    f.joinModes.length +
    f.recognition.length +
    f.orgTypes.length +
    f.recruitingSeasons.length +
    (f.recruitingNow ? 1 : 0) +
    (f.freshmenEligible ? 1 : 0) +
    (f.includeInactive ? 1 : 0) +
    (f.includeGraduate ? 1 : 0) +
    (f.openJoin ? 1 : 0) +
    (f.noComp ? 1 : 0) +
    (f.noDues ? 1 : 0) +
    (f.noExperience ? 1 : 0) +
    (f.intent ? 1 : 0) +
    (f.maxHours !== null ? 1 : 0)
  );
}

/** One removable piece of the current view, with the filters it leaves behind. */
export interface FilterChip {
  key: string;
  label: string;
  /** The filters without this one. */
  patch: Partial<ClubFilters>;
}

/** Every active filter as a chip (labels in plain words), in a stable order. */
export function filterChips(f: ClubFilters, categories: CategoryWithCount[]): FilterChip[] {
  const chips: FilterChip[] = [];
  const catName = (s: string) => categories.find((c) => c.slug === s)?.name ?? s;
  const intent = INTENTS.find((i) => i.slug === f.intent);
  if (intent) chips.push({ key: "intent", label: intent.label, patch: { intent: null } });
  for (const c of f.categories)
    chips.push({ key: `cat:${c}`, label: catName(c), patch: { categories: f.categories.filter((x) => x !== c) } });
  if (f.recruitingNow)
    chips.push({ key: "recruiting", label: JOINING_FILTERS.recruitingNow.label, patch: { recruitingNow: false } });
  if (f.freshmenEligible)
    chips.push({ key: "freshmen", label: JOINING_FILTERS.freshmenEligible.label, patch: { freshmenEligible: false } });
  if (f.openJoin) chips.push({ key: "open", label: JOINING_FILTERS.openJoin.label, patch: { openJoin: false } });
  if (f.noComp) chips.push({ key: "nocomp", label: JOINING_FILTERS.noComp.label, patch: { noComp: false } });
  if (f.noDues) chips.push({ key: "nodues", label: JOINING_FILTERS.noDues.label, patch: { noDues: false } });
  if (f.noExperience)
    chips.push({ key: "noexp", label: JOINING_FILTERS.noExperience.label, patch: { noExperience: false } });
  for (const j of f.joinModes)
    chips.push({
      key: `join:${j}`,
      label: JOIN_MODE_LABEL[j],
      patch: { joinModes: f.joinModes.filter((x) => x !== j) },
    });
  for (const season of f.recruitingSeasons)
    chips.push({
      key: `season:${season}`,
      label: `Usually recruits in ${RECRUITING_SEASON_LABEL[season].toLowerCase()}`,
      patch: { recruitingSeasons: f.recruitingSeasons.filter((x) => x !== season) },
    });
  for (const r of f.recognition)
    chips.push({
      key: `rec:${r}`,
      label: RECOGNITION_STATUS_LABEL[r],
      patch: { recognition: f.recognition.filter((x) => x !== r) },
    });
  if (f.maxHours !== null)
    chips.push({ key: "hours", label: `Up to ${f.maxHours} hrs/week`, patch: { maxHours: null } });
  if (f.includeGraduate) chips.push({ key: "grad", label: "Incl. graduate", patch: { includeGraduate: false } });
  if (f.includeInactive) chips.push({ key: "inactive", label: "Incl. inactive", patch: { includeInactive: false } });
  return chips;
}
