import { describe, expect, it } from "vitest";
import { htmlToDocument } from "../src/parse/document";
import { articleHeadline, articleMention, crimsonArticle, redactPeople, searchableNames } from "../src/stages/crimson";

const article = (title: string, paragraphs: string[]) =>
  htmlToDocument(
    `<html><head><title>${title}</title></head><body><article>${paragraphs.map((p) => `<p>${p}</p>`).join("")}</article></body></html>`,
    "https://www.thecrimson.com/article/2020/11/12/poker/",
  );

describe("crimson mentions", () => {
  it("recognizes article URLs and dates them from the path", () => {
    expect(crimsonArticle("https://www.thecrimson.com/article/2020/11/12/poker-club-zoom/?utm=x")).toEqual({
      url: "https://www.thecrimson.com/article/2020/11/12/poker-club-zoom/",
      publishedOn: "2020-11-12",
    });
    expect(crimsonArticle("https://www.thecrimson.com/tag/poker/")).toBeNull();
    expect(crimsonArticle("https://example.com/article/2020/1/1/x/")).toBeNull();
  });
  it("uses only names specific enough to search article text", () => {
    const names = searchableNames({
      name: "Harvard Undergraduate Poker Club",
      acronym: null,
      aliases: ["Harvard College"],
    });
    expect(names).toContain("Harvard Undergraduate Poker Club");
    expect(names).not.toContain("Harvard College");
    expect(searchableNames({ name: "The Harvard Crimson", acronym: null, aliases: [] })).toEqual([]);
  });
  it("prefers a sentence without students' names, else redacts them", () => {
    const names = ["Harvard Undergraduate Poker Club"];
    const withName = article("From the Poker Table | News | The Harvard Crimson", [
      "Chen ’22, founder of the Harvard Undergraduate Poker Club, moved games online.",
    ]);
    expect(articleMention(withName, names)).toBe(
      "[a student], founder of the Harvard Undergraduate Poker Club, moved games online.",
    );
    const both = article("x", [
      "Jane Doe ’23 joined the Harvard Undergraduate Poker Club.",
      "The Harvard Undergraduate Poker Club meets weekly.",
    ]);
    expect(articleMention(both, names)).toBe("The Harvard Undergraduate Poker Club meets weekly.");
    expect(articleMention(article("x", ["Nothing about it."]), names)).toBeNull();
    expect(redactPeople("Said Alex B. Kim '25 and Lee ’24.")).toBe("Said [a student] and [a student].");
  });
  it("strips the section and publisher from headlines", () => {
    expect(articleHeadline(article("From the Poker Table to the Zoom Screen | News | The Harvard Crimson", []))).toBe(
      "From the Poker Table to the Zoom Screen",
    );
  });
});

// --- Credit-saving behavior (paid search) --------------------------------------------------

import { afterAll, beforeAll } from "vitest";
import { createClub, rejectClaims, schema, seedTaxonomy, type Db } from "@hci/db";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@hci/db/testing";
import { silentLogger } from "../src/logger";
import { SearchCreditError, type WebSearchProvider } from "../src/sites/search";
import { MemorySnapshotStore } from "../src/snapshots/store";
import { PUBLISHERS, rescorePressMentions, runCrimson } from "../src/stages/crimson";
import type { FetchResult, SourceCandidate, SourceFetcher } from "../src/types";

const NOW = new Date("2026-09-30T16:00:00Z");
const ARTICLE_URL = "https://www.thecrimson.com/article/2026/9/1/clubs-roundup/";
const ARTICLE_HTML = `<html><head><title>Clubs Roundup | News | The Harvard Crimson</title></head><body><article>
  <p>The Harvard Alpha Chess Club met Tuesday in the Science Center to plan its fall tournament season.</p><p>The Harvard Beta Rowing Club did not, though its members said they would gather next week.</p></article></body></html>`;

