import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { normalizeName, type FieldKey } from "@hci/core";
import { resolveClubs, reviewSubmission, schema, upsertClaim, upsertSource, type Db } from "@hci/db";

/**
 * Community submissions from the static site's "Share what you know" / "Run this club?"
 * forms (ADR 0027, CLAUDE.md §14). The forms are external (e.g. Google Forms); their
 * responses are exported as CSV and imported here as `pending` student_submission rows.
 * Nothing becomes a claim until an editor accepts it with an explicit field and value:
 * then it is a tier-9 `user_reported` claim tied to the submission (badge "Community").
 * Email columns are never stored; submitters stay anonymous.
 */

export const SUBMISSION_SOURCE_URL = "https://hclubs.app/about#contribute";

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
const PERSONAL = /e-?mail|name|phone|netid|huid/i;

export interface ImportedRow {
  importKey: string;
  submittedAt: string | null;
  clubText: string;
  kind: string;
  details: string;
  source: string | null;
}

/** Map a responses CSV to submission rows; personal columns are dropped. PURE. */
export function rowsFromResponses(csv: string): { rows: ImportedRow[]; dropped: string[] } {
  const [header, ...body] = parseCsv(csv);
  if (!header) return { rows: [], dropped: [] };
  const col = (key: keyof typeof COLUMN_HINTS) =>
    header.findIndex((h) => COLUMN_HINTS[key].test(h) && !(key !== "club" && PERSONAL.test(h)));
  const idx = {
    timestamp: col("timestamp"),
    club: col("club"),
    kind: col("kind"),
    details: col("details"),
    source: col("source"),
  };
  const dropped = header.filter((h) => PERSONAL.test(h) && !COLUMN_HINTS.club.test(h));
  const rows: ImportedRow[] = [];
  for (const r of body) {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const details = get(idx.details);
    const clubText = get(idx.club);
    if (!details || !clubText) continue;
    const source = get(idx.source);
    const submittedAt = get(idx.timestamp) || null;
    rows.push({
      importKey: createHash("sha256")
        .update(JSON.stringify([submittedAt, clubText, details]))
        .digest("hex")
        .slice(0, 32),
      submittedAt,
      clubText,
      kind: get(idx.kind) || "Share what you know",
      details: details.slice(0, 4000),
      source: /^https?:\/\//i.test(source) ? source.slice(0, 500) : null,
    });
  }
  return { rows, dropped };
}

const KIND_OF = (label: string): "edit_suggestion" | "link" | "deadline" | "inactive_report" => {
  if (/deadline|recruit|apply|comp/i.test(label)) return "deadline";
  if (/link|website|instagram/i.test(label)) return "link";
  if (/inactive|dormant|no longer/i.test(label)) return "inactive_report";
  return "edit_suggestion";
};

export async function importSubmissions(
  db: Db,
  csv: string,
  opts: { dryRun?: boolean; now: Date },
): Promise<{ imported: number; duplicates: number; unmatchedClubs: string[]; droppedColumns: string[] }> {
  const { rows, dropped } = rowsFromResponses(csv);
  const clubs = await db
    .select({ id: schema.club.id, slug: schema.club.slug, name: schema.club.canonicalName })
    .from(schema.club)
    .where(eq(schema.club.recordState, "active"));
  const bySlug = new Map(clubs.map((c) => [c.slug, c.id]));
  const byName = new Map(clubs.map((c) => [normalizeName(c.name), c.id]));
  let imported = 0;
  let duplicates = 0;
  const unmatched: string[] = [];
  for (const row of rows) {
    const [exists] = await db
      .select({ id: schema.studentSubmission.id })
      .from(schema.studentSubmission)
      .where(sql`${schema.studentSubmission.payload}->>'importKey' = ${row.importKey}`);
    if (exists) {
      duplicates++;
      continue;
    }
    // Forms prefill the slug ({slug}); people may also type a name.
    const slug = row.clubText.match(/[a-z0-9]+(?:-[a-z0-9]+)+/)?.[0];
    const clubId = (slug && bySlug.get(slug)) || byName.get(normalizeName(row.clubText)) || null;
    if (!clubId) unmatched.push(row.clubText);
    if (opts.dryRun) {
      imported++;
      continue;
    }
    await db.insert(schema.studentSubmission).values({
      kind: KIND_OF(row.kind),
      clubId,
      payload: {
        importKey: row.importKey,
        submittedAt: row.submittedAt,
        clubText: row.clubText,
        kindLabel: row.kind,
        message: row.details,
      },
      evidenceUrl: row.source,
      submitterRef: null,
      status: "pending",
      createdAt: opts.now,
    });
    imported++;
  }
  return { imported, duplicates, unmatchedClubs: unmatched, droppedColumns: dropped };
}

/**
 * Accept a submission as one claim (the editor chooses the field and value; the text is
 * never parsed automatically). The claim is `user_reported`, tier 9, evidenced by the
 * submission. Rejections and spam are recorded without claims.
 */
export async function acceptSubmission(
  db: Db,
  input: { id: string; fieldKey: FieldKey; value: unknown; actor: string; note?: string; now: Date },
): Promise<{ claimId: string; clubId: string }> {
  const [sub] = await db
    .select()
    .from(schema.studentSubmission)
    .where(and(eq(schema.studentSubmission.id, input.id), eq(schema.studentSubmission.status, "pending")));
  if (!sub) throw new Error("no pending submission with that id");
  if (!sub.clubId) throw new Error("submission isn't matched to a club; set it first");
  const sourceId = await upsertSource(db, {
    url: sub.evidenceUrl ?? SUBMISSION_SOURCE_URL,
    sourceType: "student_submission",
    title: sub.evidenceUrl ? null : "Community submission",
    adapter: "submissions",
  });
  const payload = sub.payload as { message?: string };
  const res = await upsertClaim(
    db,
    { clubId: sub.clubId, fieldKey: input.fieldKey, value: input.value, assertionKind: "user_reported" },
    {
      sourceId,
      sourceType: "student_submission",
      snapshotId: null,
      submissionId: sub.id,
      ingestionRunId: null,
      observedAt: sub.createdAt,
      quote: (payload.message ?? "").slice(0, 500) || null,
      locator: { submission: sub.id },
      extractionMethod: "user_submission",
      extractorName: "submissions",
      extractorVersion: "1",
      isDirect: true,
    },
  );
  await db
    .update(schema.studentSubmission)
    .set({ resultingClaimIds: sql`array_append(${schema.studentSubmission.resultingClaimIds}, ${res.claimId}::uuid)` })
    .where(eq(schema.studentSubmission.id, sub.id));
  await reviewSubmission(db, {
    id: sub.id,
    status: "accepted",
    actor: input.actor,
    ...(input.note ? { note: input.note } : {}),
    now: input.now,
  });
  await resolveClubs(db, { clubIds: [sub.clubId], now: input.now });
  return { claimId: res.claimId, clubId: sub.clubId };
}
