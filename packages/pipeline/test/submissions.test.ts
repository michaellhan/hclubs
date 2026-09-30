import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createClub, schema, seedTaxonomy, type Db } from "@hci/db";
import { createTestDb } from "@hci/db/testing";
import { acceptSubmission, importSubmissions, parseCsv, rowsFromResponses } from "../src/stages/submissions";

const NOW = new Date("2026-09-30T16:00:00Z");
const CSV = [
  "Timestamp,Email Address,Club (name or slug),What kind of update?,Details,Source link (optional)",
  '9/30/2026 10:00:00,someone@college.harvard.edu,harvard-test-poker-club,Time commitment,"Comp takes about 5-8 hours a week, ""roughly""",https://poker.test/comp',
  "9/30/2026 11:00:00,,Nonexistent Club,Other,Something,",
  "9/30/2026 12:00:00,,harvard-test-poker-club,Other,,",
].join("\r\n");

describe("submission CSV", () => {
  it("parses quoted fields and drops personal columns", () => {
    expect(parseCsv('a,"b ""c""",d\n1,"x\ny",3')).toEqual([
      ["a", 'b "c"', "d"],
      ["1", "x\ny", "3"],
    ]);
    const { rows, dropped } = rowsFromResponses(CSV);
    expect(dropped).toEqual(["Email Address"]);
    expect(rows).toHaveLength(2); // the row without details is skipped
    expect(rows[0]).toMatchObject({ clubText: "harvard-test-poker-club", source: "https://poker.test/comp" });
    expect(JSON.stringify(rows)).not.toContain("@college.harvard.edu");
  });
});

describe("submissions stage", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedTaxonomy(db);
  });
  afterAll(async () => close());

  it("imports once, and an accepted submission becomes a Community claim", async () => {
    const club = await createClub(db, { name: "Harvard Test Poker Club" });
    const first = await importSubmissions(db, CSV, { now: NOW });
    expect(first).toMatchObject({ imported: 2, duplicates: 0, unmatchedClubs: ["Nonexistent Club"] });
    expect((await importSubmissions(db, CSV, { now: NOW })).duplicates).toBe(2);

    const [sub] = await db.select().from(schema.studentSubmission).where(eq(schema.studentSubmission.clubId, club.id));
    expect(sub?.status).toBe("pending");
    const r = await acceptSubmission(db, {
      id: sub?.id ?? "",
      fieldKey: "club.hours_per_week",
      value: { min: 5, max: 8, qualifier: "comp_period" },
      actor: "test",
      now: NOW,
    });
    const [claim] = await db.select().from(schema.claim).where(eq(schema.claim.id, r.claimId));
    expect(claim?.assertionKind).toBe("user_reported");
    const [after] = await db
      .select()
      .from(schema.studentSubmission)
      .where(eq(schema.studentSubmission.id, sub?.id ?? ""));
    expect(after).toMatchObject({ status: "accepted", resultingClaimIds: [r.claimId] });
    const [resolved] = await db.select().from(schema.club).where(eq(schema.club.id, club.id));
    expect(resolved?.hoursPerWeekMax).toBe(8);
    await expect(
      acceptSubmission(db, {
        id: sub?.id ?? "",
        fieldKey: "club.hours_per_week",
        value: { min: 1, max: 2 },
        actor: "t",
        now: NOW,
      }),
    ).rejects.toThrow(/no pending submission/);
  });
});
