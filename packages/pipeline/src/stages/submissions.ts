import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  computeConfidence,
  contributionTypeOf,
  getField,
  isFieldKey,
  newYorkWallTimeToUtc,
  normalizeName,
  parseFieldValue,
  parseProposals,
  redactContactDetails,
  stableStringify,
  type ClaimInput,
  type ContributionType,
  type FieldKey,
  type ResolvedValue,
  type SourceType,
} from "@hci/core";
import {
  editDistance,
  ensureRecruitingCycle,
  previewFieldResolution,
  resolveClubs,
  schema,
  upsertClaim,
  upsertSource,
  type Db,
  type Queryable,
} from "@hci/db";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";
import { SUBMISSION_EVIDENCE_EXTRACTOR, checkSubmissionEvidence, type EvidenceCheck } from "./submission-evidence";

/**
 * Community submissions (CLAUDE.md §14, ADRs 0027 and 0035). The site's prefilled Google
 * Form collects responses; their CSV export is imported here. Each response becomes a
 * `pending` student_submission (raw answers kept, contact details removed) plus one
 * `submission_proposal` per answered template line. Nothing changes the data until an
 * editor accepts a proposal: then it becomes a tier-9 `user_reported` claim evidenced by
 * the submission, plus, when the submitter's source link states the value, a second claim
 * from that page at its own tier. Every decision is logged in editorial_decision.
 */

export const SUBMISSION_SOURCE_URL = "https://hclubs.app/about#contribute";
export const SUBMISSIONS_EXTRACTOR = { name: "submissions", version: "2" } as const;

/** RFC 4180-ish CSV parser (quoted fields, doubled quotes, CRLF, newlines in quotes). PURE. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

/** Columns we read, matched case-insensitively by substring of the form question. */
const COLUMN_HINTS: Record<"timestamp" | "club" | "kind" | "details" | "source", RegExp> = {
  timestamp: /^timestamp$|submitted at/i,
  club: /\bclub\b|organi[sz]ation/i,
  kind: /what (kind|type)|update type|topic/i,
  details: /details|what do you know|what should change|message|tell us/i,
  source: /source|link|evidence|url/i,
};
/** Columns never read or stored: who the submitter is. */
const PERSONAL = /e-?mail|name|phone|netid|huid|class year|year of graduation/i;
const SITE_FEEDBACK = /feedback about the site/i;

export interface ImportedRow {
  importKey: string;
  submittedAt: string | null;
  clubText: string;
  formAnswer: string;
  details: string;
  source: string | null;
  /** Every non-personal answer by question, contact details removed. */
  raw: Record<string, string>;
  redactions: number;
}

/** Map a responses CSV to submission rows; personal columns are dropped. PURE. */
export function rowsFromResponses(csv: string): {
  rows: ImportedRow[];
  dropped: string[];
  siteFeedback: number;
} {
  const [header, ...body] = parseCsv(csv);
  if (!header) return { rows: [], dropped: [], siteFeedback: 0 };
  const personal = (h: string) => PERSONAL.test(h) && !COLUMN_HINTS.club.test(h);
  const col = (key: keyof typeof COLUMN_HINTS) =>
    header.findIndex((h) => COLUMN_HINTS[key].test(h) && !(key !== "club" && personal(h)));
  const idx = {
    timestamp: col("timestamp"),
    club: col("club"),
    kind: col("kind"),
    details: col("details"),
    source: col("source"),
  };
  const dropped = header.filter(personal);
  const rows: ImportedRow[] = [];
  let siteFeedback = 0;
  for (const r of body) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const formAnswer = get(idx.kind);
    if (SITE_FEEDBACK.test(formAnswer)) {
      siteFeedback++;
      continue;
    }
    let redactions = 0;
    const clean = (s: string) => {
      const out = redactContactDetails(s);
      redactions += out.removed;
      return out.text;
    };
    const details = clean(get(idx.details));
    const clubText = clean(get(idx.club));
    if (!details) continue;
    const source = get(idx.source);
    const submittedAt = get(idx.timestamp) || null;
    const raw: Record<string, string> = {};
    header.forEach((h, i) => {
      if (personal(h) || !get(i)) return;
      raw[h] = i === idx.details ? details : i === idx.club ? clubText : clean(get(i));
    });
    rows.push({
      importKey: createHash("sha256")
        .update(JSON.stringify([submittedAt, get(idx.club), get(idx.details)]))
        .digest("hex")
        .slice(0, 32),
      submittedAt,
      clubText,
      formAnswer: formAnswer || "Other",
      details: details.slice(0, 4000),
      source: /^https?:\/\//i.test(source) ? source.slice(0, 500) : null,
      raw,
      redactions,
    });
  }
  return { rows, dropped, siteFeedback };
}

