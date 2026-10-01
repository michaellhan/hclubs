import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { findRepoRoot, type Db } from "@hci/db";

/**
 * Maintainer tools over text we already crawled (no network, no paid calls):
 *
 *  - `pnpm hci snapshots search <regex> [--missing=<field>] [--limit=N]`: every club page
 *    whose latest snapshot matches, with the sentence around each hit.
 *  - `pnpm hci opportunities`: for the fields with the weakest coverage, clubs that still
 *    show "Unknown" although one of their own pages has wording that usually states the
 *    value ("open to all undergraduates", "3 hours a week", "no dues"). Candidates for an
 *    extractor fix or a manual check — never accepted automatically.
 *
 * Only pages that speak for one club are read: pages the site crawler fetched for it, and
 * official directory pages whose claims all belong to that club. A list of sixty
 * programs saying "first-years" says nothing about which program takes them; a newspaper
 * profile ("when I was a freshman…") and stored search-engine responses aren't the club.
 */

export interface PageText {
  clubId: string;
  slug: string;
  name: string;
  url: string;
  role: string | null;
  fetchedAt: Date;
  text: string;
}

export interface TextHit {
  page: PageText;
  excerpts: string[];
}

/** The sentence around a match: up to `width` characters, cut at sentence ends. PURE. */
export function excerptAt(text: string, index: number, length: number, width = 240): string {
  const ends = /[.!?]\s|\n/g;
  let start = 0;
  for (let i = index - 1; i >= Math.max(0, index - width); i--) {
    if (text[i] === "\n" || (/[.!?]/.test(text[i]!) && /\s/.test(text[i + 1] ?? ""))) {
      start = i + 1;
      break;
    }
    if (i === Math.max(0, index - width)) start = i;
  }
  ends.lastIndex = index + length;
  const m = ends.exec(text);
  const end = Math.min(m ? m.index + 1 : text.length, start + width);
  const s = text
    .slice(start, end)
    .replace(/\s+/g, " ")
    .replace(/^[#*>\-\s]+/, "")
    .trim();
  return (start > 0 && start === Math.max(0, index - width) ? "…" : "") + s + (end < text.length && !m ? "…" : "");
}

/** Pages matching a pattern, with up to `perPage` distinct excerpts each. PURE. */
export function searchTexts(pages: readonly PageText[], pattern: RegExp, perPage = 2): TextHit[] {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const hits: TextHit[] = [];
  for (const page of pages) {
    const excerpts: string[] = [];
    re.lastIndex = 0;
    for (let m = re.exec(page.text); m && excerpts.length < perPage; m = re.exec(page.text)) {
      const e = excerptAt(page.text, m.index, m[0].length);
      if (!excerpts.includes(e)) excerpts.push(e);
      if (m[0].length === 0) re.lastIndex++;
    }
    if (excerpts.length) hits.push({ page, excerpts });
  }
  return hits;
}

/**
 * Wording that usually states a field's value. Deliberately broader than the extractors:
 * a hit is a lead to check, and a lead the extractor rejected is often a test case.
 */
export const OPPORTUNITY_PATTERNS: { field: string; label: string; present: string[]; pattern: RegExp }[] = [
  {
    field: "eligibility",
    label: "First-year / class-year eligibility",
    present: ["club.freshmen_eligible", "club.eligible_classes"],
    pattern:
      /\b(?:first[- ]years?|freshm[ae]n|all class years|all (?:harvard )?(?:college )?undergrad(?:uate)?s|any (?:harvard )?(?:college )?undergrad(?:uate)?s?|upperclass(?:men|students)|sophomores? (?:and|or) (?:above|up|older))\b/i,
  },
  {
    field: "club.hours_per_week",
    label: "Weekly time commitment",
    present: ["club.hours_per_week"],
    pattern:
      /\b\d{1,2}(?:\s*(?:-|–|to)\s*\d{1,2})?\+?\s*(?:hours?|hrs?)\b[^.\n]{0,25}\b(?:week|weekly)\b|\btime commitment\b|\bhours (?:a|per) week\b/i,
  },
  {
    field: "club.dues",
    label: "Dues",
    present: ["club.dues"],
    pattern:
      /\bdues\b|\bmembership fees?\b|\bfree to join\b|\bfree of charge\b|\$\s?\d+\s*(?:\/|per|a|each)\s*(?:semester|year|term)\b/i,
  },
  {
    field: "club.member_count",
    label: "Member count",
    present: ["club.member_count"],
    pattern:
      /\b(?:over |more than |nearly |about |around |approximately )?\d{2,4}\+?\s+(?:active |current |undergraduate |student |dedicated )?(?:members|dancers|singers|musicians|athletes|students strong)\b|\bteam of \d{2,4}\b/i,
  },
  {
    field: "club.join_mode",
    label: "How to join",
    present: ["club.join_mode"],
    pattern:
      /\bno (?:applications?|auditions?|tryouts?|comps?|experience) (?:is |are )?(?:required|necessary|needed)\b|\bopen to (?:all|anyone|everyone)\b|\banyone (?:is welcome|can join)\b|\b(?:join|sign up for) (?:our|the) (?:mailing|email) list\b/i,
  },
];

const KNOWN_FIELDS = new Set(OPPORTUNITY_PATTERNS.map((p) => p.field));

/** Latest text of every page tied to exactly one active club (own channel or single-club directory page). */
export async function clubPageTexts(db: Db): Promise<{ pages: PageText[]; present: Map<string, Set<string>> }> {
  const rows = (await db.execute(sql`
    with recursive chain(id, root) as (
      select id, id from club where record_state = 'active'
      union all
      select c.id, chain.root from club c join chain on c.merged_into_club_id = chain.id
    ),
    single_club_sources as (
      select ce.source_id, min(chain.root::text)::uuid as club_id
      from claim_evidence ce
      join claim cl on cl.id = ce.claim_id
      join chain on chain.id = cl.club_id
      group by ce.source_id
      having count(distinct chain.root) = 1
    ),
    page_club as (
      select s.id as source_id, chain.root as club_id from source s join chain on chain.id = s.owner_club_id
      union
      select source_id, club_id from single_club_sources
    ),
    latest as (
      select distinct on (ss.source_id) ss.source_id, ss.fetched_at, ss.extracted_text
      from source_snapshot ss
      where ss.extracted_text is not null and length(ss.extracted_text) > 40
      order by ss.source_id, ss.fetched_at desc
    )
    select distinct on (pc.club_id, s.id)
      pc.club_id as "clubId", c.slug, c.canonical_name as name, s.url, s.page_role as role,
      l.fetched_at as "fetchedAt", l.extracted_text as text
    from page_club pc
    join source s on s.id = pc.source_id and not s.is_fixture
      -- What the extractors read: crawled club pages (any tier: an unverified club site is
      -- still the club talking) and official directory pages; never press or search responses.
      and ((s.adapter = 'site-crawler' and s.source_type <> 'harvard_crimson') or s.trust_tier = 1)
      and s.domain not like '%search.brave.com'
    join latest l on l.source_id = s.id
    join club c on c.id = pc.club_id
    order by pc.club_id, s.id
  `)) as unknown as (PageText & { fetchedAt: Date | string })[];
  const pages = rows.map((r) => ({ ...r, fetchedAt: new Date(r.fetchedAt) }));
  const fieldRows = (await db.execute(sql`
    select id as "clubId", key
    from club, jsonb_each(fields) as f(key, value)
    where record_state = 'active'
      and (value -> 'current' is not null and value -> 'current' <> 'null'::jsonb
           or jsonb_array_length(coalesce(value -> 'values', '[]'::jsonb)) > 0)
  `)) as unknown as { clubId: string; key: string }[];
  const present = new Map<string, Set<string>>();
  for (const r of fieldRows) present.set(r.clubId, (present.get(r.clubId) ?? new Set()).add(r.key));
  return { pages, present };
}

/** Whether a club shows any of the fields. */
const hasAny = (present: Map<string, Set<string>>, clubId: string, fields: readonly string[]) =>
  fields.some((f) => present.get(clubId)?.has(f));

export function fieldsFor(missing: string): string[] {
  const p = OPPORTUNITY_PATTERNS.find((x) => x.field === missing);
  return p ? p.present : [missing];
}

export async function snapshotSearch(
  db: Db,
  pattern: RegExp,
  opts: { missing?: string; limit?: number } = {},
): Promise<string> {
  const { pages, present } = await clubPageTexts(db);
  const candidates = opts.missing ? pages.filter((p) => !hasAny(present, p.clubId, fieldsFor(opts.missing!))) : pages;
  const hits = searchTexts(candidates, pattern);
  const clubs = new Set(hits.map((h) => h.page.clubId));
  const lines = [
    `${hits.length} page(s) of ${clubs.size} club(s) match /${pattern.source}/${opts.missing ? `, among clubs missing ${opts.missing}` : ""} (${candidates.length} pages searched)`,
  ];
  for (const h of hits.slice(0, opts.limit ?? 60)) {
    lines.push("", `${h.page.slug}  ${h.page.url}${h.page.role ? `  [${h.page.role}]` : ""}  ${day(h.page.fetchedAt)}`);
    for (const e of h.excerpts) lines.push(`  “${e}”`);
  }
  if (hits.length > (opts.limit ?? 60)) lines.push("", `… ${hits.length - (opts.limit ?? 60)} more (--limit=N)`);
  return lines.join("\n");
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export interface OpportunityRow {
  field: string;
  label: string;
  missing: number;
  withLeads: number;
  leads: { slug: string; name: string; pages: TextHit[] }[];
}

/** Clubs missing a field whose own pages carry wording that usually states it. PURE given pages. */
export function findOpportunities(
  pages: readonly PageText[],
  present: Map<string, Set<string>>,
  clubIds: readonly string[],
) {
  return OPPORTUNITY_PATTERNS.map((p): OpportunityRow => {
    const missingIds = new Set(clubIds.filter((id) => !hasAny(present, id, p.present)));
    const hits = searchTexts(
      pages.filter((pg) => missingIds.has(pg.clubId)),
      p.pattern,
    );
    const byClub = new Map<string, TextHit[]>();
    for (const h of hits) byClub.set(h.page.clubId, [...(byClub.get(h.page.clubId) ?? []), h]);
    const leads = [...byClub.values()]
      .map((list) => ({ slug: list[0]!.page.slug, name: list[0]!.page.name, pages: list }))
      .sort((a, b) => b.pages.length - a.pages.length || a.slug.localeCompare(b.slug));
    return { field: p.field, label: p.label, missing: missingIds.size, withLeads: leads.length, leads };
  });
}

export async function opportunitiesReport(db: Db, opts: { field?: string; perField?: number } = {}) {
  if (opts.field && !KNOWN_FIELDS.has(opts.field))
    throw new Error(`--field must be one of ${[...KNOWN_FIELDS].join(", ")}`);
  const { pages, present } = await clubPageTexts(db);
  const ids = (
    (await db.execute(
      sql`select id from club where record_state = 'active' and data_origin <> 'fixture'`,
    )) as unknown as {
      id: string;
    }[]
  ).map((r) => r.id);
  const rows = findOpportunities(pages, present, ids).filter((r) => !opts.field || r.field === opts.field);
  const per = opts.perField ?? 40;
  const md: string[] = [
    "# Extraction opportunities",
    "",
    `Generated ${new Date().toISOString()} by \`pnpm hci opportunities\` from ${pages.length} crawled pages tied to one club.`,
    "Clubs that show “Unknown” for a field although one of their own pages has wording that often states it.",
    "Leads, not facts: check the excerpt, then fix the extractor (with a test) or record the value through the",
    "normal paths. Nothing here is shown on the site.",
    "",
    "| Field | Clubs missing it | …with a lead in crawled text |",
    "|---|---:|---:|",
    ...rows.map((r) => `| ${r.label} | ${r.missing} | ${r.withLeads} |`),
  ];
  for (const r of rows) {
    md.push("", `## ${r.label} (${r.withLeads} clubs)`, "");
    for (const lead of r.leads.slice(0, per)) {
      md.push(`- \`${lead.slug}\` ${lead.name}`);
      for (const h of lead.pages.slice(0, 2))
        for (const e of h.excerpts.slice(0, 1)) md.push(`  - “${e}” — ${h.page.url}`);
    }
    if (r.leads.length > per) md.push(`- … ${r.leads.length - per} more`);
  }
  const markdown = md.join("\n");
  const dir = join(findRepoRoot(), "data", "reports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "opportunities.md");
  writeFileSync(path, `${markdown}\n`);
  return { markdown, path, rows };
}
