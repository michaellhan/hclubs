import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sql } from "drizzle-orm";
import { combineConfidence } from "@hci/core";
import { getStaticIndex, mergeClubs, rejectClaims, resolveClubs, schema, type Db } from "@hci/db";
import { completenessTier, COMPLETENESS_TIERS } from "@hci/db/local";
import { checkCategories } from "./checks/categories";
import { checkConsistency } from "./checks/consistency";
import { checkContent } from "./checks/content";
import { checkDuplicates } from "./checks/duplicates";
import { checkFacts } from "./checks/facts";
import { checkInvariants } from "./checks/invariants";
import { checkLinks } from "./checks/links";
import { checkLogos } from "./checks/logos";
import { checkPress } from "./checks/press";
import { checkRecruiting } from "./checks/recruiting";
import { loadAuditData } from "./load";
import { rankFindings, type AuditData, type AuditFinding } from "./types";

/**
 * `pnpm hci audit`: run every check, report findings ranked by severity and confidence, and
 * (with `apply`) fix only the high-confidence ones — claims are rejected with a reason (never
 * deleted), duplicates are merged reversibly, stale projections are re-resolved. ADR 0033.
 */

export const AUDIT_VERSION = "audit-v1";

export const CHECKS: Record<string, (d: AuditData) => AuditFinding[]> = {
  links: checkLinks,
  content: checkContent,
  facts: checkFacts,
  recruiting: checkRecruiting,
  logos: checkLogos,
  press: checkPress,
  categories: checkCategories,
  duplicates: checkDuplicates,
  consistency: checkConsistency,
  invariants: checkInvariants,
};

export interface AuditMetrics {
  clubs: number;
  completeness: Record<string, number>;
  findings: number;
  bySeverity: Record<string, number>;
  byArea: Record<string, number>;
  highConfidenceFixable: number;
  reviewNeeded: number;
  suspiciousLinks: number;
  duplicateCandidates: number;
  recruitingIssues: number;
  logoProblems: number;
  /** Displayed stated facts whose combined evidence confidence is below 0.5. */
  lowConfidenceDisplayedClaims: number;
  orphanedSources: number;
  orphanedClaims: number;
  claimsWithoutEvidence: number;
}

export interface AuditResult {
  version: string;
  generatedAt: string;
  metrics: AuditMetrics;
  findings: AuditFinding[];
  applied: { claimsRejected: number; clubsMerged: string[]; clubsReResolved: number } | null;
}

/** Run the checks (all, or the named groups) over a freshly loaded picture. */
export function runChecks(data: AuditData, only?: readonly string[]): AuditFinding[] {
  const groups = only?.length ? only : Object.keys(CHECKS);
  const findings = groups.flatMap((g) => {
    const check = CHECKS[g];
    if (!check) throw new Error(`unknown check group ${g} (known: ${Object.keys(CHECKS).join(", ")})`);
    return check(data);
  });
  // Findings a person reviewed and kept (`pnpm hci audit-dismiss`) are not reported again.
  const open = findings.filter(
    (f) =>
      !data.dismissed.has(`${f.check}|${f.clubId}|${f.subject}`) && !data.dismissed.has(`${f.check}|${f.clubId}|*`),
  );
  // A claim rejected by an earlier (higher-ranked) finding isn't rejected again.
  const ranked = rankFindings(open);
  const seen = new Set<string>();
  for (const f of ranked)
    if (f.fix?.kind === "reject_claims") {
      f.fix.claimIds = f.fix.claimIds.filter((id) => !seen.has(id));
      for (const id of f.fix.claimIds) seen.add(id);
      if (f.fix.claimIds.length === 0) f.fix = null;
    }
  return ranked;
}

const count = <T extends string>(xs: T[]) =>
  xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