/**
 * A Google Forms timestamp ("9/30/2026 10:00:00", the form's campus time zone) or an ISO
 * string, as an instant; null when unreadable. PURE.
 */
export function parseFormTimestamp(text: string | null): Date | null {
  if (!text) return null;
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m)
    return newYorkWallTimeToUtc(
      Number(m[3]),
      Number(m[1]),
      Number(m[2]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] ?? 0),
    );
  const t = Date.parse(text);
  return Number.isFinite(t) ? new Date(t) : null;
}

// --- Club matching -------------------------------------------------------------------------------

interface ClubDirectory {
  bySlug: Map<string, string>;
  byName: Map<string, string>;
  slugs: string[];
}

async function loadDirectory(db: Queryable): Promise<ClubDirectory> {
  const rows = await db
    .select({
      id: schema.club.id,
      slug: schema.club.slug,
      name: schema.club.canonicalName,
      state: schema.club.recordState,
      into: schema.club.mergedIntoClubId,
    })
    .from(schema.club);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Follow merges to the surviving club; hidden clubs don't take submissions.
  const live = (id: string): string | null => {
    for (let r = byId.get(id), hops = 0; r && hops < 10; r = r.into ? byId.get(r.into) : undefined, hops++)
      if (r.state === "active") return r.id;
    return null;
  };
  const bySlug = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const r of rows) {
    const id = live(r.id);
    if (!id) continue;
    bySlug.set(r.slug, id);
    byName.set(normalizeName(r.name), id);
  }
  for (const h of await db.select().from(schema.clubSlugHistory)) {
    const id = live(h.clubId);
    if (id && !bySlug.has(h.slug)) bySlug.set(h.slug, id);
  }
  const aliases = await db
    .select({ clubId: schema.clubAlias.clubId, alias: schema.clubAlias.normalizedAlias })
    .from(schema.clubAlias);
  const aliasHits = new Map<string, Set<string>>();
  for (const a of aliases) {
    const id = live(a.clubId);
    if (id) aliasHits.set(a.alias, (aliasHits.get(a.alias) ?? new Set()).add(id));
  }
  // An alias counts only when it names exactly one club.
  for (const [alias, ids] of aliasHits) if (ids.size === 1 && !byName.has(alias)) byName.set(alias, [...ids][0]!);
  return { bySlug, byName, slugs: rows.filter((r) => r.state === "active").map((r) => r.slug) };
}

export interface ClubMatch {
  clubId: string | null;
  how: "slug" | "name" | null;
  /** A close slug to offer when nothing matched ("did you mean"). */
  suggestion: string | null;
}

/** "Name [slug]", a bare slug, a profile link, or a club's name or alias. PURE given the directory. */
export function matchClubText(text: string, dir: ClubDirectory): ClubMatch {
  const t = text.trim();
  const slug =
    t.match(/\[([a-z0-9-]+)\]\s*$/)?.[1] ??
    t.match(/\/clubs\/([a-z0-9-]+)/)?.[1] ??
    (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t) ? t : null);
  if (slug && dir.bySlug.has(slug)) return { clubId: dir.bySlug.get(slug)!, how: "slug", suggestion: null };
  const name = normalizeName(t.replace(/\s*\[[^\]]*\]\s*$/, ""));
  if (name && dir.byName.has(name)) return { clubId: dir.byName.get(name)!, how: "name", suggestion: null };
  let suggestion: string | null = null;
  if (slug) {
    let best = 4;
    for (const s of dir.slugs) {
      const d = editDistance(slug, s, 3);
      if (d < best) {
        best = d;
        suggestion = s;
      }
    }
  }
  return { clubId: null, how: null, suggestion };
}

// --- Import ----------------------------------------------------------------------------------------

export interface ImportResult {
  imported: number;
  duplicates: number;
  nearDuplicates: number;
  proposals: number;
  unmatched: { text: string; suggestion: string | null }[];
  droppedColumns: string[];
  siteFeedback: number;
  redactions: number;
}

