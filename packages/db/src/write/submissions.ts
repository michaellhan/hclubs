import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";
import { CONTRIBUTION_TYPES, contributionType, type ContributionType } from "@hci/core";
import type { Queryable } from "../client";
import { club, editorialDecision, studentSubmission } from "../schema";

/**
 * Public corrections (CLAUDE.md §14). Submissions are queued as `pending` and never
 * become claims automatically: an editor reviews them, and an accepted one is recorded
 * by fetching its official evidence URL (so the fact is backed by a real snapshot) or
 * entered manually with a citation.
 */
/** Contribution types (ADR 0035), plus the kinds imports used before them. */
export const SUBMISSION_KINDS = [...CONTRIBUTION_TYPES, "edit_suggestion", "link", "inactive_report"] as const;
export const SubmissionKind = z.enum(SUBMISSION_KINDS);
export type SubmissionKind = z.infer<typeof SubmissionKind>;

const LEGACY_KIND_LABEL: Record<string, string> = {
  edit_suggestion: "Correction",
  link: "Official link",
  inactive_report: "Club seems inactive",
};

export function submissionKindLabel(kind: string): string {
  return (CONTRIBUTION_TYPES as readonly string[]).includes(kind)
    ? contributionType(kind as ContributionType).label
    : (LEGACY_KIND_LABEL[kind] ?? kind);
}

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL");

export const SubmissionInput = z.object({
  kind: SubmissionKind,
  clubSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(120),
  message: z.string().trim().min(5, "Tell us what should change.").max(2000),
  evidenceUrl: z.union([httpUrl, z.literal("")]).transform((v) => v || null),
});
export type SubmissionInput = z.input<typeof SubmissionInput>;

/** Per-submitter cap within a rolling hour; the ref is an opaque keyed hash, never an IP or email. */
export const SUBMISSIONS_PER_HOUR = 5;

export type SubmitResult =
  { ok: true; id: string } | { ok: false; error: "club_not_found" | "rate_limited" | "invalid"; message: string };

export async function createSubmission(
  db: Queryable,
  raw: unknown,
  opts: { submitterRef: string | null; now: Date },
): Promise<SubmitResult> {
  const parsed = SubmissionInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid submission." };
  const input = parsed.data;
  const [target] = await db
    .select({ id: club.id })
    .from(club)
    .where(and(eq(club.slug, input.clubSlug), eq(club.recordState, "active")));
  if (!target) return { ok: false, error: "club_not_found", message: "That club no longer exists." };

  if (opts.submitterRef) {
    const since = new Date(opts.now.getTime() - 3600_000);
    const [recent] = await db
      .select({ n: count().mapWith(Number) })
      .from(studentSubmission)
      .where(and(eq(studentSubmission.submitterRef, opts.submitterRef), gt(studentSubmission.createdAt, since)));
    if ((recent?.n ?? 0) >= SUBMISSIONS_PER_HOUR)
      return { ok: false, error: "rate_limited", message: "Too many submissions — please try again later." };
  }

  const [row] = await db
    .insert(studentSubmission)
    .values({
      kind: input.kind,
      clubId: target.id,
      payload: { message: input.message },
      evidenceUrl: input.evidenceUrl,
      submitterRef: opts.submitterRef,
      status: "pending",
      createdAt: opts.now,
    })
    .returning({ id: studentSubmission.id });
  if (!row) throw new Error("submission insert returned no row");
  return { ok: true, id: row.id };
}

export async function listPendingSubmissions(db: Queryable, limit = 200) {
  return db
    .select({
      id: studentSubmission.id,
      kind: studentSubmission.kind,
      payload: studentSubmission.payload,
      evidenceUrl: studentSubmission.evidenceUrl,
      createdAt: studentSubmission.createdAt,
      clubSlug: club.slug,
      clubName: club.canonicalName,
    })
    .from(studentSubmission)
    .leftJoin(club, eq(club.id, studentSubmission.clubId))
    .where(eq(studentSubmission.status, "pending"))
    .orderBy(desc(studentSubmission.createdAt))
    .limit(limit);
}

/** Editor decision on a submission; audited in editorial_decision. */
export async function reviewSubmission(
  db: Queryable,
  input: {
    id: string;
    status: "accepted" | "partially_accepted" | "rejected" | "spam";
    actor: string;
    note?: string;
    now: Date;
  },
): Promise<void> {
  const updated = await db
    .update(studentSubmission)
    .set({ status: input.status, reviewNote: input.note ?? null, reviewedAt: input.now })
    .where(and(eq(studentSubmission.id, input.id), inArray(studentSubmission.status, ["pending"])))
    .returning({ id: studentSubmission.id, clubId: studentSubmission.clubId });
  const row = updated[0];
  if (!row) return;
  await db.insert(editorialDecision).values({
    actor: input.actor,
    action: `submission_${input.status}`,
    targetType: "student_submission",
    targetId: row.id,
    reason: input.note ?? null,
    createdAt: input.now,
  });
}
