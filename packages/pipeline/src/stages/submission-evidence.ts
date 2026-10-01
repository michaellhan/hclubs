import { and, eq } from "drizzle-orm";
import {
  extractInstagramHandle,
  normalizeName,
  normalizeUrl,
  parseDateExpression,
  type DateValue,
  type DuesValue,
  type FieldKey,
  type HoursPerWeek,
  type JoinMode,
  type LinkValue,
  type MembershipEstimate,
  type SourceType,
} from "@hci/core";
import { recordFetchAttempt, recordSnapshot, schema, upsertSource, type Queryable } from "@hci/db";
import { duesProblem, hoursProblem, memberCountProblem, openMembershipProblem } from "../extract/evidence-rules";
import { htmlToDocument, type PageDocument } from "../parse/document";
import { formDescriptionDoc, isFormUrl } from "../parse/forms";
import type { SnapshotStore } from "../snapshots/store";
import type { SourceFetcher } from "../types";

/**
 * A submission's source link (ADR 0035). When a student gives a public URL, it is fetched
 * like any other source (polite fetcher, robots, immutable snapshot) and the accepted value
 * is looked for on the page. Only a value the page itself states becomes a second, sourced
 * claim, with the page's own trust tier and a verbatim quote; otherwise the fact stays
 * student-reported. Social platforms are never fetched (§21).
 */

export const SUBMISSION_EVIDENCE_EXTRACTOR = { name: "submission-evidence", version: "1" } as const;

export type EvidenceStatus = "corroborated" | "not_found" | "not_checkable" | "not_fetched" | "fetch_failed";

export interface EvidenceCheck {
  url: string;
  status: EvidenceStatus;
  reason: string;
  sourceId?: string;
  snapshotId?: string;
  sourceType?: SourceType;
  tier?: number;
  quote?: string;
  observedAt?: string;
}

const SOCIAL_HOST =
  /(^|\.)(instagram\.com|instagr\.am|facebook\.com|fb\.com|linkedin\.com|tiktok\.com|twitter\.com|x\.com|threads\.net)$/i;

/** The sentence (≤ 300 chars) around `index` in `text`. */
function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(text.lastIndexOf(".", index) + 1, text.lastIndexOf("\n", index) + 1, index - 150);
  const endDot = text.slice(index + length).search(/[.\n]/);
  const end = Math.min(endDot === -1 ? text.length : index + length + endDot + 1, index + length + 150);
  return text.slice(start, end).trim().slice(0, 300);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const fold = (s: string) => normalizeName(s);

const JOIN_KEYWORDS: Record<Exclude<JoinMode, "open" | "unknown" | "attendance_based">, RegExp> = {
  application: /\bappl(y|ication)\b/i,
  comp: /\bcomp(s|ing)?\b/i,
  audition: /\baudition/i,
  tryout: /\btry-?outs?\b/i,
  invite_only: /\binvit(e|ation)[- ]only\b|\bby invitation\b/i,
};

/**
 * The verbatim text on `doc` that states `value` for `fieldKey`, or null. Uses the same
 * evidence rules as the extractors (numbers must appear literally, dues must be about
 * membership, "open" must be about joining). PURE.
 */
export function findValueOnPage(
  fieldKey: FieldKey,
  value: unknown,
  doc: PageDocument,
  fetchedAt: Date,
): { quote: string } | { notCheckable: string } | null {
  const text = doc.text;
  switch (fieldKey) {
    case "club.link":
    case "cycle.application_url": {
      const url = fieldKey === "club.link" ? (value as LinkValue).url : (value as string);
      const want = normalizeUrl(url);
      const handle = fieldKey === "club.link" ? extractInstagramHandle(url) : null;
      if (want && normalizeUrl(doc.url) === want) return { quote: doc.title ?? doc.url };
      const link = doc.links.find(
        (l) => normalizeUrl(l.url) === want || (handle !== null && extractInstagramHandle(l.url) === handle),
      );
      if (link) return { quote: `${link.text || "link"} → ${link.url}`.slice(0, 300) };
      return null;
    }
    case "club.member_count": {
      const v = value as MembershipEstimate;
      const nums = v.kind === "exact" ? [v.count] : [v.min, v.max].filter((n): n is number => n !== null);
      const s = sentences(text).find((q) => !memberCountProblem(q, nums));
      return s ? { quote: s.slice(0, 300) } : null;
    }
    case "club.hours_per_week": {
      const v = value as HoursPerWeek;
      const nums = [v.min, v.max].filter((n): n is number => n !== null);
      const s = sentences(text).find((q) => /\bhours?\b|\bhrs?\b/i.test(q) && !hoursProblem(q, nums));
      return s ? { quote: s.slice(0, 300) } : null;
    }
    case "club.dues": {
      const v = value as DuesValue;
      const s = sentences(text).find(
        (q) =>
          !duesProblem(q, v.amountUsd) &&
          (v.hasDues !== false || /\b(free|no (membership )?(fees?|dues|cost)|costs? nothing)\b/i.test(q)),
      );
      return s ? { quote: s.slice(0, 300) } : null;
    }
    case "club.join_mode": {
      const mode = value as JoinMode;
      if (mode === "open") {
        const s = sentences(text).find((q) => !openMembershipProblem(q));
        return s ? { quote: s.slice(0, 300) } : null;
      }
      const re = JOIN_KEYWORDS[mode as keyof typeof JOIN_KEYWORDS];
      if (!re) return { notCheckable: `"${mode}" can't be checked against a page` };
      const s = sentences(text).find((q) => re.test(q) && /\b(join|member|new|recruit|selected|apply)/i.test(q));
      return s ? { quote: s.slice(0, 300) } : null;
    }
    case "cycle.deadline":
    case "cycle.opens_at": {
      const v = value as DateValue;
      const day = v.at.slice(0, 10);
      const re =
        /\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi;
      for (const m of text.matchAll(re)) {
        const d = parseDateExpression(m[0], fetchedAt);
        if (d && d.at.slice(0, 10) === day) return { quote: sentenceAround(text, m.index ?? 0, m[0].length) };
      }
      return null;
    }
    case "club.short_description":
    case "club.eligibility_note":
    case "club.name":
    case "club.alias": {
      const raw = fieldKey === "club.alias" ? (value as { name: string }).name : (value as string);
      const want = fold(raw);
      if (want.length < 3) return null;
      const s = sentences(`${doc.title ?? ""}\n${doc.h1 ?? ""}\n${text}`).find((q) => fold(q).includes(want));
      return s ? { quote: s.slice(0, 300) } : null;
    }
    default:
      return { notCheckable: `${fieldKey} can't be matched against a page mechanically` };
  }
}

