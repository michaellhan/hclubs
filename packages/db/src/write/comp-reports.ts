import { and, eq } from "drizzle-orm";
import { CompReportInput, aggregateCompReports, type CompAggregate, type CompReport } from "@hci/core";
import type { Queryable } from "../client";
import { compReport } from "../schema";

/**
 * Anonymous comp-outcome reports (CLAUDE.md §14, ADR 0035). Stored `pending` with no
 * submitter link and a day-precision date; aggregated only under the k-thresholds in
 * @hci/core. Nothing here is displayed until M6.
 */
export async function recordCompReport(
  db: Queryable,
  raw: CompReportInput,
  opts: { now: Date; recruitingCycleId?: string | null },
): Promise<string> {
  const r = CompReportInput.parse(raw);
  const [row] = await db
    .insert(compReport)
    .values({
      clubId: r.clubId,
      recruitingCycleId: opts.recruitingCycleId ?? null,
      termKey: r.termKey,
      track: r.track,
      classYear: r.classYear,
      applied: r.applied,
      furthestStage: r.furthestStage,
      accepted: r.accepted,
      approxApplicants: r.approxApplicants,
      approxCohortSize: r.approxCohortSize,
      hoursSpent: r.hoursSpent,
      notes: r.notes,
      reportedOn: opts.now.toISOString().slice(0, 10),
    })
    .returning({ id: compReport.id });
  if (!row) throw new Error("comp report insert returned no row");
  return row.id;
}

/** The community aggregate for one club cycle, from moderator-accepted reports only. */
export async function compAggregateFor(
  db: Queryable,
  input: { clubId: string; termKey: string; track?: string },
): Promise<CompAggregate> {
  const rows = await db
    .select()
    .from(compReport)
    .where(
      and(
        eq(compReport.clubId, input.clubId),
        eq(compReport.termKey, input.termKey),
        eq(compReport.track, input.track ?? "main"),
        eq(compReport.status, "accepted"),
      ),
    );
  const reports: CompReport[] = rows.map((r) => ({
    clubId: r.clubId,
    termKey: r.termKey,
    track: r.track,
    classYear: r.classYear as CompReport["classYear"],
    applied: r.applied,
    furthestStage: r.furthestStage as CompReport["furthestStage"],
    accepted: r.accepted,
    approxApplicants: r.approxApplicants,
    approxCohortSize: r.approxCohortSize,
    hoursSpent: r.hoursSpent,
    notes: null, // never leaves moderation
  }));
  return aggregateCompReports(reports);
}
