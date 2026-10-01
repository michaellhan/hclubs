import { z } from "zod";
import { StageKind } from "./enums";
import { ClassYear } from "./fields/values";
import { TermKey } from "./terms";

/**
 * Anonymous comp-outcome reports (CLAUDE.md §14, ADR 0035). Storage and aggregation rules
 * only: public display stays off (`COMP_AGGREGATION.displayEnabled`) until reports are
 * collected through a Harvard-verified channel (M6).
 *
 * A report has no name, email, NetID or free-form identity, and no link to a user. Notes
 * are for moderation only and never displayed. Aggregates are community estimates, kept
 * apart from a club's own published numbers and never labelled as an acceptance rate.
 */

export const CompReportInput = z
  .object({
    clubId: z.string().uuid(),
    termKey: TermKey,
    track: z
      .string()
      .regex(/^[a-z_]+$/)
      .default("main"),
    /** Coarse class year at the time of applying; never finer than this. */
    classYear: ClassYear.nullable().default(null),
    applied: z.boolean(),
    furthestStage: StageKind.nullable().default(null),
    /** null = still waiting or prefers not to say. */
    accepted: z.boolean().nullable().default(null),
    approxApplicants: z.number().int().min(1).max(5000).nullable().default(null),
    approxCohortSize: z.number().int().min(1).max(1000).nullable().default(null),
    /** Total hours the reporter spent on the process. */
    hoursSpent: z.number().min(0).max(500).nullable().default(null),
    /** Moderation only; never displayed or exported. */
    notes: z.string().trim().max(1000).nullable().default(null),
  })
  .refine((r) => r.applied || (r.accepted === null && r.furthestStage === null), {
    message: "a report that didn't apply can't have a stage or outcome",
  });
export type CompReportInput = z.input<typeof CompReportInput>;
export type CompReport = z.output<typeof CompReportInput>;

export const COMP_AGGREGATION = {
  version: "comp-agg-v1",
  /** Public display is off until M6 (verified, rate-limited collection). */
  displayEnabled: false,
  /** Below this many accepted reports for a club's cycle, nothing is shown, not even the count. */
  minReports: 5,
  /** The share of reporters admitted needs more reports than anything else. */
  minReportsForShare: 10,
  /** Every count a display could reveal (admitted, not admitted, a stage) must be at least this. */
  minCell: 3,
  /** The admitted share is shown as a band this many points wide (e.g. 20–30%). */
  shareBand: 10,
  /** Medians round to two significant figures (applicants, cohort) or this many hours. */
  hoursStep: 5,
} as const;

export const COMP_COMMUNITY_LABEL =
  "From anonymous student reports, not from the club. Reporters are self-selected, so this isn't an acceptance rate.";

type Rules = typeof COMP_AGGREGATION;

export type CompAggregate =
  | { source: "community"; shown: false; reason: string }
  | {
      source: "community";
      shown: true;
      rulesVersion: string;
      /** Reports aggregated (sample size, always shown). */
      reports: number;
      /** Band of reporters with a known outcome who were admitted, or null when too few. */
      admittedShare: { low: number; high: number; of: number } | null;
      /** Furthest stage reached, only stages with at least `minCell` reports. */
      furthestStages: { stage: string; reports: number }[];
      /** Reports whose stage is hidden because its count is too small. */
      otherStages: number;
      medianApplicantsEstimate: number | null;
      medianCohortEstimate: number | null;
      medianHoursSpent: number | null;
    };

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function twoSigFigs(n: number): number {
  if (n < 100) return Math.round(n);
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

/**
 * Aggregate one club cycle's accepted reports under the k-thresholds above. PURE.
 * Deliberately has no class-year breakdown and never returns notes or single reports.
 */
export function aggregateCompReports(reports: readonly CompReport[], rules: Rules = COMP_AGGREGATION): CompAggregate {
  const keys = new Set(reports.map((r) => `${r.clubId}|${r.termKey}|${r.track}`));
  if (keys.size > 1) throw new Error("aggregate one club cycle at a time");
  const applied = reports.filter((r) => r.applied);
  if (applied.length < rules.minReports)
    return { source: "community", shown: false, reason: `fewer than ${rules.minReports} reports` };

  // Admitted share: needs enough reports with a known outcome, and enough on each side so
  // no small group's outcome can be read off (a 100% or 0% band would reveal everyone's).
  const known = applied.filter((r) => r.accepted !== null);
  const admitted = known.filter((r) => r.accepted).length;
  let admittedShare: { low: number; high: number; of: number } | null = null;
  if (
    known.length >= rules.minReportsForShare &&
    admitted >= rules.minCell &&
    known.length - admitted >= rules.minCell
  ) {
    const pct = (admitted / known.length) * 100;
    const low = Math.min(100 - rules.shareBand, Math.floor(pct / rules.shareBand) * rules.shareBand);
    admittedShare = { low, high: low + rules.shareBand, of: known.length };
  }

  const byStage = new Map<string, number>();
  for (const r of applied) if (r.furthestStage) byStage.set(r.furthestStage, (byStage.get(r.furthestStage) ?? 0) + 1);
  const furthestStages = [...byStage]
    .filter(([, n]) => n >= rules.minCell)
    .map(([stage, n]) => ({ stage, reports: n }))
    .sort((a, b) => b.reports - a.reports || a.stage.localeCompare(b.stage));
  const shownStages = furthestStages.reduce((s, x) => s + x.reports, 0);
  const hiddenStages = [...byStage.values()].reduce((s, n) => s + n, 0) - shownStages;

  const est = (xs: (number | null)[], round: (n: number) => number) => {
    const vals = xs.filter((x): x is number => x !== null);
    const m = vals.length >= rules.minReports ? median(vals) : null;
    return m === null ? null : round(m);
  };
  return {
    source: "community",
    shown: true,
    rulesVersion: rules.version,
    reports: applied.length,
    admittedShare,
    furthestStages,
    // Small stages are reported only as one total, and only when that total is itself
    // at least minCell.
    otherStages: hiddenStages >= rules.minCell ? hiddenStages : 0,
    medianApplicantsEstimate: est(
      applied.map((r) => r.approxApplicants),
      twoSigFigs,
    ),
    medianCohortEstimate: est(
      applied.map((r) => r.approxCohortSize),
      twoSigFigs,
    ),
    medianHoursSpent: est(
      applied.map((r) => r.hoursSpent),
      (n) => Math.max(rules.hoursStep, Math.round(n / rules.hoursStep) * rules.hoursStep),
    ),
  };
}
