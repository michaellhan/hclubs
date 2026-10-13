import { and, eq, inArray, sql } from "drizzle-orm";
import { newYorkDateParts } from "@hci/core";
import { schema, type Db } from "@hci/db";
import { dateFitsTerm } from "../extract/deterministic";
import { isApplicationSystemUrl } from "./signals";

/**
 * Recruiting quality audit (ADR 0031). Finds suspicious recruiting facts and, with
 * `apply`, rejects them (status → rejected, with the reason; never deleted). Questionable
 * data is rejected rather than shown.
 */

export type RecruitingIssueKind =
  | "date_outside_term"
  | "implausible_term"
  | "no_evidence"
  | "application_url_unrelated_domain"
  | "application_url_shared_by_clubs"
  | "status_from_article"
  | "duplicate_cycle_date";

export interface RecruitingIssue {
  kind: RecruitingIssueKind;
  clubId: string;
  slug: string;
  termKey: string;
  detail: string;
  rejectedClaimIds: string[];
}

export interface CycleClaimRow {
  id: string;
  clubId: string;
  slug: string;
  fieldKey: string;
  value: unknown;
  termKey: string;
  evidence: number;
  sourceTypes: string[];
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};
const sameOrSub = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/** News and other publications: they report on past cycles; they never say "open now". */
const ARTICLE_SOURCES = new Set(["harvard_crimson", "harvard_related_other"]);

/** The checks, over cycle-scoped claim rows and each club's website hosts. PURE. */
export function findRecruitingIssues(
  rows: readonly CycleClaimRow[],
  siteHosts: ReadonlyMap<string, readonly string[]>,
  now: Date,
): RecruitingIssue[] {
  const issues: RecruitingIssue[] = [];
  const nowYear = newYorkDateParts(now).year;
  const issue = (kind: RecruitingIssueKind, r: CycleClaimRow, detail: string, ids = [r.id]) =>
    issues.push({ kind, clubId: r.clubId, slug: r.slug, termKey: r.termKey, detail, rejectedClaimIds: ids });

  for (const r of rows) {
    const year = Number(r.termKey.slice(0, 4));
    if (!(year >= 2000 && year <= nowYear + 1)) {
      issue("implausible_term", r, `term ${r.termKey} is outside 2000–${nowYear + 1}`);
      continue;
    }
    if (r.evidence === 0) {
      issue("no_evidence", r, `${r.fieldKey} has no supporting evidence`);
      continue;
    }
    if (r.fieldKey === "cycle.deadline" || r.fieldKey === "cycle.opens_at") {
      const at = (r.value as { at?: string } | null)?.at;
      if (at && !dateFitsTerm(at, r.termKey))
        issue("date_outside_term", r, `${r.fieldKey} ${at.slice(0, 10)} can't belong to ${r.termKey}`);
    }
    if (r.fieldKey === "cycle.application_url" && typeof r.value === "string") {
      const host = hostOf(r.value);
      const sites = siteHosts.get(r.clubId) ?? [];
      if (!isApplicationSystemUrl(r.value) && !sites.some((s) => sameOrSub(host, s)))
        issue("application_url_unrelated_domain", r, `${host} is neither the club's site nor an application form`);
    }
    if (
      r.fieldKey === "cycle.stated_status" &&
      r.sourceTypes.length > 0 &&
      r.sourceTypes.every((t) => ARTICLE_SOURCES.has(t))
    )
      issue("status_from_article", r, "application status taken only from news coverage");
  }

  // One application form claimed by several clubs: whose it is can't be told.
  const byUrl = new Map<string, CycleClaimRow[]>();
  for (const r of rows)
    if (r.fieldKey === "cycle.application_url" && typeof r.value === "string")
      byUrl.set(r.value, [...(byUrl.get(r.value) ?? []), r]);
  for (const [url, rs] of byUrl) {
    if (new Set(rs.map((r) => r.clubId)).size < 2) continue;
    for (const r of rs) issue("application_url_shared_by_clubs", r, `${url} is listed by several clubs`);
  }

  // The same date in two cycles of one club: keep the term the date itself falls in.
  const byDate = new Map<string, CycleClaimRow[]>();
  for (const r of rows) {
    if (r.fieldKey !== "cycle.deadline" && r.fieldKey !== "cycle.opens_at") continue;
    const at = (r.value as { at?: string } | null)?.at;
    if (!at) continue;
    const key = `${r.clubId}|${r.fieldKey}|${at}`;
    byDate.set(key, [...(byDate.get(key) ?? []), r]);
  }
  for (const rs of byDate.values()) {
    const terms = new Set(rs.map((r) => r.termKey));
    if (terms.size < 2) continue;
    const at = (rs[0]?.value as { at: string }).at;
    // Recruiting dates belong to the semester they recruit for: January–May → spring,
    // June–December → fall (an August 31 deadline is fall recruiting, not summer).
    const [y, m] = at.slice(0, 7).split("-").map(Number) as [number, number];
    const natural = m <= 5 ? `${y}-spring` : `${y}-fall`;
    for (const r of rs)
      if (r.termKey !== natural) issue("duplicate_cycle_date", r, `${at.slice(0, 10)} also recorded for ${natural}`);
  }

  // A claim flagged twice is rejected once.
  const seen = new Set<string>();
  for (const i of issues) {
    i.rejectedClaimIds = i.rejectedClaimIds.filter((id) => !seen.has(id));
    for (const id of i.rejectedClaimIds) seen.add(id);
  }
  return issues;
}

/** Load every active cycle-scoped claim, run the checks, and (with `apply`) reject what fails. */
export async function auditRecruiting(db: Db, opts: { now: Date; apply: boolean }): Promise<RecruitingIssue[]> {
  const raw: unknown = await db.execute(sql`
    select c.id, c.club_id as "clubId", cl.slug, c.field_key as "fieldKey", c.value, rc.term_key as "termKey",
      (select count(*)::int from claim_evidence e where e.claim_id = c.id) as evidence,
      coalesce((select array_agg(distinct s.source_type) from claim_evidence e join source s on s.id = e.source_id
                where e.claim_id = c.id), '{}') as "sourceTypes"
    from claim c
    join recruiting_cycle rc on rc.id = c.recruiting_cycle_id
    join club cl on cl.id = c.club_id
    where c.status = 'active' and c.subject_type = 'recruiting_cycle' and cl.record_state = 'active'
  `);
  // An array from postgres-js, `{ rows }` from PGlite (tests).
  const rows = (Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])) as CycleClaimRow[];
  const clubIds = [...new Set(rows.map((r) => r.clubId))];
  const sites = clubIds.length
    ? await db
        .select({ clubId: schema.clubLink.clubId, url: schema.clubLink.url })
        .from(schema.clubLink)
        .where(
          and(
            inArray(schema.clubLink.clubId, clubIds),
            eq(schema.clubLink.kind, "website"),
            inArray(schema.clubLink.status, ["verified", "probable"]),
          ),
        )
    : [];
  const siteHosts = new Map<string, string[]>();
  for (const s of sites) siteHosts.set(s.clubId, [...(siteHosts.get(s.clubId) ?? []), hostOf(s.url)]);
  const issues = findRecruitingIssues(rows, siteHosts, opts.now);
  if (opts.apply) {
    for (const i of issues) {
      if (i.rejectedClaimIds.length === 0) continue;
      await db
        .update(schema.claim)
        .set({ status: "rejected", statusReason: `recruiting audit: ${i.kind} — ${i.detail}`.slice(0, 500) })
        .where(and(inArray(schema.claim.id, i.rejectedClaimIds), eq(schema.claim.status, "active")));
    }
  }
  return issues;
}