class OneArticleFetcher implements SourceFetcher {
  async fetch(c: SourceCandidate): Promise<FetchResult> {
    const ok = c.url.includes("/article/2026/9/1/clubs-roundup");
    return {
      status: ok ? "ok" : "http_error",
      requestedUrl: c.url,
      finalUrl: c.url,
      httpStatus: ok ? 200 : 404,
      contentType: ok ? "text/html" : null,
      etag: null,
      lastModified: null,
      body: ok ? new TextEncoder().encode(ARTICLE_HTML) : null,
      fetchedAt: NOW,
      attempts: 1,
      durationMs: 0,
      error: ok ? null : "404",
      method: "fixture",
    };
  }
}

function paidSearch(creditQueries: number) {
  const queries: string[] = [];
  const provider: WebSearchProvider = {
    name: "fake-paid",
    paid: true,
    requestUrl: (q) => `https://search.test/?q=${encodeURIComponent(q)}`,
    search: async (q) => {
      if (queries.length >= creditQueries) throw new SearchCreditError("out of credit");
      queries.push(q);
      return {
        requestUrl: `https://search.test/?q=${encodeURIComponent(q)}`,
        raw: new Uint8Array(),
        results: [{ url: ARTICLE_URL, title: "Clubs Roundup" }],
      };
    },
  };
  return { provider, queries };
}

describe("press stage with paid search", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedTaxonomy(db);
    for (const n of [
      "Alpha Chess",
      "Beta Rowing",
      "Gamma Debate",
      "Delta Poker",
      "Epsilon Film",
      "Zeta Opera",
      "Eta Robotics",
    ])
      await createClub(db, { name: `Harvard ${n} Club` });
  });
  afterAll(async () => close());
  const store = new MemorySnapshotStore();
  const deps = () => ({ db, fetcher: new OneArticleFetcher(), store, logger: silentLogger, now: () => NOW });

  it("batches clubs into few queries, stops cleanly when credit runs out, and never re-searches", async () => {
    const crimson = PUBLISHERS[0]!;
    // 7 clubs, 5 per query → 2 queries; credit for only 1.
    const first = paidSearch(1);
    const r1 = await runCrimson(deps(), { search: first.provider, publisher: crimson, concurrency: 1 });
    expect(first.queries).toHaveLength(1);
    expect(first.queries[0]).toContain('("Harvard Alpha Chess Club" OR ');
    expect(r1.counters.stoppedForCredit).toBe(1);
    // One article, checked against every club in the batch: two clubs named in it.
    expect(r1.counters.mentionsRecorded).toBe(2);

    // Rerun with credit: only the 2 clubs not yet searched cost a query.
    const second = paidSearch(10);
    const r2 = await runCrimson(deps(), { search: second.provider, publisher: crimson, concurrency: 1 });
    expect(r2.counters.clubsAlreadySearched).toBe(5);
    expect(second.queries).toHaveLength(1);

    const third = paidSearch(10);
    await runCrimson(deps(), { search: third.provider, publisher: crimson, concurrency: 1 });
    expect(third.queries).toHaveLength(0);
  });

  it("rescore restores mentions an earlier rescore rejected that now pass, never other rejections", async () => {
    const mentions = await db
      .select({ id: schema.claim.id })
      .from(schema.claim)
      .where(and(eq(schema.claim.fieldKey, "club.press_mention"), eq(schema.claim.status, "active")))
      .orderBy(schema.claim.id);
    expect(mentions).toHaveLength(2);
    const [byRescore, byEditor] = mentions.map((m) => m.id);
    await rejectClaims(db, { claimIds: [byRescore!], actor: "test", reason: "press-v3 rescore: older rule" });
    await rejectClaims(db, { claimIds: [byEditor!], actor: "test", reason: "not about this club" });

    const dry = await rescorePressMentions(db, { dryRun: true });
    expect(dry.restored).toHaveLength(1);
    expect(dry.rejected).toHaveLength(0);
    await rescorePressMentions(db);
    const status = async (id: string) =>
      (await db.select({ s: schema.claim.status }).from(schema.claim).where(eq(schema.claim.id, id)))[0]?.s;
    expect(await status(byRescore!)).toBe("active");
    expect(await status(byEditor!)).toBe("rejected");
  });
});
