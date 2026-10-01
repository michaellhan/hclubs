import { describe, expect, it } from "vitest";
import { publicProfile, publicSourceUrl } from "../src/queries/public";
import type { ClubProfile } from "../src/queries/types";

/** What the static site may publish about a club (launch audit 2026-10-01). */
const ref = (quote: string | null, url = "https://club.example/") => ({
  sourceId: "s",
  sourceType: "club_website" as const,
  url,
  title: null,
  observedAt: "2026-09-01T00:00:00.000Z",
  isFixture: false,
  quote,
});
const value = (v: unknown, quote: string | null) => ({
  value: v,
  claimId: "c",
  badge: "verified" as const,
  confidence: 0.9,
  assertionKind: "stated" as const,
  bestTier: 2,
  observedAt: "2026-09-01T00:00:00.000Z",
  asOf: null,
  stale: false,
  sources: [ref(quote)],
});

const profile = {
  name: "Harvard Test Club",
  acronym: "HTC",
  aliases: [],
  shortDescription: "Weekly meetings. Questions? Email jane.doe@college.harvard.edu or info@htc.org.",
  links: [
    { kind: "email", url: "mailto:jane.doe@college.harvard.edu" },
    { kind: "email", url: "mailto:info@mysite.com" },
    { kind: "email", url: "mailto:info@htc.org" },
    { kind: "website", url: "https://htc.org/" },
  ],
  sources: [
    {
      id: "s1",
      url: "https://api.search.brave.com/res/v1/web/search?q=harvard+test+club&count=10",
      title: null,
      sourceType: "public_web",
      trustTier: 8,
      publisher: null,
      isFixture: false,
      claimCount: 1,
      lastObservedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  fields: {
    "club.long_description": {
      kind: "single",
      current: value("A club.", "Reach out to Jack (jack.weldon@thecrimson.com) about the comp."),
      alternatives: [value("Led by Jane Doe and John Roe.", null)],
      conflict: false,
    },
  },
} as unknown as ClubProfile;

describe("publicProfile", () => {
  const out = publicProfile(profile);
  const text = JSON.stringify(out);

  it("drops evidence quotes and competing values", () => {
    expect(text).not.toContain("jack.weldon");
    expect(text).not.toContain("Jane Doe");
    expect(out.fields["club.long_description"]).toMatchObject({ alternatives: [] });
  });

  it("removes personal and placeholder addresses from links and text, keeps the club's", () => {
    expect(out.links.map((l) => l.url)).toEqual(["mailto:info@htc.org", "https://htc.org/"]);
    expect(out.shortDescription).toBe("Weekly meetings. Questions? Email [email removed] or info@htc.org.");
    expect(text).not.toMatch(/jane\.doe|mysite/);
  });

  it("turns search-API source URLs into the public search page", () => {
    expect(out.sources[0]?.url).toBe("https://search.brave.com/search?q=harvard%20test%20club");
    expect(text).not.toContain("api.search.brave.com");
    expect(publicSourceUrl("https://club.example/").url).toBe("https://club.example/");
  });
});
