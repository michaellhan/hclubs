import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { normalizeName } from "@hci/core";
import { findRepoRoot, getStaticIndex, type Db } from "@hci/db";
import { completenessTier } from "@hci/db/local";

/**
 * Why each name-only club is still name-only (ADR 0039), from stored data only: where its
 * name came from, what links were ever claimed or rejected for it, whether any stored page
 * other than its origin names it, and whether it may duplicate another club. Groups say
 * what kind of problem remains — a source gap, a lead to review, a possible duplicate —
 * and the next action for each. Read-only; no network.
 */

export type NameOnlyGroup =
  | "possible_duplicate"
  | "named_on_stored_pages"
  | "rejected_links_only"
  | "social_link_only"
  | "college_directory_only"
  | "other_listing_only";

export const GROUP_LABEL: Record<NameOnlyGroup, { title: string; action: string }> = {
  possible_duplicate: {
    title: "Possible duplicate or rename of another club",
    action: "`pnpm hci review`, then `merge` or `reject` the candidate",
  },
  named_on_stored_pages: {
    title: "Named on a stored page other than its listing",
    action: 'read the page (`pnpm hci snapshots search "<name>"`); a link there may be the club\'s',
  },
  rejected_links_only: {
    title: "Links were found and rejected; nothing else known",
    action: "nothing automatic: a correct link needs a student submission or an editor",
  },
  social_link_only: {
    title: "Only an unverified social account is known",
    action: "confirm the account by hand (curate) or wait for a submission",
  },
  college_directory_only: {
    title: "Only the College directory (SOCO) lists it",
    action: "source gap: no public page we know of; ask via the contribution form",
  },
  other_listing_only: {
    title: "Only another Harvard listing names it",
    action: "the listing's page may link the group; re-read it or check the department site",
  },
};

export interface NameOnlyDiagnosis {
  slug: string;
  name: string;
  group: NameOnlyGroup;
  origins: string[];
  category: string | null;
  scope: string;
  links: string[];
  rejectedLinks: number;
  mentionedOn: string[];
  duplicateOf: string[];
}

/** The group a name-only club belongs to, most actionable first. PURE. */
export function nameOnlyGroup(d: Omit<NameOnlyDiagnosis, "group">): NameOnlyGroup {
  if (d.duplicateOf.length) return "possible_duplicate";
  if (d.mentionedOn.length) return "named_on_stored_pages";
  if (d.links.length) return "social_link_only";
  if (d.rejectedLinks > 0) return "rejected_links_only";
  if (d.origins.length > 0 && d.origins.every((o) => o === "soco.college.harvard.edu")) return "college_directory_only";
  return "other_listing_only";
}

export async function diagnoseNameOnly(db: Db, now = new Date()): Promise<{ rows: NameOnlyDiagnosis[]; path: string }> {
  const index = await getStaticIndex(db, now);
  const targets = index.clubs.filter((c) => !c.isFixture && completenessTier(c) === "name_only");
  const ids = targets.map((c) => c.id);
  if (ids.length === 0) return { rows: [], path: "" };
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

  const origins = await rows<{ club_id: string; domain: string }>(sql`
    select distinct c.club_id, s.domain from claim c
    join claim_evidence e on e.claim_id = c.id join source s on s.id = e.source_id
    where c.club_id in (${idList}) and c.field_key = 'club.name'`);
  const links = await rows<{ club_id: string; status: string; url: string }>(sql`
    select c.club_id, c.status, c.value->>'url' as url from claim c
    where c.club_id in (${idList}) and c.field_key = 'club.link'`);
  const dupes = await rows<{ a: string; b: string; slug_a: string; slug_b: string }>(sql`
    select m.club_a_id as a, m.club_b_id as b, ka.slug as slug_a, kb.slug as slug_b from merge_candidate m
    join club ka on ka.id = m.club_a_id join club kb on kb.id = m.club_b_id
    where m.status = 'proposed' and (m.club_a_id in (${idList}) or m.club_b_id in (${idList}))`);
  // Stored pages whose text contains the exact name (not the club's listing, not search results).
  const texts = await rows<{ url: string; domain: string; text: string }>(sql`
    select distinct on (s.id) s.url, s.domain, lower(ss.extracted_text) as text
    from source_snapshot ss join source s on s.id = ss.source_id
    where s.is_fixture = false and ss.extracted_text is not null
      and s.domain not in ('api.search.brave.com', 'soco.college.harvard.edu')
    order by s.id, ss.fetched_at desc`);

  const out: NameOnlyDiagnosis[] = targets.map((c) => {
    const own = origins.filter((o) => o.club_id === c.id).map((o) => o.domain);
    const name = c.name.toLowerCase();
    // Only distinctive names: "Chess Club" appears on too many pages to mean anything.
    const distinctive = normalizeName(c.name).split(" ").length >= 3;
    const mentionedOn = distinctive
      ? texts
          .filter((t) => !own.includes(t.domain) && t.text.includes(name))
          .map((t) => t.url)
          .slice(0, 5)
      : [];
    const base = {
      slug: c.slug,
      name: c.name,
      origins: [...new Set(own)],
      category: c.categories[0]?.name ?? null,
      scope: c.affiliationScope,
      links: links.filter((l) => l.club_id === c.id && l.status === "active").map((l) => l.url),
      rejectedLinks: links.filter((l) => l.club_id === c.id && l.status === "rejected").length,
      mentionedOn,
      duplicateOf: dupes.filter((d) => d.a === c.id || d.b === c.id).map((d) => (d.a === c.id ? d.slug_b : d.slug_a)),
    };
    return { ...base, group: nameOnlyGroup(base) };
  });

  const order = Object.keys(GROUP_LABEL) as NameOnlyGroup[];
  const lines = [
    "# Name-only clubs: why",
    "",
    `Generated ${now.toISOString()} by \`pnpm hci name-only --diagnose\` from stored data (no network).`,
    "",
    "| Group | Clubs | Next action |",
    "|---|---:|---|",
    ...order.map(
      (g) => `| ${GROUP_LABEL[g].title} | ${out.filter((r) => r.group === g).length} | ${GROUP_LABEL[g].action} |`,
    ),
    "",
  ];
  for (const g of order) {
    const list = out.filter((r) => r.group === g);
    if (!list.length) continue;
    lines.push(`## ${GROUP_LABEL[g].title} (${list.length})`, "");
    for (const r of list) {
      const bits = [
        `from ${r.origins.join(", ") || "?"}`,
        r.category ? `category ${r.category}` : "no category",
        r.links.length ? `links: ${r.links.join(", ")}` : null,
        r.rejectedLinks ? `${r.rejectedLinks} rejected link(s)` : null,
        r.duplicateOf.length ? `maybe the same as ${r.duplicateOf.join(", ")}` : null,
        r.mentionedOn.length ? `named on ${r.mentionedOn.join(", ")}` : null,
      ].filter(Boolean);
      lines.push(`- **${r.name}** (\`${r.slug}\`): ${bits.join(" · ")}`);
    }
    lines.push("");
  }
  const dir = join(findRepoRoot(), "data", "reports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "name-only-diagnosis.md");
  writeFileSync(path, lines.join("\n"));
  return { rows: out, path };
}