export async function importSubmissions(
  db: Db,
  csv: string,
  opts: { dryRun?: boolean; now: Date },
): Promise<ImportResult> {
  const { rows, dropped, siteFeedback } = rowsFromResponses(csv);
  const dir = await loadDirectory(db);
  const out: ImportResult = {
    imported: 0,
    duplicates: 0,
    nearDuplicates: 0,
    proposals: 0,
    unmatched: [],
    droppedColumns: dropped,
    siteFeedback,
    redactions: 0,
  };
  for (const row of rows) {
    const [exists] = await db
      .select({ id: schema.studentSubmission.id })
      .from(schema.studentSubmission)
      .where(sql`${schema.studentSubmission.payload}->>'importKey' = ${row.importKey}`);
    if (exists) {
      out.duplicates++;
      continue;
    }
    const match = matchClubText(row.clubText, dir);
    if (!match.clubId) out.unmatched.push({ text: row.clubText || "(blank)", suggestion: match.suggestion });
    const submittedAt = parseFormTimestamp(row.submittedAt) ?? opts.now;
    const type: ContributionType = contributionTypeOf(row.formAnswer, row.details);
    const proposals = parseProposals(row.details, { submittedAt });
    // The same text about the same club, sent again: kept, but flagged for the reviewer.
    const [twin] = match.clubId
      ? await db
          .select({ id: schema.studentSubmission.id })
          .from(schema.studentSubmission)
          .where(
            and(
              eq(schema.studentSubmission.clubId, match.clubId),
              sql`lower(regexp_replace(${schema.studentSubmission.payload}->>'message', '\\s+', ' ', 'g')) = ${row.details
                .replace(/\s+/g, " ")
                .toLowerCase()}`,
            ),
          )
          .limit(1)
      : [];
    if (twin) out.nearDuplicates++;
    out.imported++;
    out.proposals += proposals.length;
    out.redactions += row.redactions;
    if (opts.dryRun) continue;
    const [sub] = await db
      .insert(schema.studentSubmission)
      .values({
        kind: type,
        clubId: match.clubId,
        payload: {
          importKey: row.importKey,
          submittedAt: submittedAt.toISOString(),
          clubText: row.clubText,
          formAnswer: row.formAnswer,
          message: row.details,
          raw: row.raw,
          ...(row.redactions ? { redactions: row.redactions } : {}),
          ...(match.how ? { matchedBy: match.how } : {}),
          ...(twin ? { duplicateOf: twin.id } : {}),
        },
        evidenceUrl: row.source,
        submitterRef: null,
        status: "pending",
        createdAt: opts.now,
      })
      .returning({ id: schema.studentSubmission.id });
    if (!sub) throw new Error("submission insert returned no row");
    for (const [i, p] of proposals.entries())
      await db.insert(schema.submissionProposal).values({
        submissionId: sub.id,
        position: i + 1,
        fieldKey: p.fieldKey,
        label: p.label,
        rawText: p.raw.slice(0, 2000),
        value: p.value ?? null,
        termKey: p.termKey ?? null,
        parseNote: p.note ?? null,
        origin: "form",
        createdAt: opts.now,
      });
  }
  return out;
}

// --- Review ----------------------------------------------------------------------------------------

type SubmissionRow = typeof schema.studentSubmission.$inferSelect;
type ProposalRow = typeof schema.submissionProposal.$inferSelect;

export class SubmissionReviewError extends Error {}

/** Accepting would replace a value shown from a real source; the editor must decide. */
export class SubmissionConflictError extends SubmissionReviewError {
  constructor(
    message: string,
    readonly current: { value: unknown; sourceType: string | null; tier: number },
  ) {
    super(message);
  }
}

async function loadSubmission(db: Queryable, id: string): Promise<SubmissionRow> {
  const rows = await db
    .select()
    .from(schema.studentSubmission)
    .where(
      id.length === 36
        ? eq(schema.studentSubmission.id, id)
        : // Short ids are the random tail: UUIDv7s made in the same millisecond share their head.
          sql`${schema.studentSubmission.id}::text like ${`%${id.toLowerCase()}`}`,
    );
  if (rows.length > 1)
    throw new SubmissionReviewError(`"${id}" matches ${rows.length} submissions; use more of the id`);
  const sub = rows[0];
  if (!sub) throw new SubmissionReviewError(`no submission ${id}`);
  return sub;
}

export async function proposalsOf(db: Queryable, submissionId: string): Promise<ProposalRow[]> {
  return db
    .select()
    .from(schema.submissionProposal)
    .where(eq(schema.submissionProposal.submissionId, submissionId))
    .orderBy(asc(schema.submissionProposal.position));
}

/** The short id the CLI prints and accepts. */
export const shortId = (id: string) => id.slice(-8);

/** A proposal by 1-based number ("2") or field key; null when the field has none. */
function pickProposal(all: ProposalRow[], selector: string): ProposalRow | null {
  if (/^\d+$/.test(selector)) {
    const p = all.find((x) => x.position === Number(selector));
    if (!p) throw new SubmissionReviewError(`no proposal #${selector}`);
    return p;
  }
  const open = all.filter((p) => p.fieldKey === selector && p.status === "pending");
  if (open.length > 1)
    throw new SubmissionReviewError(
      `${open.length} pending ${selector} proposals; pick one by number (${open.map((p) => p.position).join(", ")})`,
    );
  return open[0] ?? null;
}

