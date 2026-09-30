import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createClub,
  createSubmission,
  listPendingSubmissions,
  reviewSubmission,
  schema,
  SUBMISSIONS_PER_HOUR,
} from "../src";
import { createTestDb } from "../src/testing";
import type { Db } from "../src/client";

const NOW = new Date("2026-09-30T16:00:00Z");
let db: Db;
let close: () => Promise<void>;
let slug: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  ({ slug } = await createClub(db, { name: "Example Submission Society" }));
});
afterAll(async () => close());

const valid = () => ({
  kind: "deadline",
  clubSlug: slug,
  message: "Applications close Oct 10 per their site.",
  evidenceUrl: "https://example.test/apply",
});

describe("student submissions", () => {
  it("queues a valid submission as pending, never as a claim", async () => {
    const r = await createSubmission(db, valid(), { submitterRef: "ref-a", now: NOW });
    expect(r.ok).toBe(true);
    const pending = await listPendingSubmissions(db);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "deadline", clubSlug: slug, evidenceUrl: "https://example.test/apply" });
    expect(await db.select().from(schema.claim)).toHaveLength(0);
  });

  it("rejects invalid input and unknown clubs", async () => {
    expect(await createSubmission(db, { ...valid(), message: "x" }, { submitterRef: null, now: NOW })).toMatchObject({
      ok: false,
      error: "invalid",
    });
    expect(
      await createSubmission(db, { ...valid(), evidenceUrl: "javascript:alert(1)" }, { submitterRef: null, now: NOW }),
    ).toMatchObject({ ok: false, error: "invalid" });
    expect(
      await createSubmission(db, { ...valid(), clubSlug: "no-such-club" }, { submitterRef: null, now: NOW }),
    ).toMatchObject({
      ok: false,
      error: "club_not_found",
    });
  });

  it("rate-limits per submitter ref within an hour", async () => {
    for (let i = 0; i < SUBMISSIONS_PER_HOUR; i++)
      await createSubmission(db, valid(), { submitterRef: "ref-b", now: NOW });
    expect(await createSubmission(db, valid(), { submitterRef: "ref-b", now: NOW })).toMatchObject({
      ok: false,
      error: "rate_limited",
    });
    const later = new Date(NOW.getTime() + 2 * 3600_000);
    expect((await createSubmission(db, valid(), { submitterRef: "ref-b", now: later })).ok).toBe(true);
  });

  it("records review decisions in the editorial log, once", async () => {
    const [first] = await listPendingSubmissions(db);
    await reviewSubmission(db, { id: first!.id, status: "rejected", actor: "test", now: NOW });
    await reviewSubmission(db, { id: first!.id, status: "accepted", actor: "test", now: NOW }); // no-op: already decided
    const [row] = await db.select().from(schema.studentSubmission).where(eq(schema.studentSubmission.id, first!.id));
    expect(row?.status).toBe("rejected");
    const log = await db
      .select()
      .from(schema.editorialDecision)
      .where(eq(schema.editorialDecision.targetId, first!.id));
    expect(log.map((d) => d.action)).toEqual(["submission_rejected"]);
  });
});