async function metricsFor(db: Db, data: AuditData, findings: AuditFinding[]): Promise<AuditMetrics> {
  const index = await getStaticIndex(db, data.now);
  const completeness = Object.fromEntries(COMPLETENESS_TIERS.map((t) => [t, 0]));
  for (const c of index.clubs) if (!c.isFixture) completeness[completenessTier(c)]! += 1;
  let lowConfidence = 0;
  for (const claim of data.claims) {
    const club = data.clubs.get(claim.clubId);
    if (!club?.displayedClaimIds.has(claim.id) || claim.assertionKind !== "stated") continue;
    const bySource = new Map<string, number>();
    for (const e of claim.evidence) bySource.set(e.sourceId, Math.max(bySource.get(e.sourceId) ?? 0, e.confidence));
    if (combineConfidence([...bySource.values()]) < 0.5 && claim.fieldKey !== "club.summary") lowConfidence++;
  }
  const [orphans] = (await db.execute(sql`
    select
      (select count(*)::int from source s where s.owner_club_id is not null
         and not exists (select 1 from club c where c.id = s.owner_club_id and c.record_state = 'active')
         and not exists (select 1 from club c where c.id = s.owner_club_id and c.record_state = 'merged')) as "orphanedSources",
      (select count(*)::int from claim c join club k on k.id = c.club_id
         where c.status = 'active' and k.record_state = 'merged'
         and not exists (select 1 from club r where r.id = k.merged_into_club_id and r.record_state = 'active')) as "orphanedClaims"
  `)) as unknown as { orphanedSources: number; orphanedClaims: number }[];
  const actionable = findings.filter((f) => f.fix && f.confidence === "high");
  return {
    clubs: data.clubs.size,
    completeness,
    findings: findings.length,
    bySeverity: count(findings.map((f) => f.severity)),
    byArea: count(findings.map((f) => f.area)),
    highConfidenceFixable: actionable.length,
    reviewNeeded: findings.filter((f) => !(f.fix && f.confidence === "high") && f.severity !== "low").length,
    suspiciousLinks: findings.filter((f) => f.area === "links" || f.area === "social" || f.area === "application")
      .length,
    duplicateCandidates: findings.filter((f) => f.area === "duplicate").length,
    recruitingIssues: findings.filter((f) => f.area === "recruiting").length,
    logoProblems: findings.filter((f) => f.area === "logo").length,
    lowConfidenceDisplayedClaims: lowConfidence,
    orphanedSources: orphans?.orphanedSources ?? 0,
    orphanedClaims: orphans?.orphanedClaims ?? 0,
    claimsWithoutEvidence: findings.filter((f) => f.check === "consistency.no_evidence").length,
  };
}

/** Apply high-confidence fixes: rejections (grouped by reason), merges, re-resolution. */
async function applyFixes(db: Db, findings: AuditFinding[], now: Date) {
  const affected = new Set<string>();
  let claimsRejected = 0;
  const byReason = new Map<string, { ids: string[]; checks: Set<string> }>();
  for (const f of findings) {
    if (f.confidence !== "high" || !f.fix) continue;
    if (f.clubId) affected.add(f.clubId);
    if (f.fix.kind === "reject_claims") {
      const g = byReason.get(f.fix.reason) ?? { ids: [], checks: new Set() };
      g.ids.push(...f.fix.claimIds);
      g.checks.add(f.check);
      byReason.set(f.fix.reason, g);
    }
  }
  for (const [reason, g] of byReason) {
    const ids = [...new Set(g.ids)];
    await rejectClaims(db, {
      claimIds: ids,
      actor: "audit",
      reason,
      payload: { audit: AUDIT_VERSION, checks: [...g.checks] },
    });
    claimsRejected += ids.length;
  }
  const merged: string[] = [];
  const gone = new Set<string>();
  for (const f of findings) {
    if (f.confidence !== "high" || f.fix?.kind !== "merge") continue;
    if (gone.has(f.fix.absorbedId) || gone.has(f.fix.survivorId)) continue;
    await mergeClubs(db, {
      absorbedId: f.fix.absorbedId,
      survivorId: f.fix.survivorId,
      actor: "audit",
      reason: f.fix.reason,
    });
    gone.add(f.fix.absorbedId);
    affected.add(f.fix.survivorId);
    affected.delete(f.fix.absorbedId);
    merged.push(f.subject);
  }
  const ids = [...affected].filter((id) => !gone.has(id));
  if (ids.length) await resolveClubs(db, { clubIds: ids, now });
  return { claimsRejected, clubsMerged: merged, clubsReResolved: ids.length };
}

/** HTTP status of a URL (HEAD, then GET when HEAD isn't allowed), or null on a network error. */
export type UrlStatus = (url: string) => Promise<number | null>;