async function logDecision(
  db: Queryable,
  input: {
    actor: string;
    action: string;
    targetType: string;
    targetId: string;
    reason: string | null;
    payload: object;
    now: Date;
  },
) {
  await db.insert(schema.editorialDecision).values({ ...input, createdAt: input.now });
}

/** Recompute a submission's status from its proposals once none is pending. */
async function settle(db: Queryable, sub: SubmissionRow, actor: string, now: Date): Promise<string> {
  const ps = await proposalsOf(db, sub.id);
  if (!ps.length || ps.some((p) => p.status === "pending")) return sub.status;
  const accepted = ps.filter((p) => p.status === "accepted").length;
  const status = accepted === ps.length ? "accepted" : accepted ? "partially_accepted" : ("rejected" as const);
  const claimIds = [...new Set(ps.flatMap((p) => p.resultingClaimIds))];
  if (status === sub.status && claimIds.length === sub.resultingClaimIds.length) return status;
  await db
    .update(schema.studentSubmission)
    .set({ status, reviewedAt: now, resultingClaimIds: claimIds })
    .where(eq(schema.studentSubmission.id, sub.id));
  await logDecision(db, {
    actor,
    action: `submission_${status}`,
    targetType: "student_submission",
    targetId: sub.id,
    reason: null,
    payload: { proposals: ps.length, accepted, claimIds },
    now,
  });
  return status;
}

const valueKey = (v: ResolvedValue | null | undefined) => (v ? stableStringify(v.value) : null);

export interface AcceptResult {
  proposalId: string;
  fieldKey: string;
  claimIds: string[];
  /** What the profile shows for this field now. */
  outcome: "shown" | "added" | "kept_competing" | "merge_proposed" | "merge_exists";
  current: { value: unknown; sourceType: string | null; tier: number } | null;
  evidence: EvidenceCheck | null;
  submissionStatus: string;
}

/**
 * Accept one proposal (or, with `value`, the editor's own value for a field the response
 * mentions). Writes a community claim; checks the source link when one was given; refuses
 * to let a community value replace a sourced one unless `override` is set.
 */
