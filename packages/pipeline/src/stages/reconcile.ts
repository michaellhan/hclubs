import { and, eq, ne, sql } from "drizzle-orm";
import { MATCHER_VERSION, matchOrganization, type KnownOrg } from "@hci/core";
import { finishRun, mergeClubs, resolveClubs, schema, startRun, type Db } from "@hci/db";
import { loadKnownOrgs } from "../entity/resolve";
import type { Logger } from "../logger";

/**
 * Reconciliation (M2 §3, §9): a cross-entity duplicate pass over canonical clubs, then a
 * full deterministic re-resolve of every club's display values.
 *
 * Auto-merge ONLY on a strong identifier shared by two clubs (same directory id, same
 * verified official site, same verified social account) with no contradicting id.
 * Exact-name or weaker matches become merge candidates for review. Rejected/undone pairs
 * are never re-proposed. All merges are reversible (see @hci/db undoMerge).
 */
export interface ReconcileCounters {
  clubsCompared: number;
  autoMerged: number;
  candidatesProposed: number;
  clubsResolved: number;
  resolveFailed: number;
  clubsWithConflicts: number;
  elapsedMs: number;
  [key: string]: number;
}

export async function runReconcile(
  deps: { db: Db; logger: Logger; now?: () => Date },
  opts: { dryRun?: boolean; skipDedupe?: boolean } = {},
): Promise<{
  runId: string;
  status: "succeeded" | "partial" | "failed";
  counters: ReconcileCounters;
  errors: string[];
  merges: string[];
}> {
  const { db, logger } = deps;
  const started = Date.now();
  const runId = await startRun(db, { job: "reconcile", options: { ...opts } });
  const c: ReconcileCounters = {
    clubsCompared: 0,
    autoMerged: 0,
    candidatesProposed: 0,
    clubsResolved: 0,
    resolveFailed: 0,
    clubsWithConflicts: 0,
    elapsedMs: 0,
  };
  const errors: string[] = [];
  const merges: string[] = [];
  try {
    if (!opts.skipDedupe) {
      const known = await loadKnownOrgs(db);
      const existingPairs = new Set(
        (
          await db
            .select({ a: schema.mergeCandidate.clubAId, b: schema.mergeCandidate.clubBId })
            .from(schema.mergeCandidate)
        ).map((p) => `${p.a}|${p.b}`),
      );
      const absorbed = new Set<string>();
      for (const k of known) {
        if (absorbed.has(k.clubId)) continue;
        c.clubsCompared++;
        const others: KnownOrg[] = known.filter((o) => o.clubId !== k.clubId && !absorbed.has(o.clubId));
        const m = matchOrganization(k, others);
        if (m.decision === "new" || !m.clubId) continue;
        const best = m.candidates[0];
        if (!best) continue;
        const [a, b] = k.clubId < best.clubId ? [k.clubId, best.clubId] : [best.clubId, k.clubId];
        const key = `${a}|${b}`;
        if (existingPairs.has(key)) continue; // already proposed, decided, or rejected
        existingPairs.add(key);
        if (m.decision === "definite" && best.strong) {
          if (opts.dryRun) {
            merges.push(
              `[dry-run] would merge ${k.names[0]} → ${known.find((x) => x.clubId === best.clubId)?.names[0]}: ${m.explanation}`,
            );
            continue;
          }
          // Survivor: the club with more evidence (more names/links/ids).
          const other = known.find((x) => x.clubId === best.clubId);
          const weight = (o: KnownOrg | undefined) =>
            o ? (o.urls?.length ?? 0) + (o.externalIds?.length ?? 0) + o.names.length : 0;
          const [absorbedId, survivorId] =
            weight(k) >= weight(other) ? [best.clubId, k.clubId] : [k.clubId, best.clubId];
          await db
            .insert(schema.mergeCandidate)
            .values({
              clubAId: a,
              clubBId: b,
              score: best.score,
              signals: best.signals,
              reason: "auto_strong_identifier",
              explanation: m.explanation,
              matcherVersion: MATCHER_VERSION,
            })
            .onConflictDoNothing();
          await mergeClubs(db, { absorbedId, survivorId, actor: "reconciler", reason: m.explanation });
          absorbed.add(absorbedId);
          c.autoMerged++;
          merges.push(
            `merged ${known.find((x) => x.clubId === absorbedId)?.names[0]} → ${known.find((x) => x.clubId === survivorId)?.names[0]} (${m.explanation})`,
          );
        } else if (!opts.dryRun) {
          await db
            .insert(schema.mergeCandidate)
            .values({
              clubAId: a,
              clubBId: b,
              score: best.score,
              signals: best.signals,
              reason: m.decision === "ambiguous" ? "ambiguous" : "likely_duplicate",
              explanation: m.explanation,
              matcherVersion: MATCHER_VERSION,
            })
            .onConflictDoNothing();
          c.candidatesProposed++;
        }
      }
    }

    const stats = await resolveClubs(db, {
      now: deps.now?.() ?? new Date(),
      onError: (id, e) => logger.error({ clubId: id, error: String(e) }, "resolve failed"),
    });
    c.clubsResolved = stats.clubs;
    c.resolveFailed = stats.failed;
    errors.push(...stats.errors.map((e) => `resolve ${e.clubId}: ${e.error}`));
    const [conf] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.club)
      .where(
        and(
          eq(schema.club.recordState, "active"),
          ne(schema.club.dataOrigin, "fixture"),
          sql`cardinality(${schema.club.conflictFields}) > 0`,
        ),
      );
    c.clubsWithConflicts = conf?.n ?? 0;
    c.elapsedMs = Date.now() - started;
    const status = errors.length > 0 ? "partial" : "succeeded";
    await finishRun(db, runId, { status, counters: c, errorSummary: errors.slice(0, 50).join("\n") || null });
    return { runId, status, counters: c, errors, merges };
  } catch (error) {
    c.elapsedMs = Date.now() - started;
    await finishRun(db, runId, { status: "failed", counters: c, errorSummary: String(error) });
    throw error;
  }
}
