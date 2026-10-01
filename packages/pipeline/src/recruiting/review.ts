import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { dateValueEnd } from "@hci/core";
import { findRepoRoot, getStaticIndex, schema, type Db } from "@hci/db";
import {
  boardEligible,
  buildRecruitingBoard,
  buildStartedNoDeadline,
  isPastTerm,
  liveClub,
  type IndexClub,
} from "@hci/db/local";

/**
 * Recruiting review (maintainers only): every live cycle with a date, a stated status or an
 * application link in the current or a later term, with the board section it lands in and,
 * for each shown value, the page it came from, when that page was fetched and the quote.
 * A wrong deadline is worse than a missing one, and this set is small enough to read in
 * full before every publish. Read-only.
 */

type IndexCycle = IndexClub["cycles"][number];

export interface ReviewEvidence {
  field: string;
  value: string;
  url: string;
  tier: number;
  fetchedAt: string | null;
  quote: string | null;
}

export interface ReviewRow {
  slug: string;
  name: string;
  scope: string;
  activity: string;
  joinModes: string[];
  term: string;
  track: string;
  status: IndexCycle["status"];
  opens: string | null;
  deadline: string | null;
  applicationUrl: string | null;
  section: string;
  evidence: ReviewEvidence[];
  warnings: string[];
}

const FIELDS = ["cycle.deadline", "cycle.opens_at", "cycle.application_url", "cycle.stated_status"];
const DAY = 86_400_000;

/** Where a cycle shows up on /recruiting today (or why it doesn't). PURE. */
export function boardSection(club: IndexClub, cycle: IndexCycle, now: Date): string {
  if (!boardEligible(club)) return "not on board (graduate school or ended)";
  const board = buildRecruitingBoard([club], { now });
  const has = (list: { cycle: { id: string } }[]) => list.some((e) => e.cycle.id === cycle.id);
  if (has(board.open)) {
    const due = cycle.deadline ? dateValueEnd(cycle.deadline).getTime() : null;
    return due !== null && due - now.getTime() <= 7 * DAY ? "due in the next 7 days" : "open now";
  }
  if (has(board.upcoming)) return "opening soon";
  if (has(board.recentlyClosed)) return "recently closed";
  if (has(buildStartedNoDeadline([club], { now }))) return "started, no deadline listed";
  return "not on board (profile only)";
}

/** Combinations that should not be published as they are. PURE. */
export function reviewWarnings(club: IndexClub, cycle: IndexCycle, evidence: ReviewEvidence[], now: Date): string[] {
  const w: string[] = [];
  if (club.activityStatus === "defunct" || club.activityStatus === "inactive") w.push("club ended or inactive");
  if (club.affiliationScope === "graduate_school") w.push("graduate-school group");
  if (cycle.opens && cycle.deadline && cycle.opens.at > cycle.deadline.at) w.push("opens after its deadline");
  if (cycle.statedStatus === "closed" && (cycle.status === "open" || cycle.status === "deadline_ahead"))
    w.push("a source says closed but dates say open");
  for (const e of evidence) {
    if (!e.fetchedAt) continue;
    const age = (now.getTime() - new Date(e.fetchedAt).getTime()) / DAY;
    if (age > 120) w.push(`${e.field.replace("cycle.", "")} comes from a page fetched ${Math.round(age)} days ago`);
  }
  if (cycle.applicationUrl && !cycle.deadline && !cycle.opens && cycle.status !== "open")
    w.push("application link with no dates: the profile must not call it open");
  if (club.joinModes.length === 0 && cycle.processTypes.length === 0) w.push("no joining process known");
  return [...new Set(w)];
}

