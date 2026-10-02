import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { compareTermKeys, dateValueEnd, termForDate, termKey } from "@hci/core";
import { findRepoRoot, getStaticIndex, schema, type Db } from "@hci/db";
import {
  isSparseClub,
  matchesOpenJoin,
  recruitingSeasonForDate,
  type IndexClub,
} from "@hci/db/local";

/**
 * Coverage and "what to find next" reports for maintainers (not public; no club is ranked
 * on the site). `coverage` says how much of each field is known, overall and per top-level
 * category, so the UI gives prominence only to fields with real coverage. `queue` lists
 * the missing facts most worth finding, by kind. Both read the built index plus the
 * resolved field keys; nothing is written to the database.
 */

interface Row {
  club: IndexClub;
  fields: Set<string>;
  conflicts: string[];
  website: boolean;
}

async function load(
  db: Db,
  now: Date,
): Promise<{ rows: Row[]; categories: { slug: string; name: string; parentSlug: string | null }[] }> {
  const index = await getStaticIndex(db, now);
  const meta = await db
    .select({ id: schema.club.id, fields: schema.club.fields, conflicts: schema.club.conflictFields })
    .from(schema.club)
    .where(eq(schema.club.recordState, "active"));
  const byId = new Map(meta.map((m) => [m.id, m]));
  const rows = index.clubs
    .filter((c) => !c.isFixture)
    .map((club) => {
      const m = byId.get(club.id);
      return {
        club,
        fields: new Set(Object.keys((m?.fields as Record<string, unknown> | null) ?? {})),
        conflicts: m?.conflicts ?? [],
        website: Boolean(club.quickLinks?.website),
      };
    });
  return { rows, categories: index.categories };
}

const CHECKS: { key: string; label: string; has: (r: Row, now: Date) => boolean }[] = [
  { key: "description", label: "One-line description", has: (r) => Boolean(r.club.shortDescription) },
  { key: "about", label: "Long description", has: (r) => r.fields.has("club.long_description") },
  { key: "website", label: "Website", has: (r) => r.website },
  { key: "instagram", label: "Instagram", has: (r) => Boolean(r.club.quickLinks?.instagram) },
  { key: "category", label: "Category", has: (r) => r.club.categories.length > 0 },
  { key: "join", label: "How to join", has: (r) => r.club.joining.access !== null || r.club.joining.comp !== null },
  { key: "open", label: "…of which: open membership", has: (r) => matchesOpenJoin(r.club) },
  { key: "firstYears", label: "First-year eligibility (yes or no)", has: (r) => r.club.joining.firstYears !== null },
  { key: "seasons", label: "Usual recruiting season", has: (r) => r.club.recruitingSeasons.length > 0 },
  {
    key: "cycleNow",
    label: "Dated recruiting this term",
    has: (r, now) => r.club.cycles.some((c) => compareTermKeys(c.termKey, termKey(termForDate(now))) >= 0),
  },
  { key: "appLink", label: "Application link", has: (r) => r.club.cycles.some((c) => c.applicationUrl) },
  { key: "members", label: "Member count", has: (r) => r.club.memberCount !== null },
  { key: "hours", label: "Hours per week", has: (r) => r.club.hoursPerWeek !== null },
  { key: "dues", label: "Dues", has: (r) => r.fields.has("club.dues") },
  { key: "selectivity", label: "Applicant/admit numbers", has: (r) => r.fields.has("cycle.applicants") },
  { key: "logo", label: "Logo", has: (r) => Boolean(r.club.logo) },
  {
    key: "recent",
    label: "Source seen in the last 90 days",
    has: (r, now) =>
      Boolean(r.club.lastObservedAt && now.getTime() - Date.parse(r.club.lastObservedAt) < 90 * 86_400_000),
  },
];

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "—");

/** The yes/no/unknown dimensions behind the directory's joining filters (ADR 0041). */
const TRI: { label: string; value: (r: Row) => boolean | null; conflict: (r: Row) => boolean }[] = [
  {
    label: "Open membership (yes = open, no = a process for members)",
    value: (r) => (r.club.joining.access === "open" ? true : r.club.joining.access === "process" ? false : null),
    conflict: (r) => r.club.joining.conflicts.includes("access"),
  },
  {
    label: "No comp (yes = no comp, no = a comp)",
    value: (r) => (r.club.joining.comp === null ? null : !r.club.joining.comp),
    conflict: (r) => r.club.joining.conflicts.includes("comp"),
  },
  {
    label: "First-years eligible",
    value: (r) => r.club.joining.firstYears,
    conflict: (r) => r.club.joining.conflicts.includes("firstYears"),
  },
  {
    label: "No dues (yes = none, no = dues charged)",
    value: (r) => (r.club.joining.dues === null ? null : !r.club.joining.dues),
    conflict: (r) => r.club.joining.conflicts.includes("dues"),
  },
];