export async function acceptProposal(
  db: Db,
  input: {
    submissionId: string;
    selector: string;
    value?: unknown;
    termKey?: string;
    override?: boolean;
    reason?: string;
    actor: string;
    now: Date;
    fetcher?: SourceFetcher;
    store?: SnapshotStore;
  },
): Promise<AcceptResult> {
  const sub = await loadSubmission(db, input.submissionId);
  if (sub.status === "rejected" || sub.status === "spam")
    throw new SubmissionReviewError(`submission is ${sub.status}; nothing to accept`);
  if (!sub.clubId) throw new SubmissionReviewError("submission isn't matched to a club; run `submissions match` first");
  const clubId = sub.clubId;
  const all = await proposalsOf(db, sub.id);
  let proposal = pickProposal(all, input.selector);
  if (proposal && proposal.status !== "pending")
    throw new SubmissionReviewError(`proposal #${proposal.position} is already ${proposal.status}`);
  if (!proposal) {
    if (input.value === undefined)
      throw new SubmissionReviewError(
        `no pending ${input.selector} proposal; give --value to add the editor's reading`,
      );
    if (input.selector !== "duplicate_of" && !isFieldKey(input.selector))
      throw new SubmissionReviewError(`unknown field ${input.selector}`);
    const [row] = await db
      .insert(schema.submissionProposal)
      .values({
        submissionId: sub.id,
        position: all.length + 1,
        fieldKey: input.selector,
        label: "editor",
        rawText: typeof input.value === "string" ? input.value : JSON.stringify(input.value),
        value: input.value,
        termKey: input.termKey ?? null,
        origin: "editor",
        createdAt: input.now,
      })
      .returning();
    if (!row) throw new Error("proposal insert returned no row");
    proposal = row;
  }
  const value = input.value ?? proposal.value;
  if (value === null || value === undefined)
    throw new SubmissionReviewError(
      `${proposal.fieldKey} couldn't be read (${proposal.parseNote ?? "no value"}); give --value`,
    );
  const payload = sub.payload as { submittedAt?: string };
  const submittedAt = payload.submittedAt ? new Date(payload.submittedAt) : sub.createdAt;

  // "Listed twice": propose a merge for review; never merge from a submission.
  if (proposal.fieldKey === "duplicate_of") {
    const dir = await loadDirectory(db);
    const target = matchClubText(String(value), dir);
    if (!target.clubId || target.clubId === clubId)
      throw new SubmissionReviewError(
        `"${String(value)}" isn't another club${target.suggestion ? ` (did you mean ${target.suggestion}?)` : ""}`,
      );
    const [a, b] = [clubId, target.clubId].sort() as [string, string];
    const inserted = await db
      .insert(schema.mergeCandidate)
      .values({
        clubAId: a,
        clubBId: b,
        score: 0,
        signals: [{ kind: "student_report", submissionId: sub.id }],
        reason: "likely_duplicate",
        explanation: "A student reported these as the same club.",
        matcherVersion: "submission-report-1",
      })
      .onConflictDoNothing()
      .returning({ id: schema.mergeCandidate.id });
    await finishProposal(db, proposal, {
      status: "accepted",
      claimIds: [],
      evidence: null,
      actor: input.actor,
      reason: input.reason ?? null,
      now: input.now,
      extra: { mergeCandidateId: inserted[0]?.id ?? null },
    });
    return {
      proposalId: proposal.id,
      fieldKey: proposal.fieldKey,
      claimIds: [],
      outcome: inserted[0] ? "merge_proposed" : "merge_exists",
      current: null,
      evidence: null,
      submissionStatus: await settle(db, await loadSubmission(db, sub.id), input.actor, input.now),
    };
  }

  const fieldKey = proposal.fieldKey as FieldKey;
  const parsed = parseFieldValue(fieldKey, value);
  if (!parsed.ok) throw new SubmissionReviewError(`${fieldKey}: ${parsed.error}`);
  const field = getField(fieldKey);
  const termKey = input.termKey ?? proposal.termKey ?? null;
  if (field.subjectType === "recruiting_cycle" && !termKey)
    throw new SubmissionReviewError(`${fieldKey} needs a term; pass --term=2026-fall`);

  // 1. The source link, when the submitter gave one and it's fetchable.
  let evidence: EvidenceCheck | null = null;
  if (sub.evidenceUrl && input.fetcher && input.store)
    evidence = await checkSubmissionEvidence(db, {
      url: sub.evidenceUrl,
      clubId,
      fieldKey,
      value: parsed.value,
      fetcher: input.fetcher,
      store: input.store,
    });

  // 2. Would the community value replace one shown from a real source?
  const [cycle] =
    field.subjectType === "recruiting_cycle" && termKey
      ? await db
          .select({ id: schema.recruitingCycle.id })
          .from(schema.recruitingCycle)
          .where(
            and(
              eq(schema.recruitingCycle.clubId, clubId),
              eq(schema.recruitingCycle.termKey, termKey),
              eq(schema.recruitingCycle.track, "main"),
            ),
          )
      : [];
  const communityConfidence = computeConfidence({
    sourceType: "student_submission",
    extractionMethod: "user_submission",
    isDirect: true,
  });
  const hypothetical: ClaimInput = {
    id: "~submission-preview",
    fieldKey,
    value: parsed.value,
    normalizedValue: parsed.normalized,
    assertionKind: "user_reported",
    status: "active",
    termKey,
    validFrom: null,
    validUntil: null,
    asOfDate: null,
    evidence: [
      {
        sourceId: "~submission",
        sourceType: "student_submission",
        trustTier: 9,
        sourceUrl: SUBMISSION_SOURCE_URL,
        sourceTitle: null,
        isFixture: false,
        extractionMethod: "user_submission",
        isDirect: true,
        confidence: communityConfidence,
        observedAt: submittedAt,
        quote: null,
      },
    ],
  };
  const preview = await previewFieldResolution(db, {
    clubId,
    fieldKey,
    cycleId: cycle?.id ?? null,
    extra: hypothetical,
    now: input.now,
  });
  const before = preview.before.current;
  const describe = (v: ResolvedValue | null) =>
    v ? { value: v.value, sourceType: v.sources[0]?.sourceType ?? null, tier: v.bestTier } : null;
  const displaces =
    field.cardinality === "single" &&
    before !== null &&
    before.bestTier < 9 &&
    preview.after.current?.claimId === hypothetical.id &&
    valueKey(before) !== stableStringify(parsed.value);
  // A value the source link itself states competes on that page's merits, not as a report.
  if (displaces && !input.override && evidence?.status !== "corroborated")
    throw new SubmissionConflictError(
      `${fieldKey}: accepting would replace ${JSON.stringify(before.value)} (${before.sources[0]?.sourceType ?? "source"}, tier ${before.bestTier}) with a student report. Re-run with --override if you're sure, or reject the field.`,
      describe(before)!,
    );

  // 3. Write: the community claim, always evidenced by the submission itself.
  const cycleId =
    field.subjectType === "recruiting_cycle" && termKey ? await ensureRecruitingCycle(db, { clubId, termKey }) : null;
  const submissionSource = await upsertSource(db, {
    url: SUBMISSION_SOURCE_URL,
    sourceType: "student_submission",
    title: "Community submission",
    adapter: "submissions",
  });
  const draft = {
    clubId,
    fieldKey,
    value: parsed.value,
    ...(cycleId ? { recruitingCycleId: cycleId } : {}),
    ...(termKey && cycleId ? { termKey } : {}),
  };
  const community = await upsertClaim(
    db,
    { ...draft, assertionKind: "user_reported" },
    {
      sourceId: submissionSource,
      sourceType: "student_submission",
      snapshotId: null,
      submissionId: sub.id,
      ingestionRunId: null,
      observedAt: submittedAt,
      quote: proposal.rawText.slice(0, 500) || null,
      locator: { submission: sub.id, proposal: proposal.id, label: proposal.label },
      extractionMethod: "user_submission",
      extractorName: SUBMISSIONS_EXTRACTOR.name,
      extractorVersion: SUBMISSIONS_EXTRACTOR.version,
      isDirect: true,
    },
  );
  const claimIds = [community.claimId];
  // …and, when the page states it, a claim from that page at the page's own tier.
  if (evidence?.status === "corroborated" && evidence.sourceId && evidence.snapshotId && evidence.sourceType) {
    const sourced = await upsertClaim(
      db,
      { ...draft, assertionKind: "stated" },
      {
        sourceId: evidence.sourceId,
        sourceType: evidence.sourceType,
        snapshotId: evidence.snapshotId,
        ingestionRunId: null,
        observedAt: new Date(evidence.observedAt ?? input.now),
        quote: evidence.quote ?? null,
        locator: { submission: sub.id, proposal: proposal.id, signal: "value found on the submitter's source page" },
        extractionMethod: "manual",
        extractorName: SUBMISSION_EVIDENCE_EXTRACTOR.name,
        extractorVersion: SUBMISSION_EVIDENCE_EXTRACTOR.version,
        isDirect: true,
        confidence: computeConfidence({
          sourceType: evidence.sourceType as SourceType,
          ...(evidence.tier ? { trustTier: evidence.tier } : {}),
          extractionMethod: "manual",
          isDirect: true,
        }),
      },
    );
    claimIds.push(sourced.claimId);
  }
  await finishProposal(db, proposal, {
    status: "accepted",
    claimIds,
    evidence,
    actor: input.actor,
    reason: input.reason ?? null,
    now: input.now,
    extra: {
      ...(input.value !== undefined && input.value !== proposal.value ? { editorValue: parsed.value } : {}),
      ...(displaces ? { override: true, replaced: describe(before) } : {}),
    },
    value: parsed.value,
    termKey,
  });
  await resolveClubs(db, { clubIds: [clubId], now: input.now });
  const outcome: AcceptResult["outcome"] =
    field.cardinality !== "single"
      ? "added"
      : displaces || !before || valueKey(before) === stableStringify(parsed.value)
        ? "shown"
        : "kept_competing";
  return {
    proposalId: proposal.id,
    fieldKey,
    claimIds,
    outcome,
    current: describe(before),
    evidence,
    submissionStatus: await settle(db, await loadSubmission(db, sub.id), input.actor, input.now),
  };
}

