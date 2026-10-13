import { describe, expect, it } from "vitest";
import { recruitingTermForDate, termForDate, termKey } from "@hci/core";
import { extractDeterministic } from "../src/extract/deterministic";
import { htmlToDocument } from "../src/parse/document";

describe("recruiting dates in August belong to the fall round (1.16.44)", () => {
  it("files an Aug 31 audition opening and its Sep 4 close under one fall round (Collegium)", () => {
    const claims = extractDeterministic({
      doc: htmlToDocument(
        "<html><body><h1>Auditions</h1><p>Our auditions for the 2026-2027 season will take place on Monday, August 31 through Friday, September 4.</p></body></html>",
        "https://example-chorus.test/audition",
      ),
      role: "join",
      fetchedAt: new Date("2026-10-11T16:00:00Z"),
      clubNames: ["Example Chorus"],
      clubAcronyms: [],
    }).filter((c) => c.fieldKey === "cycle.opens_at" || c.fieldKey === "cycle.deadline");
    expect(claims.length).toBeGreaterThan(0);
    for (const c of claims) expect(c.cycleTermKey).toBe("2026-fall");
  });

  it("keeps the calendar term for 'now' (August is still summer) but recruits August into fall", () => {
    const aug31 = new Date("2026-08-31T16:00:00Z");
    expect(termKey(termForDate(aug31))).toBe("2026-summer");
    expect(termKey(recruitingTermForDate(aug31))).toBe("2026-fall");
    expect(termKey(recruitingTermForDate(new Date("2026-07-20T16:00:00Z")))).toBe("2026-summer");
    expect(termKey(recruitingTermForDate(new Date("2026-09-04T16:00:00Z")))).toBe("2026-fall");
    // Campus time: 11 pm on Jul 31 in Boston is still July.
    expect(termKey(recruitingTermForDate(new Date("2026-08-01T03:00:00Z")))).toBe("2026-summer");
  });
});
