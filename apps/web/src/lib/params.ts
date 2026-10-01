import {
  JOIN_MODES,
  ORG_TYPES,
  RECOGNITION_STATUSES,
  RECRUITING_SEASONS,
  type JoinMode,
  type OrgType,
  type RecognitionStatus,
  type RecruitingSeason,
} from "@hci/core/browser";
import { ClubFilters, isSortKey, type SortKey } from "@hci/db/local";

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
    intent: validList<string>(SLUG, list(sp.do))[0] ?? null,
  });
  const sortRaw = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort;
  const sort: SortKey = isSortKey(sortRaw) ? sortRaw : q ? "relevance" : "name";
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
    if (f.intent) out.set("do", f.intent);
  }
  if (p.sort && p.sort !== (p.q ? "relevance" : "name")) out.set("sort", p.sort);
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
    (f.intent ? 1 : 0)
  );
}