async function finishProposal(
  db: Queryable,
  p: ProposalRow,
  d: {
    status: "accepted" | "rejected";
    claimIds: string[];
    evidence: EvidenceCheck | null;
    actor: string;
    reason: string | null;
    now: Date;
    extra?: object;
    value?: unknown;
    termKey?: string | null;
  },
) {
  await db
    .update(schema.submissionProposal)
    .set({
      status: d.status,
      decisionReason: d.reason,
      decidedBy: d.actor,
      decidedAt: d.now,
      resultingClaimIds: d.claimIds,
      evidenceCheck: d.evidence,
      ...(d.value !== undefined ? { value: d.value } : {}),
      ...(d.termKey !== undefined ? { termKey: d.termKey } : {}),
    })
    .where(and(eq(schema.submissionProposal.id, p.id), eq(schema.submissionProposal.status, "pending")));
  await logDecision(db, {
    actor: d.actor,
    action: `submission_field_${d.status}`,
    targetType: "submission_proposal",
    targetId: p.id,
    reason: d.reason,
    payload: {
      submissionId: p.submissionId,
      fieldKey: p.fieldKey,
      value: d.value ?? p.value,
      claimIds: d.claimIds,
      ...(d.evidence ? { evidence: { url: d.evidence.url, status: d.evidence.status } } : {}),
      ...d.extra,
    },
    now: d.now,
  });
}

