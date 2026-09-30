import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { computeCycleStatus, type DateValue } from "@hci/core";
import { schema, type Db } from "@hci/db";

/**
 * Export normalized, PUBLIC data for manual quality inspection (M2 §18).
 * Never exports student submissions, editorial notes, raw snapshots, or fixture data
 * (unless explicitly requested).
 */

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0] ?? {});
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

export async function exportData(
  db: Db,
  opts: { outDir: string; includeFixtures?: boolean; now?: Date },
): Promise<Record<string, number>> {
  const now = opts.now ?? new Date();
  await mkdir(opts.outDir, { recursive: true });
  const conds = [eq(schema.club.recordState, "active")];
  if (!opts.includeFixtures) conds.push(ne(schema.club.dataOrigin, "fixture"));
  const clubs = await db
    .select()
    .from(schema.club)
    .where(and(...conds))
    .orderBy(asc(schema.club.slug));
  const ids = clubs.map((c) => c.id);
  if (ids.length === 0) return { clubs: 0 };

  const [links, cats, aliases, cycles, sources] = await Promise.all([
    db.select().from(schema.clubLink).where(inArray(schema.clubLink.clubId, ids)),
    db
      .select({ clubId: schema.clubCategory.clubId, slug: schema.category.slug })
      .from(schema.clubCategory)
      .innerJoin(schema.category, eq(schema.category.id, schema.clubCategory.categoryId))
      .where(inArray(schema.clubCategory.clubId, ids)),
    db.select().from(schema.clubAlias).where(inArray(schema.clubAlias.clubId, ids)),
    db.select().from(schema.recruitingCycle).where(inArray(schema.recruitingCycle.clubId, ids)),
    db
      .select({
        clubId: schema.claim.clubId,
        url: schema.source.url,
        type: schema.source.sourceType,
        title: schema.source.title,
        last: sql<Date>`max(${schema.claimEvidence.observedAt})`,
      })
      .from(schema.claimEvidence)
      .innerJoin(schema.claim, eq(schema.claim.id, schema.claimEvidence.claimId))
      .innerJoin(schema.source, eq(schema.source.id, schema.claimEvidence.sourceId))
      .where(inArray(schema.claim.clubId, ids))
      .groupBy(schema.claim.clubId, schema.source.url, schema.source.sourceType, schema.source.title),
  ]);

  const json = clubs.map((c) => {
    const cyc = cycles
      .filter((x) => x.clubId === c.id)
      .map((x) => ({
        term: x.termKey,
        status: computeCycleStatus(
          {
            opensAt: x.opensValue as DateValue | null,
            deadline: x.deadlineValue as DateValue | null,
            statedStatus: x.statedStatus === "open" || x.statedStatus === "closed" ? x.statedStatus : null,
          },
          now,
        ),
        opens: (x.opensValue as DateValue | null)?.at ?? null,
        deadline: (x.deadlineValue as DateValue | null)?.at ?? null,
        processTypes: x.processTypes,
        applicationUrl: x.applicationUrl,
        eligibleClasses: x.eligibleClasses,
        applicants: x.applicants,
        admits: x.admits,
      }));
    return {
      slug: c.slug,
      name: c.canonicalName,
      acronym: c.acronym,
      aliases: aliases.filter((a) => a.clubId === c.id).map((a) => a.alias),
      shortDescription: c.shortDescription,
      categories: cats.filter((x) => x.clubId === c.id).map((x) => x.slug),
      orgType: c.orgType,
      recognitionStatus: c.recognitionStatus,
      activityStatus: c.activityStatus,
      activityConfidence: c.activityConfidence,
      affiliationScope: c.affiliationScope,
      joinModes: c.joinModes,
      freshmenEligible: c.freshmenEligible,
      eligibleClasses: c.eligibleClasses,
      hoursPerWeek:
        c.hoursPerWeekMin !== null || c.hoursPerWeekMax !== null
          ? { min: c.hoursPerWeekMin, max: c.hoursPerWeekMax }
          : null,
      memberCount:
        c.memberCountMin !== null || c.memberCountMax !== null
          ? { min: c.memberCountMin, max: c.memberCountMax }
          : null,
      links: links
        .filter((l) => l.clubId === c.id)
        .map((l) => ({ kind: l.kind, url: l.url, status: l.status, confidence: l.confidence, via: l.discoveredVia })),
      recruitingCycles: cyc,
      completeness: c.completeness,
      lastVerifiedAt: c.lastVerifiedAt,
      lastObservedAt: c.lastObservedAt,
      sources: sources
        .filter((s) => s.clubId === c.id)
        .map((s) => ({ url: s.url, type: s.type, title: s.title, lastObserved: s.last })),
    };
  });

  await writeFile(
    join(opts.outDir, "clubs.json"),
    JSON.stringify({ exportedAt: now.toISOString(), clubs: json }, null, 2),
  );
  await writeFile(
    join(opts.outDir, "clubs.csv"),
    toCsv(
      json.map((c) => ({
        slug: c.slug,
        name: c.name,
        acronym: c.acronym,
        categories: c.categories,
        org_type: c.orgType,
        recognition: c.recognitionStatus,
        activity: c.activityStatus,
        join_modes: c.joinModes,
        freshmen_eligible: c.freshmenEligible,
        website: c.links.find((l) => l.kind === "website" && l.status !== "unverified")?.url ?? null,
        instagram: c.links.find((l) => l.kind === "instagram")?.url ?? null,
        has_description: Boolean(c.shortDescription),
        recruiting_terms: c.recruitingCycles.map((r) => `${r.term}:${r.status}`),
        source_count: c.sources.length,
        completeness: c.completeness,
        last_verified_at: c.lastVerifiedAt,
      })),
    ),
  );
  await writeFile(
    join(opts.outDir, "links.csv"),
    toCsv(
      links.map((l) => ({
        club: clubs.find((c) => c.id === l.clubId)?.slug,
        kind: l.kind,
        url: l.url,
        status: l.status,
        confidence: l.confidence,
        discovered_via: l.discoveredVia,
        signals: l.signals,
      })),
    ),
  );
  const claims = await db
    .select({
      clubId: schema.claim.clubId,
      field: schema.claim.fieldKey,
      value: schema.claim.value,
      assertion: schema.claim.assertionKind,
      term: schema.claim.termKey,
      status: schema.claim.status,
      source: schema.source.url,
      sourceType: schema.source.sourceType,
      method: schema.claimEvidence.extractionMethod,
      confidence: schema.claimEvidence.confidence,
      observedAt: schema.claimEvidence.observedAt,
      quote: schema.claimEvidence.evidenceQuote,
    })
    .from(schema.claim)
    .innerJoin(schema.claimEvidence, eq(schema.claimEvidence.claimId, schema.claim.id))
    .innerJoin(schema.source, eq(schema.source.id, schema.claimEvidence.sourceId))
    .where(inArray(schema.claim.clubId, ids));
  const slugOf = new Map(clubs.map((c) => [c.id, c.slug]));
  await writeFile(
    join(opts.outDir, "claims.csv"),
    toCsv(
      claims.map((r) => ({
        club: slugOf.get(r.clubId),
        ...r,
        clubId: undefined,
        quote: r.quote?.slice(0, 300) ?? null,
      })),
    ),
  );
  const candidates = await db.select().from(schema.mergeCandidate).where(eq(schema.mergeCandidate.status, "proposed"));
  await writeFile(
    join(opts.outDir, "merge-candidates.csv"),
    toCsv(
      candidates.map((m) => ({
        id: m.id,
        a: slugOf.get(m.clubAId) ?? m.clubAId,
        b: slugOf.get(m.clubBId) ?? m.clubBId,
        score: m.score,
        reason: m.reason,
        explanation: m.explanation,
      })),
    ),
  );
  return { clubs: json.length, links: links.length, claims: claims.length, mergeCandidates: candidates.length };
}