/** The source type a submitted URL deserves: its known type, or the club's own site, else the open web. */
async function classifySource(
  db: Queryable,
  url: string,
  clubId: string,
): Promise<{ sourceType: SourceType; ownerClubId: string | null }> {
  const normalized = normalizeUrl(url);
  if (normalized) {
    const [known] = await db
      .select({ type: schema.source.sourceType, owner: schema.source.ownerClubId })
      .from(schema.source)
      .where(eq(schema.source.normalizedUrl, normalized));
    if (known && known.type !== "student_submission")
      return { sourceType: known.type as SourceType, ownerClubId: known.owner };
  }
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  const sites = await db
    .select({ url: schema.clubLink.url })
    .from(schema.clubLink)
    .where(
      and(
        eq(schema.clubLink.clubId, clubId),
        eq(schema.clubLink.kind, "website"),
        eq(schema.clubLink.status, "verified"),
      ),
    );
  if (sites.some((s) => new URL(s.url).hostname.replace(/^www\./, "").toLowerCase() === host))
    return { sourceType: "club_website", ownerClubId: clubId };
  if (/(^|\.)thecrimson\.com$/.test(host)) return { sourceType: "harvard_crimson", ownerClubId: null };
  if (/(^|\.)harvard\.edu$/.test(host)) return { sourceType: "harvard_related_other", ownerClubId: null };
  return { sourceType: "public_web", ownerClubId: null };
}

/** Fetch a submission's source link and look for the accepted value on it. */
export async function checkSubmissionEvidence(
  db: Queryable,
  input: {
    url: string;
    clubId: string;
    fieldKey: FieldKey;
    value: unknown;
    fetcher: SourceFetcher;
    store: SnapshotStore;
  },
): Promise<EvidenceCheck> {
  const { url } = input;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { url, status: "not_fetched", reason: "not a valid URL" };
  }
  if (SOCIAL_HOST.test(host))
    return { url, status: "not_fetched", reason: "social platforms are never fetched (§21); stays student-reported" };

  const { sourceType, ownerClubId } = await classifySource(db, url, input.clubId);
  const sourceId = await upsertSource(db, { url, sourceType, adapter: "submissions", ownerClubId });
  const res = await input.fetcher.fetch({ url, sourceType });
  let snapshotId: string | null = null;
  if (res.status === "ok" && res.body) {
    const put = await input.store.put(res.body);
    const html = new TextDecoder().decode(res.body);
    const doc0 = htmlToDocument(html, res.finalUrl);
    const snap = await recordSnapshot(db, {
      sourceId,
      ingestionRunId: null,
      fetchedAt: res.fetchedAt,
      finalUrl: res.finalUrl,
      httpStatus: res.httpStatus,
      contentType: res.contentType,
      etag: res.etag,
      lastModified: res.lastModified,
      contentSha256: put.sha256,
      byteSize: put.byteSize,
      storageKey: put.key,
      extractedText: doc0.text.slice(0, 200_000),
      fetchMethod: res.method === "fixture" ? "fixture" : res.method,
    });
    snapshotId = snap.snapshotId;
  }
  await recordFetchAttempt(db, {
    sourceId,
    ingestionRunId: null,
    url,
    status: res.status,
    httpStatus: res.httpStatus,
    errorMessage: res.error,
    attempts: res.attempts,
    durationMs: res.durationMs,
    snapshotId,
  });
  if (res.status === "robots_disallowed")
    return { url, status: "not_fetched", reason: "robots.txt disallows fetching it", sourceId };
  if (!snapshotId || !res.body)
    return { url, status: "fetch_failed", reason: res.error ?? `HTTP ${res.httpStatus ?? "error"}`, sourceId };

  const [src] = await db
    .select({ type: schema.source.sourceType, tier: schema.source.trustTier })
    .from(schema.source)
    .where(eq(schema.source.id, sourceId));
  let doc = htmlToDocument(new TextDecoder().decode(res.body), res.finalUrl);
  // Forms: only the public title and description, never questions (ADR 0027).
  if (isFormUrl(res.finalUrl) || isFormUrl(url)) doc = formDescriptionDoc(doc);
  const base = {
    url,
    sourceId,
    snapshotId,
    sourceType: (src?.type ?? sourceType) as SourceType,
    tier: src?.tier ?? 8,
    observedAt: res.fetchedAt.toISOString(),
  };
  const found = findValueOnPage(input.fieldKey, input.value, doc, res.fetchedAt);
  if (!found) return { ...base, status: "not_found", reason: "the page doesn't state this value" };
  if ("notCheckable" in found) return { ...base, status: "not_checkable", reason: found.notCheckable };
  return { ...base, status: "corroborated", reason: "the page states this value", quote: found.quote };
}
