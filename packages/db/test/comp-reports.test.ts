import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, getTableColumns } from "drizzle-orm";
import { compReport } from "../src/schema";
import { compAggregateFor, createClub, recordCompReport } from "../src";
import { createTestDb } from "../src/testing";
import type { Db } from "../src/client";

/** Anonymous comp reports (ADR 0035): stored without any link to a person; aggregated under k-thresholds. */
const NOW = new Date("2026-10-01T15:30:00Z");

describe("comp reports", () => {
  let db: Db;
  let close: () => Promise<void>;
  let clubId: string;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    clubId = (await createClub(db, { name: "Harvard Test Consulting" })).id;
  });
  afterAll(async () => close());

  it("stores a report with no submitter column and a day-precision date", async () => {
    const id = await recordCompReport(
      db,
      { clubId, termKey: "2026-fall", applied: true, furthestStage: "case_interview", accepted: false, notes: "x" },
      { now: NOW },
    );
    const [row] = await db.select().from(compReport).where(eq(compReport.id, id));
    expect(row).toMatchObject({ status: "pending", reportedOn: "2026-10-01", classYear: null });
    const names = Object.values(getTableColumns(compReport)).map((c) => c.name);
    expect(names.filter((n) => /submitter|user|email|name|netid|ip_/.test(n))).toEqual([]);
  });

  it("the database refuses impossible reports", async () => {
    await expect(
      db
        .insert(compReport)
        .values({ clubId, termKey: "2026-fall", applied: false, accepted: true, reportedOn: "2026-10-01" }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(compReport)
        .values({ clubId, termKey: "2026-fall", applied: true, classYear: "class of 2029", reportedOn: "2026-10-01" }),
    ).rejects.toThrow();
  });

  it("aggregates only moderator-accepted reports, and nothing below the minimum", async () => {
    expect(await compAggregateFor(db, { clubId, termKey: "2026-fall" })).toMatchObject({ shown: false });
    for (let i = 0; i < 6; i++)
      await recordCompReport(
        db,
        { clubId, termKey: "2026-fall", applied: true, accepted: i < 3, hoursSpent: 20 },
        { now: NOW },
      );
    expect(await compAggregateFor(db, { clubId, termKey: "2026-fall" })).toMatchObject({ shown: false });
    await db.update(compReport).set({ status: "accepted" }).where(eq(compReport.clubId, clubId));
    expect(await compAggregateFor(db, { clubId, termKey: "2026-fall" })).toMatchObject({
      shown: true,
      reports: 7,
      admittedShare: null, // 7 < 10
      medianHoursSpent: 20,
    });
  });
});