/** Reject one proposal with a reason; the submission's other proposals are untouched. */
export async function rejectProposal(
  db: Db,
  input: { submissionId: string; selector: string; reason: string; actor: string; now: Date },
): Promise<{ proposalId: string; submissionStatus: string }> {
  if (!input.reason.trim()) throw new SubmissionReviewError("a rejection needs --reason");
  const sub = await loadSubmission(db, input.submissionId);
  const all = await proposalsOf(db, sub.id);
  const p = pickProposal(all, input.selector);
  if (!p) throw new SubmissionReviewError(`no pending ${input.selector} proposal`);
  if (p.status !== "pending") throw new SubmissionReviewError(`proposal is already ${p.status}`);
  await finishProposal(db, p, {
    status: "rejected",
    claimIds: [],
    evidence: null,
    actor: input.actor,
    reason: input.reason,
    now: input.now,
  });
  return {
    proposalId: p.id,
    submissionStatus: await settle(db, await loadSubmission(db, sub.id), input.actor, input.now),
  };
}

/**
 * Reject a whole submission (or mark it spam): every pending proposal is rejected with the
 * same reason. Nothing is deleted; accepted proposals and their claims stay.
 */
export async function rejectSubmission(
  db: Db,
  input: { submissionId: string; reason: string; spam?: boolean; actor: string; now: Date },
): Promise<{ status: string; proposalsRejected: number }> {
  if (!input.reason.trim()) throw new SubmissionReviewError("a rejection needs --reason");
  const sub = await loadSubmission(db, input.submissionId);
  const pending = (await proposalsOf(db, sub.id)).filter((p) => p.status === "pending");
  for (const p of pending)
    await finishProposal(db, p, {
      status: "rejected",
      claimIds: [],
      evidence: null,
      actor: input.actor,
      reason: input.reason,
      now: input.now,
    });
  const anyAccepted = (await proposalsOf(db, sub.id)).some((p) => p.status === "accepted");
  const status = input.spam ? "spam" : anyAccepted ? "partially_accepted" : "rejected";
  await db
    .update(schema.studentSubmission)
    .set({ status, reviewNote: input.reason, reviewedAt: input.now })
    .where(eq(schema.studentSubmission.id, sub.id));
  await logDecision(db, {
    actor: input.actor,
    action: `submission_${status}`,
    targetType: "student_submission",
    targetId: sub.id,
    reason: input.reason,
    payload: { proposalsRejected: pending.length },
    now: input.now,
  });
  return { status, proposalsRejected: pending.length };
}

/** Point an unmatched (or mismatched) submission at a club, by slug. Audited. */
export async function matchSubmission(
  db: Db,
  input: { submissionId: string; slug: string; actor: string; now: Date },
): Promise<{ clubId: string }> {
  const sub = await loadSubmission(db, input.submissionId);
  const m = matchClubText(input.slug, await loadDirectory(db));
  if (!m.clubId)
    throw new SubmissionReviewError(`no club ${input.slug}${m.suggestion ? ` (did you mean ${m.suggestion}?)` : ""}`);
  await db.update(schema.studentSubmission).set({ clubId: m.clubId }).where(eq(schema.studentSubmission.id, sub.id));
  await logDecision(db, {
    actor: input.actor,
    action: "submission_matched",
    targetType: "student_submission",
    targetId: sub.id,
    reason: null,
    payload: { from: sub.clubId, to: m.clubId, slug: input.slug },
    now: input.now,
  });
  return { clubId: m.clubId };
}

// --- Reading ---------------------------------------------------------------------------------------

export interface SubmissionView {
  submission: SubmissionRow;
  club: { slug: string; name: string } | null;
  proposals: (ProposalRow & {
    number: number;
    /** What the profile shows for the field now, and from where. */
    current: { value: unknown; sourceType: string | null; tier: number; community: boolean } | null;
  })[];
}

