import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createClub, resolveClubs, schema, seedTaxonomy, upsertClaim, upsertSource, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { MemorySnapshotStore } from "../src/snapshots/store";
import {
  SubmissionConflictError,
  SubmissionReviewError,
  acceptProposal,
  importSubmissions,
  listSubmissions,
  matchSubmission,
  parseCsv,
  parseFormTimestamp,
  rejectProposal,
  rejectSubmission,
  rowsFromResponses,
  showSubmission,
  submissionStats,
} from "../src/stages/submissions";
import type { FetchResult, SourceFetcher } from "../src/types";

const NOW = new Date("2026-09-30T16:00:00Z");
const HEADER = "Timestamp,Email Address,Club,What kind of update?,Details,Source link (optional)";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\r\n");
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Serves fixed pages by URL; anything else is a 404. Counts requests. */
class PageFetcher implements SourceFetcher {
  requests: string[] = [];
  constructor(private readonly pages: Record<string, string>) {}
  async fetch(c: { url: string }): Promise<FetchResult> {
    this.requests.push(c.url);
    const html = this.pages[c.url];
    return {
      status: html ? "ok" : "http_error",
      requestedUrl: c.url,
      finalUrl: c.url,
      httpStatus: html ? 200 : 404,
      contentType: "text/html",
      etag: null,
      lastModified: null,
      body: html ? new TextEncoder().encode(html) : null,
      fetchedAt: NOW,
      attempts: 1,
      durationMs: 1,
      error: html ? null : "not found",
      method: "fixture",
    };
  }
}

describe("responses CSV", () => {
  it("parses quoted fields, drops personal columns and site feedback, removes contact details", () => {
    expect(parseCsv('a,"b ""c""",d\n1,"x\ny",3')).toEqual([
      ["a", 'b "c"', "d"],
      ["1", "x\ny", "3"],
    ]);
    const { rows, dropped, siteFeedback } = rowsFromResponses(
      csv(
        `9/30/2026 10:00:00,someone@college.harvard.edu,Poker [harvard-test-poker],Dues,${q("Dues: $20\nText me at 617-555-0134")},`,
        "9/30/2026 11:00:00,,,Feedback about the site,Love the site,",
        "9/30/2026 12:00:00,,harvard-test-poker,Other,,",
      ),
    );
    expect(dropped).toEqual(["Email Address"]);
    expect(siteFeedback).toBe(1);
    expect(rows).toHaveLength(1); // the row without details is skipped
    expect(rows[0]?.redactions).toBe(1);
    expect(JSON.stringify(rows)).not.toMatch(/college\.harvard\.edu|555-0134/);
    expect(rows[0]?.raw).toMatchObject({ Club: "Poker [harvard-test-poker]", "What kind of update?": "Dues" });
  });

  it("reads Google's timestamps as campus time", () => {
    expect(parseFormTimestamp("9/30/2026 10:00:00")?.toISOString()).toBe("2026-09-30T14:00:00.000Z");
    expect(parseFormTimestamp("nonsense")).toBeNull();
  });
});