function triLines(rows: readonly Row[]): string[] {
  return TRI.map((t) => {
    const yes = rows.filter((r) => t.value(r) === true).length;
    const no = rows.filter((r) => t.value(r) === false).length;
    const conflicts = rows.filter(t.conflict).length;
    const unknown = rows.length - yes - no;
    return `| ${t.label} | ${yes} | ${no} | ${unknown} | ${pct(yes + no, rows.length)} | ${conflicts} |`;
  });
}

export async function coverageReport(db: Db, now = new Date()): Promise<{ markdown: string; path: string }> {
  const { rows, categories } = await load(db, now);
  const tops = categories.filter((c) => !c.parentSlug);
  const lines = [
    "# Coverage",
    "",
    `Generated ${now.toISOString()} by \`pnpm hci coverage\` over ${rows.length} active clubs (fixtures excluded).`,
    "Use it to decide what the UI can lean on: a field known for a few percent of clubs should stay quiet.",
    "",
    "## Overall",
    "",
    "| Field | Known | Share |",
    "|---|---:|---:|",
    ...CHECKS.map((c) => {
      const n = rows.filter((r) => c.has(r, now)).length;
      return `| ${c.label} | ${n} | ${pct(n, rows.length)} |`;
    }),
    "",
    "## Joining facts: yes / no / unknown",
    "",
    "Unknown is never counted as no. Conflicting sources are unknown (and listed separately).",
    "",
    "| Fact | Yes | No | Unknown | Known | Conflicting |",
    "|---|---:|---:|---:|---:|---:|",
    ...triLines(rows),
    "",
    "## By top-level category",
    "",
    `| Category | Clubs | ${CHECKS.filter((c) =>
      ["description", "website", "join", "firstYears", "seasons", "hours", "members"].includes(c.key),
    )
      .map((c) => c.label)
      .join(" | ")} |`,
    `|---|---:|${"---:|".repeat(7)}`,
  ];
  const cols = CHECKS.filter((c) =>
    ["description", "website", "join", "firstYears", "seasons", "hours", "members"].includes(c.key),
  );
  for (const t of tops) {
    const inCat = rows.filter((r) => r.club.categorySlugs.includes(t.slug));
    if (!inCat.length) continue;
    lines.push(
      `| ${t.name} | ${inCat.length} | ${cols.map((c) => pct(inCat.filter((r) => c.has(r, now)).length, inCat.length)).join(" | ")} |`,
    );
  }
  const none = rows.filter((r) => r.club.categorySlugs.length === 0);
  if (none.length)
    lines.push(
      `| (no category) | ${none.length} | ${cols.map((c) => pct(none.filter((r) => c.has(r, now)).length, none.length)).join(" | ")} |`,
    );
  const markdown = `${lines.join("\n")}\n`;
  const path = join(findRepoRoot(), "data", "reports", "coverage.md");
  mkdirSync(join(findRepoRoot(), "data", "reports"), { recursive: true });
  writeFileSync(path, markdown);
  return { markdown, path };
}

interface QueueItem {
  slug: string;
  name: string;
  why: string;
}

/**
 * The most valuable missing facts, grouped by kind and ordered by how much a student would
 * miss them: this term's deadlines first (time-sensitive), then joining basics, then
 * descriptions. Within a kind, clubs with more already known come first (one more fact
 * completes a useful page).
 */
