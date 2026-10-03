import { describe, expect, it } from "vitest";
import { FIELDS, resolveField, type ClaimInput } from "../src";

// Registry `maxAgeDays` (resolver-v10, ADR 0046 amendment): a follower count nobody has
// re-read in 90 days is unknown, not a stale value that keeps ranking the directory.
const NOW = new Date("2026-10-03T12:00:00Z");
const DAY = 86_400_000;

function count(id: string, value: number, daysAgo: number): ClaimInput {
  return {
    id,
    fieldKey: "club.instagram_followers",
    value,
    normalizedValue: value,
    assertionKind: "stated",
    status: "active",
    termKey: null,
    validFrom: null,
    validUntil: null,
    asOfDate: null,
    evidence: [
      {
        sourceId: `s-${id}`,
        sourceType: "club_social",
        trustTier: 3,
        sourceUrl: "https://www.instagram.com/fixturegazette/",
        sourceTitle: null,
        isFixture: true,
        extractionMethod: "manual",
        isDirect: true,
        confidence: 0.9,
        observedAt: new Date(NOW.getTime() - daysAgo * DAY),
        quote: `${value} Followers`,
      },
    ],
  };
}

describe("maxAgeDays", () => {
  const field = FIELDS["club.instagram_followers"];
  it("is 90 days for Instagram follower counts", () => {
    expect(field.maxAgeDays).toBe(90);
  });
  it("uses a count observed within the limit", () => {
    expect(resolveField(field, [count("a", 500, 89)], NOW).current?.value).toBe(500);
  });
  it("treats a count older than the limit as unknown", () => {
    expect(resolveField(field, [count("a", 500, 91)], NOW).current).toBeNull();
  });
  it("falls back to a fresher count rather than an older one", () => {
    expect(resolveField(field, [count("a", 500, 120), count("b", 450, 30)], NOW).current?.value).toBe(450);
  });
  it("leaves fields without a limit alone", () => {
    expect(FIELDS["club.member_count"].maxAgeDays).toBeUndefined();
  });
});
