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
    { kind: "website", url: "https://htc.org/", confidence: 0.9 },
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
    "club.member_count": {
      kind: "single",
      current: value({ kind: "exact", count: 40 }, "We have 40 members, says Jane Doe."),
      alternatives: [value({ kind: "exact", count: 55 }, "55 members")],
      conflict: true,
    },
  },
  selectivity: null,
  currentCycle: {
    termKey: "2026-fall",
    fields: {
      "cycle.deadline": {
        kind: "single",
        current: value({ at: "2026-09-10", precision: "date" }, null),
        alternatives: [],
        conflict: false,
      },
    },
  },
  cycles: [
    {
      termKey: "2026-fall",
      fields: {
        "cycle.deadline": {
          kind: "single",
          current: value(
            { at: "2026-09-10", precision: "date", sourceText: "due Sept 10, ask Jane", parseConfidence: "medium" },
            "Applications due Sept 10, email jane.doe@college.harvard.edu",
          ),
          alternatives: [],
          conflict: false,
        },
      },
    },
  ],
} as unknown as ClubProfile;

describe("publicProfile", () => {
  const out = publicProfile(profile);
  const text = JSON.stringify(out);

  it("drops evidence quotes and competing values", () => {
    expect(text).not.toContain("jack.weldon");
    expect(text).not.toContain("Jane Doe");
    expect(out.fields["club.long_description"]).toMatchObject({ alternatives: [] });
  });

  it("publishes only allowlisted keys for every value and source (ADR 0039)", () => {
    const f = out.fields["club.member_count"];
    const v = f?.kind === "single" ? f.current : null;
    expect(Object.keys(v ?? {}).sort()).toEqual(
      [
        "asOf",
        "assertionKind",
        "badge",
        "bestTier",
        "claimId",
        "confidence",
        "observedAt",
        "sources",
        "stale",
        "value",
      ].sort(),
    );
    expect(v).toMatchObject({ confidence: 0, bestTier: 0 });
    for (const s of v?.sources ?? []) expect(s).toMatchObject({ sourceId: "", quote: null });
  });

  it("withholds link verification scores (ADR 0040)", () => {
    for (const l of out.links) expect(l.confidence ?? 0).toBe(0);
  });

  it("applies the same allowlist to each recruiting cycle's values (ADR 0040)", () => {
    const f = out.cycles[0]?.fields["cycle.deadline"];
    const v = f?.kind === "single" ? f.current : null;
    expect(v).toMatchObject({ confidence: 0, bestTier: 0, value: { at: "2026-09-10" } });
    // The deadline's matched text is a quote and its parse confidence a score: neither ships.
    expect(v?.value).toEqual({ at: "2026-09-10", precision: "date" });
    for (const s of v?.sources ?? []) expect(s).toMatchObject({ sourceId: "", quote: null });
    // …including the current cycle, which a profile passes to its joining status.
    const cur = (out.currentCycle as unknown as { fields: typeof out.fields }).fields["cycle.deadline"];
    expect(cur?.kind === "single" ? cur.current : null).toMatchObject({ confidence: 0, bestTier: 0 });
  });

  it("keeps structured competing values (numbers), without their quotes, so conflicts can be shown", () => {
    const f = out.fields["club.member_count"];
    expect(f).toMatchObject({ conflict: true, alternatives: [{ value: { kind: "exact", count: 55 } }] });
    expect(JSON.stringify(f)).not.toMatch(/Jane Doe|55 members/);
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
    // A Google Form share link names its owner's account (ouid): never published.
    expect(publicSourceUrl("https://docs.google.com/forms/d/e/x/viewform?ouid=1075518305&usp=sharing").url).toBe(
      "https://docs.google.com/forms/d/e/x/viewform?usp=sharing",
    );
  });
});

describe("withWorkingHost", () => {
  it("swaps only between a bare domain and its www host", async () => {
    const { withWorkingHost } = await import("../src/resolve/project");
    expect(withWorkingHost("https://theharvardadvocate.com", "https://www.theharvardadvocate.com/")).toBe(
      "https://www.theharvardadvocate.com/",
    );
    expect(withWorkingHost("https://www.club.org/join", "https://club.org/")).toBe("https://club.org/join");
    // A redirect to another site or path keeps the claimed URL.
    expect(withWorkingHost("https://club.org/", "https://other.org/")).toBe("https://club.org/");
    expect(withWorkingHost("https://club.org/", "https://club.org/home")).toBe("https://club.org/");
  });
});