export async function missingQueue(
  db: Db,
  opts: { now?: Date; limit?: number } = {},
): Promise<{ markdown: string; path: string }> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 25;
  const { rows } = await load(db, now);
  const season = recruitingSeasonForDate(now);
  const current = termKey(termForDate(now));
  const active = rows.filter(
    (r) =>
      r.club.activityStatus !== "inactive" &&
      r.club.activityStatus !== "defunct" &&
      r.club.affiliationScope !== "graduate_school",
  );
  const byCompleteness = (a: Row, b: Row) =>
    b.club.completeness - a.club.completeness || a.club.name.localeCompare(b.club.name);
  const item = (r: Row, why: string): QueueItem => ({ slug: r.club.slug, name: r.club.name, why });
  const hasCurrent = (r: Row) => r.club.cycles.some((c) => compareTermKeys(c.termKey, current) >= 0);
  const selective = (r: Row) => r.club.joinModes.some((m) => ["application", "comp", "audition", "tryout"].includes(m));

  const soon = now.getTime() + 21 * 86_400_000;
  const dueSoon = (r: Row) =>
    r.club.cycles
      .filter((c) => c.deadline && c.statedStatus !== "closed")
      .map((c) => ({ c, end: dateValueEnd(c.deadline!).getTime() }))
      .filter(({ end }) => end >= now.getTime() && end <= soon)
      .sort((a, b) => a.end - b.end)[0];
  const buckets: { title: string; why: string; items: QueueItem[] }[] = [
    {
      title: "Deadlines in the next three weeks: confirm on the club's page",
      why: "Students act on these now; a wrong date does real harm. `pnpm hci explain <slug> cycle.deadline` shows the quote and page.",
      items: active
        .map((r) => ({ r, d: dueSoon(r) }))
        .filter((x): x is { r: Row; d: NonNullable<ReturnType<typeof dueSoon>> } => Boolean(x.d))
        .sort((a, b) => a.d.end - b.d.end)
        .map(({ r, d }) =>
          item(
            r,
            `due ${d.c.deadline!.at.slice(0, 10)} (${d.c.termKey})${d.c.applicationUrl ? "" : ", no application link"}`,
          ),
        ),
    },
    {
      title: `Usually recruit in the ${season}, no ${season} dates yet`,
      why: "Time-sensitive: students are deciding now.",
      items: active
        .filter((r) => r.club.recruitingSeasons.includes(season) && !hasCurrent(r))
        .sort(byCompleteness)
        .map((r) => item(r, `pattern ${r.club.recruitingSeasons.join("/")}`)),
    },
    {
      title: "Selective, but no recruiting dates on record at all",
      why: "An application or comp with no known timing.",
      items: active
        .filter((r) => selective(r) && r.club.cycles.length === 0 && !r.club.recruitingSeasons.length)
        .sort(byCompleteness)
        .map((r) => item(r, r.club.joinModes.join(", "))),
    },
    {
      title: "Dated cycle this term, no application link",
      why: "Students see a deadline but not where to apply.",
      items: active
        .filter((r) =>
          r.club.cycles.some(
            (c) => compareTermKeys(c.termKey, current) >= 0 && !c.applicationUrl && (c.deadline || c.opens),
          ),
        )
        .sort(byCompleteness)
        .map((r) => item(r, "deadline known")),
    },
    {
      title: "Selective, first-year eligibility unknown",
      why: "The first question a first-year asks.",
      items: active
        .filter((r) => selective(r) && r.club.freshmenEligible === null && !(r.club.eligibleClasses ?? []).length)
        .sort(byCompleteness)
        .map((r) => item(r, r.club.joinModes.join(", "))),
    },
    {
      title: "Has a website but no description",
      why: "Likely fixable by re-crawling or summarizing the site.",
      items: active
        .filter((r) => r.website && !r.club.shortDescription)
        .sort(byCompleteness)
        .map((r) => item(r, "website known")),
    },
    {
      title: "Sources disagree on a shown field",
      why: "Review with `pnpm hci explain <slug> <field>`.",
      items: active
        .filter((r) => r.conflicts.length)
        .sort(byCompleteness)
        .map((r) => item(r, r.conflicts.join(", "))),
    },
    {
      title: "No category",
      why: "Invisible to category browsing and intents.",
      items: active
        .filter((r) => r.club.categories.length === 0)
        .sort(byCompleteness)
        .map((r) => item(r, "")),
    },
    {
      title: "Known only by name",
      why: "Hidden from browsing until one fact is found (a description, website or Instagram).",
      items: active
        .filter((r) => isSparseClub(r.club))
        .sort(byCompleteness)
        .map((r) => item(r, r.club.categories.map((c) => c.name).join(", "))),
    },
  ];
  const lines = [
    "# What to find next",
    "",
    `Generated ${now.toISOString()} by \`pnpm hci queue\`. Internal maintenance list — not shown on the site, and not a ranking of clubs.`,
    "Add facts through the normal paths (crawl, curated list, reviewed submissions); never by hand from memory.",
    "",
    "| Kind | Clubs |",
    "|---|---:|",
    ...buckets.map((b) => `| ${b.title} | ${b.items.length} |`),
  ];
  for (const b of buckets) {
    lines.push("", `## ${b.title} (${b.items.length})`, "", b.why, "");
    for (const i of b.items.slice(0, limit)) lines.push(`- \`${i.slug}\` ${i.name}${i.why ? ` — ${i.why}` : ""}`);
    if (b.items.length > limit) lines.push(`- … ${b.items.length - limit} more`);
  }
  const markdown = `${lines.join("\n")}\n`;
  const path = join(findRepoRoot(), "data", "reports", "queue.md");
  mkdirSync(join(findRepoRoot(), "data", "reports"), { recursive: true });
  writeFileSync(path, markdown);
  return { markdown, path };
}