/** A polite status checker: one request at a time per host, 1 s apart, identified user agent. */
export function politeUrlStatus(userAgent: string): UrlStatus {
  const last = new Map<string, Promise<unknown>>();
  return (url) => {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      return Promise.resolve(null);
    }
    const run = async (): Promise<number | null> => {
      const req = async (method: "HEAD" | "GET") =>
        (
          await fetch(url, {
            method,
            redirect: "follow",
            headers: { "user-agent": userAgent },
            signal: AbortSignal.timeout(8000),
          })
        ).status;
      try {
        const head = await req("HEAD");
        return head === 405 || head === 403 ? await req("GET") : head;
      } catch {
        return null;
      } finally {
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    const next = (last.get(host) ?? Promise.resolve()).then(run, run);
    last.set(host, next);
    return next;
  };
}

/** Logos the site shows that no longer load (404/410). Live check; only with --check-urls. */
async function brokenLogos(data: AuditData, status: UrlStatus): Promise<AuditFinding[]> {
  const shown = data.claims.filter(
    (c) =>
      c.fieldKey === "club.logo" &&
      typeof c.value === "string" &&
      data.clubs.get(c.clubId)?.displayedClaimIds.has(c.id),
  );
  const results = await Promise.all(shown.map(async (c) => ({ c, code: await status(String(c.value)) })));
  return results
    .filter(({ code }) => code === 404 || code === 410)
    .map(({ c, code }) => {
      const club = data.clubs.get(c.clubId);
      return {
        check: "logo.broken",
        area: "logo" as const,
        severity: "high" as const,
        confidence: "high" as const,
        clubId: c.clubId,
        slug: club?.slug ?? null,
        subject: String(c.value),
        detail: `the image returns HTTP ${code}`,
        displayed: true,
        fix: {
          kind: "reject_claims" as const,
          claimIds: [c.id],
          reason: `audit logo.broken: the image returns HTTP ${code}`,
        },
      };
    });
}

export async function runAudit(
  db: Db,
  opts: { now: Date; apply: boolean; only?: string[]; reportPath?: string; urlStatus?: UrlStatus },
): Promise<AuditResult> {
  const data = await loadAuditData(db, opts.now);
  const live = opts.urlStatus ? await brokenLogos(data, opts.urlStatus) : [];
  const findings = rankFindings([...runChecks(data, opts.only), ...live]);
  const metrics = await metricsFor(db, data, findings);
  const applied = opts.apply ? await applyFixes(db, findings, opts.now) : null;
  const result: AuditResult = {
    version: AUDIT_VERSION,
    generatedAt: opts.now.toISOString(),
    metrics,
    findings,
    applied,
  };
  if (opts.reportPath) writeReport(opts.reportPath, result);
  return result;
}

/**
 * Record that a person reviewed a finding and kept the data as it is: an audited, reversible
 * `editorial_decision` (action `audit_dismiss`; delete the row to undo). `subject` "*" covers
 * every finding of that check for the club.
 */
export async function dismissFinding(
  db: Db,
  input: { clubId: string; check: string; subject: string; reason: string; actor?: string },
): Promise<void> {
  await db.insert(schema.editorialDecision).values({
    actor: input.actor ?? "audit-review",
    action: "audit_dismiss",
    targetType: "club",
    targetId: input.clubId,
    reason: input.reason,
    payload: { check: input.check, subject: input.subject, audit: AUDIT_VERSION },
  });
}

// --- Report ---------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function table(findings: AuditFinding[], limit = 400): string {
  if (!findings.length) return "_None._\n";
  const rows = findings
    .slice(0, limit)
    .map(
      (f) =>
        `| ${f.check} | ${f.confidence} | ${f.slug ?? ""} | ${esc(f.subject.slice(0, 90))} | ${esc(f.detail.slice(0, 160))} | ${f.fix && f.confidence === "high" ? f.fix.kind.replace("_", " ") : "review"} |`,
    );
  const more = findings.length > limit ? `\n…and ${findings.length - limit} more in the JSON report.\n` : "";
  return `| Check | Confidence | Club | Subject | Detail | Action |\n|---|---|---|---|---|---|\n${rows.join("\n")}\n${more}`;
}

export function renderReport(r: AuditResult): string {
  const m = r.metrics;
  const fixed = r.findings.filter((f) => f.fix && f.confidence === "high");
  const review = r.findings.filter((f) => !(f.fix && f.confidence === "high"));
  const byCheck = Object.entries(count(r.findings.map((f) => f.check))).sort((a, b) => b[1] - a[1]);
  return `# Data-quality audit

Generated ${r.generatedAt} by \`pnpm hci audit\` (${r.version}). Checks are deterministic; only
high-confidence findings are fixed (claims rejected with a reason, never deleted; merges are
reversible with \`pnpm hci unmerge\`).

## Health

| Metric | Value |
|---|---|
| Active clubs | ${m.clubs} |
| Completeness | ${Object.entries(m.completeness)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ")} |
| Findings | ${m.findings} (${Object.entries(m.bySeverity)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}) |
| High-confidence, fixable | ${m.highConfidenceFixable} |
| Needs review (medium+ severity) | ${m.reviewNeeded} |
| Suspicious links | ${m.suspiciousLinks} |
| Duplicate candidates | ${m.duplicateCandidates} |
| Recruiting issues | ${m.recruitingIssues} |
| Logo problems | ${m.logoProblems} |
| Displayed claims below 0.5 confidence | ${m.lowConfidenceDisplayedClaims} |
| Orphaned sources / claims | ${m.orphanedSources} / ${m.orphanedClaims} |
${r.applied ? `| Applied | ${r.applied.claimsRejected} claims rejected, ${r.applied.clubsMerged.length} merges, ${r.applied.clubsReResolved} clubs re-resolved |\n` : ""}
## Findings by check

${byCheck.map(([k, v]) => `- \`${k}\`: ${v}`).join("\n")}

## Critical

${table(r.findings.filter((f) => f.severity === "critical"))}
## High-confidence (fixed${r.applied ? "" : " with --apply"})

${table(fixed.filter((f) => f.severity !== "critical"))}
## Needs review

${table(review.filter((f) => f.severity !== "low" && f.severity !== "critical"))}
## Low severity

${table(
  review.filter((f) => f.severity === "low"),
  150,
)}`;
}

function writeReport(path: string, r: AuditResult) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.json`, JSON.stringify(r, null, 1));
  writeFileSync(`${path}.md`, renderReport(r));
}