export async function showSubmission(db: Queryable, id: string): Promise<SubmissionView> {
  const sub = await loadSubmission(db, id);
  const [club] = sub.clubId
    ? await db
        .select({ slug: schema.club.slug, name: schema.club.canonicalName, fields: schema.club.fields })
        .from(schema.club)
        .where(eq(schema.club.id, sub.clubId))
    : [];
  const fields = (club?.fields ?? {}) as Record<
    string,
    { kind: string; current?: ResolvedValue; values?: ResolvedValue[] }
  >;
  const proposals = (await proposalsOf(db, sub.id)).map((p) => {
    const f = fields[p.fieldKey];
    const cur = f?.kind === "single" ? f.current : undefined;
    return {
      ...p,
      number: p.position,
      current: cur
        ? {
            value: cur.value,
            sourceType: cur.sources[0]?.sourceType ?? null,
            tier: cur.bestTier,
            community: cur.assertionKind === "user_reported",
          }
        : null,
    };
  });
  return { submission: sub, club: club ? { slug: club.slug, name: club.name } : null, proposals };
}

export async function listSubmissions(
  db: Queryable,
  opts: { status?: SubmissionRow["status"] | "all"; limit?: number } = {},
) {
  const status = opts.status ?? "pending";
  const rows = await db
    .select({
      id: schema.studentSubmission.id,
      kind: schema.studentSubmission.kind,
      status: schema.studentSubmission.status,
      payload: schema.studentSubmission.payload,
      evidenceUrl: schema.studentSubmission.evidenceUrl,
      createdAt: schema.studentSubmission.createdAt,
      clubSlug: schema.club.slug,
    })
    .from(schema.studentSubmission)
    .leftJoin(schema.club, eq(schema.club.id, schema.studentSubmission.clubId))
    .where(status === "all" ? undefined : eq(schema.studentSubmission.status, status))
    .orderBy(asc(schema.studentSubmission.createdAt))
    .limit(opts.limit ?? 500);
  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db
        .select({
          submissionId: schema.submissionProposal.submissionId,
          status: schema.submissionProposal.status,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.submissionProposal)
        .where(inArray(schema.submissionProposal.submissionId, ids))
        .groupBy(schema.submissionProposal.submissionId, schema.submissionProposal.status)
    : [];
  return rows.map((r) => ({
    ...r,
    proposals: Object.fromEntries(counts.filter((c) => c.submissionId === r.id).map((c) => [c.status, c.n])) as Partial<
      Record<"pending" | "accepted" | "rejected", number>
    >,
  }));
}

export interface SubmissionStats {
  submissions: Record<string, number>;
  proposals: Record<string, number>;
  fieldsAccepted: Record<string, number>;
  clubsImproved: number;
  corroboratedBySource: number;
  unmatched: number;
  communityClaimsShown: number;
}

/** Counts for `submissions stats` (ADR 0035). */
export async function submissionStats(db: Queryable): Promise<SubmissionStats> {
  const subs = await db
    .select({ status: schema.studentSubmission.status, n: sql<number>`count(*)::int` })
    .from(schema.studentSubmission)
    .groupBy(schema.studentSubmission.status);
  const props = await db
    .select({ status: schema.submissionProposal.status, n: sql<number>`count(*)::int` })
    .from(schema.submissionProposal)
    .groupBy(schema.submissionProposal.status);
  const fields = await db
    .select({ field: schema.submissionProposal.fieldKey, n: sql<number>`count(*)::int` })
    .from(schema.submissionProposal)
    .where(eq(schema.submissionProposal.status, "accepted"))
    .groupBy(schema.submissionProposal.fieldKey);
  const [improved] = await db
    .select({ n: sql<number>`count(distinct ${schema.studentSubmission.clubId})::int` })
    .from(schema.studentSubmission)
    .innerJoin(schema.submissionProposal, eq(schema.submissionProposal.submissionId, schema.studentSubmission.id))
    .where(eq(schema.submissionProposal.status, "accepted"));
  const [corroborated] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.submissionProposal)
    .where(sql`${schema.submissionProposal.evidenceCheck}->>'status' = 'corroborated'`);
  const [unmatched] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.studentSubmission)
    .where(and(sql`${schema.studentSubmission.clubId} is null`, eq(schema.studentSubmission.status, "pending")));
  // Profiles whose displayed value for some field is a community claim right now.
  const [shown] = await db.select({ n: sql<number>`count(*)::int` }).from(sql`(
      select 1 from ${schema.club}, jsonb_each(${schema.club.fields}) f
      where ${schema.club.recordState} = 'active' and f.value->'current'->>'assertionKind' = 'user_reported'
    ) x`);
  return {
    submissions: Object.fromEntries(subs.map((s) => [s.status, s.n])),
    proposals: Object.fromEntries(props.map((s) => [s.status, s.n])),
    fieldsAccepted: Object.fromEntries(fields.map((f) => [f.field, f.n])),
    clubsImproved: improved?.n ?? 0,
    corroboratedBySource: corroborated?.n ?? 0,
    unmatched: unmatched?.n ?? 0,
    communityClaimsShown: shown?.n ?? 0,
  };
}
