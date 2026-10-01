import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  computeConfidence,
  getField,
  parseFieldValue,
  stableStringify,
  type AssertionKind,
  type ExtractionMethod,
  type FieldKey,
  type SourceType,
} from "@hci/core";
import type { Queryable } from "../client";
import { claim, claimEvidence } from "../schema";

export function hashValue(normalized: unknown): string {
  return createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

export interface ClaimDraft {
  clubId: string;
  recruitingCycleId?: string | null;
  fieldKey: FieldKey;
  value: unknown;
  assertionKind: AssertionKind;
  termKey?: string | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  asOfDate?: Date | null;
}

export interface EvidenceDraft {
  sourceId: string;
  sourceType: SourceType;
  trustTier?: number;
  snapshotId: string | null;
  submissionId?: string | null;
  ingestionRunId: string | null;
  observedAt: Date;
  quote?: string | null;
  locator?: unknown;
  extractionMethod: ExtractionMethod;
  extractorName: string;
  extractorVersion: string;
  llmModel?: string | null;
  promptVersion?: string | null;
  isDirect: boolean;
  /** Defaults to the rubric in @hci/core (CLAUDE.md §7.2). */
  confidence?: number;
}

export class ClaimValidationError extends Error {}

/**
 * Upsert a claim and attach one observation of it. Idempotent:
 *  - the same assertion (subject, field, normalized value, term, kind) is one claim row
 *  - the same observation (claim, source, snapshot, extractor+version) is one evidence row
 * Re-observations only widen first/last_observed_at.
 */
export async function upsertClaim(
  db: Queryable,
  draft: ClaimDraft,
  evidence: EvidenceDraft,
): Promise<{ claimId: string; claimCreated: boolean; evidenceCreated: boolean }> {
  const field = getField(draft.fieldKey);
  const parsed = parseFieldValue(draft.fieldKey, draft.value);
  if (!parsed.ok) throw new ClaimValidationError(`${draft.fieldKey}: ${parsed.error}`);
  const isCycle = field.subjectType === "recruiting_cycle";
  if (isCycle !== Boolean(draft.recruitingCycleId)) {
    throw new ClaimValidationError(`${draft.fieldKey}: recruitingCycleId ${isCycle ? "required" : "not allowed"}`);
  }
  if (draft.assertionKind === "inferred" && evidence.isDirect) {
    throw new ClaimValidationError(`${draft.fieldKey}: inferred claims cannot be direct`);
  }
  if (evidence.extractionMethod === "llm" && !evidence.quote) {
    throw new ClaimValidationError(`${draft.fieldKey}: LLM-extracted claims require a verbatim quote`);
  }

  const observedAt = evidence.observedAt;
  const revivable = `%(not reproduced by ${evidence.extractorName.replace(/[%_]/g, "")}@%`;
  const [row] = await db
    .insert(claim)
    .values({
      subjectType: isCycle ? "recruiting_cycle" : "club",
      clubId: draft.clubId,
      recruitingCycleId: draft.recruitingCycleId ?? null,
      fieldKey: draft.fieldKey,
      value: parsed.value,
      normalizedValue: parsed.normalized ?? null,
      valueHash: hashValue(parsed.normalized),
      assertionKind: draft.assertionKind,
      termKey: draft.termKey ?? null,
      validFrom: draft.validFrom ?? null,
      validUntil: draft.validUntil ?? null,
      asOfDate: draft.asOfDate ?? null,
      firstObservedAt: observedAt,
      lastObservedAt: observedAt,
    })
    .onConflictDoUpdate({
      target: [
        claim.subjectType,
        claim.clubId,
        claim.recruitingCycleId,
        claim.fieldKey,
        claim.valueHash,
        claim.termKey,
        claim.assertionKind,
      ],
      set: {
        firstObservedAt: sql`least(${claim.firstObservedAt}, excluded.first_observed_at)`,
        lastObservedAt: sql`greatest(${claim.lastObservedAt}, excluded.last_observed_at)`,
        updatedAt: new Date(),
        // A claim rejected only because an extractor version stopped producing it comes back
        // when a later version of that extractor produces it again: the rejection's premise is
        // gone. Editorial and audit rejections always stick.
        status: sql`case when ${claim.status} = 'rejected' and ${claim.statusReason} like ${revivable} then 'active'::claim_status else ${claim.status} end`,
        statusReason: sql`case when ${claim.status} = 'rejected' and ${claim.statusReason} like ${revivable} then null else ${claim.statusReason} end`,
      },
    })
    .returning({ id: claim.id, created: sql<boolean>`(xmax = 0)` });
  if (!row) throw new Error("failed to upsert claim");

  const confidence =
    evidence.confidence ??
    computeConfidence({
      sourceType: evidence.sourceType,
      ...(evidence.trustTier !== undefined ? { trustTier: evidence.trustTier } : {}),
      extractionMethod: evidence.extractionMethod,
      isDirect: evidence.isDirect,
    });

  const inserted = await db
    .insert(claimEvidence)
    .values({
      claimId: row.id,
      sourceId: evidence.sourceId,
      snapshotId: evidence.snapshotId,
      submissionId: evidence.submissionId ?? null,
      ingestionRunId: evidence.ingestionRunId,
      observedAt,
      evidenceQuote: evidence.quote ?? null,
      evidenceLocator: evidence.locator ?? null,
      extractionMethod: evidence.extractionMethod,
      extractorName: evidence.extractorName,
      extractorVersion: evidence.extractorVersion,
      llmModel: evidence.llmModel ?? null,
      promptVersion: evidence.promptVersion ?? null,
      confidence,
      isDirect: evidence.isDirect,
    })
    .onConflictDoUpdate({
      target: [
        claimEvidence.claimId,
        claimEvidence.sourceId,
        claimEvidence.snapshotId,
        claimEvidence.extractorName,
        claimEvidence.extractorVersion,
      ],
      // Re-fetching identical content is a re-observation: refresh freshness, nothing else.
      set: { observedAt: sql`greatest(${claimEvidence.observedAt}, excluded.observed_at)` },
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` });

  return { claimId: row.id, claimCreated: row.created === true, evidenceCreated: inserted[0]?.inserted === true };
}
