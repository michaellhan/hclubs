import { JoinMode, OrgType, RecognitionStatus, RecruitingSeason } from "@hci/core";
import { ClubFilters, SortKey } from "@hci/db/local";
import { z } from "zod";

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

function validList<T extends z.ZodType>(schema: T, values: string[]): z.infer<T>[] {
  return values.flatMap((v) => {
    const r = schema.safeParse(v);
    return r.success ? [r.data] : [];
  });
}

export interface DirectoryParams {
  q: string | null;
  filters: ClubFilters;
  sort: SortKey;
  page: number;
}

export function parseDirectoryParams(sp: RawSearchParams): DirectoryParams {
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 100) || null;
  const filters = ClubFilters.parse({
    categories: validList(z.string().regex(/^[a-z0-9-]+$/), list(sp.category)),
    joinModes: validList(JoinMode, list(sp.join)),
    recognition: validList(RecognitionStatus, list(sp.recognition)),
    orgTypes: validList(OrgType, list(sp.type)),
    recruitingNow: flag(sp.recruiting),
    freshmenEligible: flag(sp.freshmen),
    includeInactive: flag(sp.inactive),
    includeGraduate: flag(sp.grad),
    recruitingSeasons: validList(RecruitingSeason, list(sp.season)),
  });
  const sortRaw = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort;
  const sort = SortKey.safeParse(sortRaw).success ? (sortRaw as SortKey) : q ? "relevance" : "name";
  const pageNum = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  return { q, filters, sort, page: Number.isInteger(pageNum) && pageNum > 0 ? Math.min(pageNum, 500) : 1 };
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
  }
  if (p.sort && p.sort !== (p.q ? "relevance" : "name")) out.set("sort", p.sort);
  if (p.page && p.page > 1) out.set("page", String(p.page));
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
    (f.includeGraduate ? 1 : 0)
  );
}