describe("submissions review", () => {
  let db: Db;
  let close: () => Promise<void>;
  let poker: { id: string; slug: string };
  let chess: { id: string; slug: string };
  const store = new MemorySnapshotStore();
  const sub = async (slug: string, kind: string) => {
    const rows = await listSubmissions(db, { status: "all" });
    const r = rows.find((x) => x.clubSlug === slug && x.kind === kind);
    if (!r) throw new Error(`no ${kind} submission for ${slug}`);
    return r.id;
  };
  const current = async (clubId: string, field: string) => {
    const [c] = await db.select({ fields: schema.club.fields }).from(schema.club).where(eq(schema.club.id, clubId));
    return (c?.fields as Record<string, { current?: { value: unknown; assertionKind: string } }>)[field]?.current;
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedTaxonomy(db);
    poker = await createClub(db, { name: "Harvard Test Poker Club", slug: "harvard-test-poker" });
    chess = await createClub(db, { name: "Harvard Test Chess Club", slug: "harvard-test-chess" });
    // The club's own site says dues are $20 and it has 40 members (tier 2).
    const site = await upsertSource(db, {
      url: "https://poker.test/",
      sourceType: "club_website",
      ownerClubId: poker.id,
    });
    for (const [fieldKey, value, quote] of [
      ["club.dues", { hasDues: true, amountUsd: 20 }, "Dues are $20 a semester."],
      ["club.member_count", { kind: "exact", count: 40 }, "We have 40 members."],
    ] as const)
      await upsertClaim(
        db,
        { clubId: poker.id, fieldKey, value, assertionKind: "stated" },
        {
          sourceId: site,
          sourceType: "club_website",
          snapshotId: null,
          ingestionRunId: null,
          observedAt: new Date("2026-09-01T12:00:00Z"),
          quote,
          extractionMethod: "manual",
          extractorName: "test",
          extractorVersion: "1",
          isDirect: true,
        },
      );
    await resolveClubs(db, { now: NOW });

    const result = await importSubmissions(
      db,
      csv(
        // 1: two fields, one good, one wrong → partial accept
        `9/30/2026 09:00:00,,Harvard Test Poker Club [harvard-test-poker],Time commitment,${q(
          "Hours per week as a member: 2-3\nHours per week during the comp or application: 6",
        )},`,
        // 2: dues that disagree with the club's site
        `9/30/2026 09:05:00,,harvard-test-poker,Dues,${q("Dues (amount and how often, or none): $50 a semester")},`,
        // 3: a member count, with a public page that states it
        `9/30/2026 09:10:00,,harvard-test-poker,Size (number of members),${q("Number of members: 55")},https://news.test/poker`,
        // 4: chess Instagram, no source
        `9/30/2026 09:15:00,,harvard-test-chess,Website or social link,${q("Instagram (link or @handle): @harvardchess")},`,
        // 5: a malformed slug
        `9/30/2026 09:20:00,,Chess [harvard-test-chesss],Other,${q("What the club does: Weekly casual chess and blitz.")},`,
        // 6: free text only (spam-ish)
        "9/30/2026 09:25:00,,harvard-test-chess,Other,buy followers cheap,",
        // 7: listed twice
        `9/30/2026 09:30:00,,harvard-test-chess,Other,${q("Same club as: hclubs.app/clubs/harvard-test-poker/")},`,
        // 8: same text as #4 again, a minute later
        `9/30/2026 09:16:00,,harvard-test-chess,Website or social link,${q("Instagram (link or @handle): @harvardchess")},`,
        // 9: the deadline, sourced by a form whose description states it
        `9/30/2026 09:40:00,,harvard-test-chess,Recruiting deadline or dates,${q("Deadline: October 9\nTerm: Fall 2026")},https://docs.google.com/forms/d/e/xyz/viewform`,
        // 10: Instagram link as the source (never fetched)
        `9/30/2026 09:45:00,,harvard-test-poker,Website or social link,${q("Instagram: @harvardpoker")},https://www.instagram.com/harvardpoker/`,
      ),
      { now: NOW },
    );
    expect(result).toMatchObject({
      imported: 10,
      duplicates: 0,
      nearDuplicates: 1,
      unmatched: [{ text: "Chess [harvard-test-chesss]", suggestion: "harvard-test-chess" }],
    });
  });
  afterAll(async () => close());

  it("re-importing the same export changes nothing", async () => {
    const again = await importSubmissions(
      db,
      csv(`9/30/2026 09:05:00,,harvard-test-poker,Dues,${q("Dues (amount and how often, or none): $50 a semester")},`),
      { now: NOW },
    );
    expect(again).toMatchObject({ imported: 0, duplicates: 1 });
  });

  it("flags a repeated submission for the reviewer", async () => {
    const rows = (await listSubmissions(db, { status: "all" })).filter((r) => r.clubSlug === "harvard-test-chess");
    expect(rows.filter((r) => (r.payload as { duplicateOf?: string }).duplicateOf)).toHaveLength(1);
  });

  it("partial accept: one field accepted, one rejected, both audited", async () => {
    const id = await sub("harvard-test-poker", "time_commitment");
    const v = await showSubmission(db, id);
    expect(v.proposals.map((p) => [p.fieldKey, p.value])).toEqual([
      ["club.hours_per_week", { min: 2, max: 3, qualifier: "member" }],
      ["club.hours_per_week", { min: 6, max: 6, qualifier: "comp_period" }],
    ]);
    // Two pending proposals for one field: the reviewer must pick by number.
    await expect(
      acceptProposal(db, { submissionId: id, selector: "club.hours_per_week", actor: "t", now: NOW }),
    ).rejects.toThrow(/pick one by number/);
    const a = await acceptProposal(db, { submissionId: id, selector: "1", actor: "t", now: NOW });
    expect(a).toMatchObject({ outcome: "shown", submissionStatus: "pending" });
    const r = await rejectProposal(db, {
      submissionId: id.slice(-8),
      selector: "2",
      reason: "comp hours unclear",
      actor: "t",
      now: NOW,
    });
    expect(r.submissionStatus).toBe("partially_accepted");
    const [s] = await db.select().from(schema.studentSubmission).where(eq(schema.studentSubmission.id, id));
    expect(s?.resultingClaimIds).toEqual(a.claimIds);
    const log = await db
      .select({ action: schema.editorialDecision.action, reason: schema.editorialDecision.reason })
      .from(schema.editorialDecision)
      .where(eq(schema.editorialDecision.actor, "t"));
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining([
        "submission_field_accepted",
        "submission_field_rejected",
        "submission_partially_accepted",
      ]),
    );
    expect(log.find((l) => l.action === "submission_field_rejected")?.reason).toBe("comp hours unclear");
    expect((await current(poker.id, "club.hours_per_week"))?.assertionKind).toBe("user_reported");
  });

  it("a conflicting report becomes a competing claim; the club's own value stays", async () => {
    const id = await sub("harvard-test-poker", "dues");
    const r = await acceptProposal(db, { submissionId: id, selector: "club.dues", actor: "t", now: NOW });
    expect(r).toMatchObject({ outcome: "kept_competing", current: { value: { amountUsd: 20 }, tier: 2 } });
    expect((await current(poker.id, "club.dues"))?.value).toMatchObject({ amountUsd: 20 });
    const claims = await db
      .select({ kind: schema.claim.assertionKind, value: schema.claim.value })
      .from(schema.claim)
      .where(and(eq(schema.claim.clubId, poker.id), eq(schema.claim.fieldKey, "club.dues")));
    expect(claims).toHaveLength(2);
    expect(claims.find((c) => c.kind === "user_reported")?.value).toMatchObject({ amountUsd: 50 });
  });

  it("evidence URL: a public page stating the value adds a sourced claim at that page's tier", async () => {
    const id = await sub("harvard-test-poker", "member_count");
    const fetcher = new PageFetcher({
      "https://news.test/poker":
        "<html><body><h1>Poker club grows</h1><p>The club now has 55 members.</p></body></html>",
    });
    // Without a fetcher (offline review) a fresher student count would replace the club's
    // own figure, so it is refused unless the reviewer overrides.
    await expect(
      acceptProposal(db, { submissionId: id, selector: "club.member_count", actor: "t", now: NOW }),
    ).rejects.toBeInstanceOf(SubmissionConflictError);
    const r = await acceptProposal(db, {
      submissionId: id,
      selector: "club.member_count",
      actor: "t",
      now: NOW,
      fetcher,
      store,
    });
    expect(fetcher.requests).toEqual(["https://news.test/poker"]);
    expect(r.evidence).toMatchObject({ status: "corroborated", sourceType: "public_web", tier: 8 });
    expect(r.evidence?.quote).toContain("55 members");
    expect(r.claimIds).toHaveLength(2);
    const ev = await db
      .select({
        kind: schema.claim.assertionKind,
        source: schema.source.sourceType,
        snapshot: schema.claimEvidence.snapshotId,
        submission: schema.claimEvidence.submissionId,
      })
      .from(schema.claim)
      .innerJoin(schema.claimEvidence, eq(schema.claimEvidence.claimId, schema.claim.id))
      .innerJoin(schema.source, eq(schema.source.id, schema.claimEvidence.sourceId))
      .where(and(eq(schema.claim.clubId, poker.id), eq(schema.claim.fieldKey, "club.member_count")));
    // The student's report is evidenced by the submission, never by the URL they gave.
    expect(ev).toEqual(
      expect.arrayContaining([
        { kind: "user_reported", source: "student_submission", snapshot: null, submission: id },
        { kind: "stated", source: "public_web", snapshot: expect.any(String), submission: null },
      ]),
    );
  });

  it("no evidence: the fact is kept as student-reported, with the community tier", async () => {
    const id = await sub("harvard-test-chess", "instagram");
    const r = await acceptProposal(db, { submissionId: id, selector: "club.link", actor: "t", now: NOW });
    expect(r).toMatchObject({ outcome: "added", evidence: null, submissionStatus: "accepted" });
    const [c] = await db
      .select({ confidence: schema.claimEvidence.confidence })
      .from(schema.claimEvidence)
      .where(eq(schema.claimEvidence.claimId, r.claimIds[0]!));
    expect(c?.confidence).toBeLessThan(0.4);
  });

  it("a social link given as the source is never fetched", async () => {
    const id = await sub("harvard-test-poker", "instagram");
    const fetcher = new PageFetcher({});
    const r = await acceptProposal(db, {
      submissionId: id,
      selector: "club.link",
      actor: "t",
      now: NOW,
      fetcher,
      store,
    });
    expect(fetcher.requests).toEqual([]);
    expect(r.evidence).toMatchObject({ status: "not_fetched" });
    expect(r.claimIds).toHaveLength(1);
  });

  it("a form's public description can corroborate a deadline (questions are never read)", async () => {
    const id = await sub("harvard-test-chess", "deadline");
    const fetcher = new PageFetcher({
      "https://docs.google.com/forms/d/e/xyz/viewform":
        '<html><head><title>Chess Club Application - Google Forms</title><meta property="og:description" content="Applications are due October 9 at midnight."></head><body><div>Question 1: your secret answer October 12</div></body></html>',
    });
    const r = await acceptProposal(db, {
      submissionId: id,
      selector: "cycle.deadline",
      actor: "t",
      now: NOW,
      fetcher,
      store,
    });
    expect(r.evidence).toMatchObject({ status: "corroborated" });
    expect(r.evidence?.quote).toContain("October 9");
    const [cycle] = await db
      .select()
      .from(schema.recruitingCycle)
      .where(and(eq(schema.recruitingCycle.clubId, chess.id), eq(schema.recruitingCycle.termKey, "2026-fall")));
    expect(cycle).toBeDefined();
  });

  it("a malformed slug is held until matched, then reviewed normally", async () => {
    const [unmatched] = (await listSubmissions(db)).filter((r) => r.clubSlug === null);
    expect(unmatched).toBeDefined();
    await expect(
      acceptProposal(db, { submissionId: unmatched!.id, selector: "club.short_description", actor: "t", now: NOW }),
    ).rejects.toThrow(/match/);
    await expect(
      matchSubmission(db, { submissionId: unmatched!.id, slug: "harvard-test-chesss", actor: "t", now: NOW }),
    ).rejects.toThrow(/did you mean harvard-test-chess/);
    await matchSubmission(db, { submissionId: unmatched!.id, slug: "harvard-test-chess", actor: "t", now: NOW });
    const r = await acceptProposal(db, {
      submissionId: unmatched!.id,
      selector: "club.short_description",
      actor: "t",
      now: NOW,
    });
    expect(r.outcome).toBe("shown");
  });

  it("reject keeps the submission, with its reason; spam too", async () => {
    const id = (await listSubmissions(db)).find((r) =>
      (r.payload as { message: string }).message.startsWith("buy"),
    )!.id;
    await expect(rejectSubmission(db, { submissionId: id, reason: " ", actor: "t", now: NOW })).rejects.toThrow(
      /reason/,
    );
    expect(
      await rejectSubmission(db, { submissionId: id, reason: "advertising", spam: true, actor: "t", now: NOW }),
    ).toEqual({
      status: "spam",
      proposalsRejected: 0,
    });
    const [s] = await db.select().from(schema.studentSubmission).where(eq(schema.studentSubmission.id, id));
    expect(s).toMatchObject({ status: "spam", reviewNote: "advertising" });
    await expect(
      acceptProposal(db, { submissionId: id, selector: "club.dues", value: { hasDues: false }, actor: "t", now: NOW }),
    ).rejects.toBeInstanceOf(SubmissionReviewError);
  });

  it("the editor can record what free text says, and a duplicate report proposes a merge", async () => {
    const dupId = (await listSubmissions(db)).find((r) => r.kind === "duplicate")!.id;
    const m = await acceptProposal(db, { submissionId: dupId, selector: "duplicate_of", actor: "t", now: NOW });
    expect(m.outcome).toBe("merge_proposed");
    const [cand] = await db.select().from(schema.mergeCandidate);
    expect(cand).toMatchObject({ status: "proposed", matcherVersion: "submission-report-1" });
    // Clubs are never merged from a submission.
    const [c] = await db.select().from(schema.club).where(eq(schema.club.id, chess.id));
    expect(c?.recordState).toBe("active");
  });

  it("an accepted value must pass the field's schema", async () => {
    const id = (await listSubmissions(db)).find((r) => (r.payload as { duplicateOf?: string }).duplicateOf)!.id;
    await expect(
      acceptProposal(db, {
        submissionId: id,
        selector: "club.member_count",
        value: { kind: "exact", count: -1 },
        actor: "t",
        now: NOW,
      }),
    ).rejects.toThrow(/club.member_count/);
    await rejectSubmission(db, { submissionId: id, reason: "repeats an accepted submission", actor: "t", now: NOW });
  });

  it("stats", async () => {
    const s = await submissionStats(db);
    expect(s.submissions).toMatchObject({ accepted: expect.any(Number), partially_accepted: 1, spam: 1, rejected: 1 });
    expect(s.fieldsAccepted).toMatchObject({ "club.hours_per_week": 1, "club.dues": 1, "club.member_count": 1 });
    expect(s.clubsImproved).toBe(2);
    expect(s.corroboratedBySource).toBe(2);
    expect(s.unmatched).toBe(0);
  });
});