export async function recruitingReview(db: Db, now: Date): Promise<{ rows: ReviewRow[]; path: string }> {
  const index = await getStaticIndex(db, now);
  const picked: { club: IndexClub; cycle: IndexCycle }[] = [];
  for (const raw of index.clubs) {
    if (raw.isFixture) continue;
    const club = liveClub(raw, now);
    for (const cycle of club.cycles) {
      if (isPastTerm(cycle.termKey, now)) continue;
      if (!cycle.deadline && !cycle.opens && !cycle.statedStatus && !cycle.applicationUrl) continue;
      picked.push({ club, cycle });
    }
  }
  const ids = picked.map((p) => p.cycle.id);
  const claims = ids.length
    ? await db
        .select({
          cycleId: schema.claim.recruitingCycleId,
          field: schema.claim.fieldKey,
          value: schema.claim.value,
          url: schema.source.url,
          tier: schema.source.trustTier,
          fetchedAt: schema.sourceSnapshot.fetchedAt,
          quote: schema.claimEvidence.evidenceQuote,
        })
        .from(schema.claim)
        .innerJoin(schema.claimEvidence, eq(schema.claimEvidence.claimId, schema.claim.id))
        .innerJoin(schema.source, eq(schema.source.id, schema.claimEvidence.sourceId))
        .leftJoin(schema.sourceSnapshot, eq(schema.sourceSnapshot.id, schema.claimEvidence.snapshotId))
        .where(
          and(
            inArray(schema.claim.recruitingCycleId, ids),
            eq(schema.claim.status, "active"),
            inArray(schema.claim.fieldKey, FIELDS),
          ),
        )
    : [];
  const rows: ReviewRow[] = picked.map(({ club, cycle }) => {
    // One line per field and value: the best-tier, most recently fetched evidence.
    const best = new Map<string, ReviewEvidence>();
    for (const c of claims.filter((x) => x.cycleId === cycle.id)) {
      const value = typeof c.value === "string" ? c.value : JSON.stringify(c.value);
      const key = `${c.field}|${value}`;
      const e: ReviewEvidence = {
        field: c.field,
        value,
        url: c.url,
        tier: c.tier,
        fetchedAt: c.fetchedAt?.toISOString() ?? null,
        quote: c.quote,
      };
      const cur = best.get(key);
      if (!cur || e.tier < cur.tier || (e.tier === cur.tier && (e.fetchedAt ?? "") > (cur.fetchedAt ?? "")))
        best.set(key, e);
    }
    const evidence = [...best.values()].sort((a, b) => a.field.localeCompare(b.field));
    return {
      slug: club.slug,
      name: club.name,
      scope: club.affiliationScope,
      activity: club.activityStatus,
      joinModes: club.joinModes,
      term: cycle.termKey,
      track: cycle.track,
      status: cycle.status,
      opens: cycle.opens?.at ?? null,
      deadline: cycle.deadline?.at ?? null,
      applicationUrl: cycle.applicationUrl,
      section: boardSection(club, cycle, now),
      evidence,
      warnings: reviewWarnings(club, cycle, evidence, now),
    };
  });
  rows.sort((a, b) => a.section.localeCompare(b.section) || (a.deadline ?? "9").localeCompare(b.deadline ?? "9"));

  const lines = [
    "# Recruiting review",
    "",
    `Generated ${now.toISOString()} by \`pnpm hci recruiting-review\`. Every cycle in the current or a`,
    "later term that has a date, a stated status or an application link. Read it in full before",
    "publishing: a wrong deadline is worse than a missing one. Fix a wrong value with",
    "`pnpm hci reject-value <slug> <field> <value> --reason=…` (reversible).",
    "",
    `${rows.length} cycles at ${new Set(rows.map((r) => r.slug)).size} clubs; ${rows.filter((r) => r.warnings.length).length} with warnings.`,
    "",
  ];
  let section = "";
  for (const r of rows) {
    if (r.section !== section) {
      section = r.section;
      lines.push(`## ${section}`, "");
    }
    lines.push(`### ${r.name} (\`${r.slug}\`) — ${r.term}${r.track === "main" ? "" : ` / ${r.track}`}`, "");
    lines.push(
      `- status now: **${r.status}** · opens ${r.opens ?? "—"} · deadline ${r.deadline ?? "—"} · scope ${r.scope} · joins by ${r.joinModes.join(", ") || "unknown"}`,
    );
    if (r.applicationUrl) lines.push(`- application link: ${r.applicationUrl}`);
    for (const e of r.evidence)
      lines.push(
        `- ${e.field.replace("cycle.", "")} = ${e.value.slice(0, 90)} · tier ${e.tier} · fetched ${e.fetchedAt?.slice(0, 10) ?? "?"} · ${e.url}${e.quote ? `\n  > ${e.quote.replace(/\s+/g, " ").slice(0, 240)}` : ""}`,
      );
    for (const w of r.warnings) lines.push(`- ⚠ ${w}`);
    lines.push("");
  }
  const dir = join(findRepoRoot(), "data", "reports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "recruiting-review.md");
  writeFileSync(path, lines.join("\n"));
  return { rows, path };
}
