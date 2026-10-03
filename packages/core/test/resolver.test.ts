import { describe, expect, it } from "vitest";
import {
  FIELDS,
  absorbedNameAliases,
  computeAcceptanceRate,
  computeCycleStatus,
  deriveSelectivityLabel,
  getField,
  parseFieldValue,
  resolveField,
  type ClaimInput,
  type EvidenceInput,
} from "../src";

const NOW = new Date("2026-09-30T16:00:00Z");

function ev(over: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    sourceId: "s1",
    sourceType: "club_website",
    trustTier: 2,
    sourceUrl: "https://club.org",
    sourceTitle: null,
    isFixture: false,
    extractionMethod: "html_parse",
    isDirect: true,
    confidence: 0.85,
    observedAt: new Date("2026-09-01T00:00:00Z"),
    quote: null,
    ...over,
  };
}

function claim(over: Partial<ClaimInput> & Pick<ClaimInput, "id" | "fieldKey" | "value">): ClaimInput {
  return {
    normalizedValue: over.value,
    assertionKind: "stated",
    status: "active",
    termKey: null,
    validFrom: null,
    validUntil: null,
    asOfDate: null,
    evidence: [ev()],
    ...over,
  };
}

describe("resolveField (single)", () => {
  const field = getField("club.short_description");

  it("returns null current when there are no claims (missing means unknown)", () => {
    const r = resolveField(field, [], NOW);
    expect(r.current).toBeNull();
  });

  it("prefers higher-trust sources for priority fields", () => {
    const r = resolveField(
      field,
      [
        claim({
          id: "a",
          fieldKey: field.key,
          value: "From Crimson",
          evidence: [
            ev({ sourceId: "c", sourceType: "harvard_crimson", trustTier: 6, observedAt: new Date("2026-09-20") }),
          ],
        }),
        claim({
          id: "b",
          fieldKey: field.key,
          value: "From Harvard",
          evidence: [ev({ sourceId: "h", sourceType: "harvard_official", trustTier: 1 })],
        }),
      ],
      NOW,
    );
    expect(r.current?.value).toBe("From Harvard");
    expect(r.current?.badge).toBe("verified");
    expect(r.conflict).toBe(false); // tier 6 is not comparable to tier 1
  });

  it("keeps differently-worded descriptions as alternatives without flagging a factual conflict", () => {
    const r = resolveField(
      field,
      [
        claim({ id: "a", fieldKey: field.key, value: "One", evidence: [ev({ sourceId: "w", trustTier: 2 })] }),
        claim({
          id: "b",
          fieldKey: field.key,
          value: "Two",
          evidence: [ev({ sourceId: "i", sourceType: "club_social", trustTier: 3 })],
        }),
      ],
      NOW,
    );
    expect(r.current?.value).toBe("One");
    expect(r.conflict).toBe(false);
    expect(r.alternatives.map((a) => a.value)).toEqual(["Two"]);
  });

  it("flags a conflict between comparable sources on a factual field and keeps both", () => {
    const f = getField("club.recognition_status");
    const r = resolveField(
      f,
      [
        claim({ id: "a", fieldKey: f.key, value: "recognized", evidence: [ev({ sourceId: "w", trustTier: 2 })] }),
        claim({
          id: "b",
          fieldKey: f.key,
          value: "not_recognized",
          evidence: [ev({ sourceId: "i", sourceType: "club_social", trustTier: 3 })],
        }),
      ],
      NOW,
    );
    expect(r.current?.value).toBe("recognized");
    expect(r.conflict).toBe(true);
    expect(r.alternatives.map((a) => a.value)).toEqual(["not_recognized"]);
  });

  it("excludes inferred claims for fields that disallow inference", () => {
    const members = getField("club.member_count");
    const r = resolveField(
      members,
      [claim({ id: "a", fieldKey: members.key, value: { kind: "exact", count: 40 }, assertionKind: "inferred" })],
      NOW,
    );
    expect(r.current).toBeNull();
  });

  it("recency-first fields pick the newest as-of value (35 in 2025 vs 50 in 2026)", () => {
    const members = getField("club.member_count");
    const r = resolveField(
      members,
      [
        claim({
          id: "a",
          fieldKey: members.key,
          value: { kind: "exact", count: 35 },
          asOfDate: new Date("2025-03-01"),
          evidence: [ev({ sourceId: "h", sourceType: "harvard_official", trustTier: 1 })],
        }),
        claim({
          id: "b",
          fieldKey: members.key,
          value: { kind: "exact", count: 50 },
          asOfDate: new Date("2026-09-01"),
        }),
      ],
      NOW,
    );
    expect(r.current?.value).toEqual({ kind: "exact", count: 50 });
    expect(r.conflict).toBe(false); // outside the staleness window, so an update rather than a conflict
  });

  it("marks stale verified values as reported", () => {
    const r = resolveField(
      field,
      [claim({ id: "a", fieldKey: field.key, value: "Old", evidence: [ev({ observedAt: new Date("2024-01-01") })] })],
      NOW,
    );
    expect(r.current).toMatchObject({ badge: "reported", stale: true });
  });

  it("student submissions display as community", () => {
    const r = resolveField(
      field,
      [
        claim({
          id: "a",
          fieldKey: field.key,
          value: "X",
          evidence: [ev({ sourceType: "student_submission", trustTier: 9 })],
        }),
      ],
      NOW,
    );
    expect(r.current?.badge).toBe("community");
  });

  it("editorial claims override everything and suppress conflicts", () => {
    const r = resolveField(
      field,
      [
        claim({
          id: "a",
          fieldKey: field.key,
          value: "Harvard",
          evidence: [ev({ sourceType: "harvard_official", trustTier: 1 })],
        }),
        claim({
          id: "b",
          fieldKey: field.key,
          value: "Editor",
          assertionKind: "editorial",
          evidence: [ev({ sourceType: "editorial", trustTier: 0 })],
        }),
      ],
      NOW,
    );
    expect(r.current?.value).toBe("Editor");
    expect(r.conflict).toBe(false);
  });

  it("ignores retracted and expired claims", () => {
    const r = resolveField(
      field,
      [
        claim({ id: "a", fieldKey: field.key, value: "Retracted", status: "retracted" }),
        claim({ id: "b", fieldKey: field.key, value: "Expired", validUntil: new Date("2026-01-01") }),
      ],
      NOW,
    );
    expect(r.current).toBeNull();
  });

  it("corroboration from independent sources raises confidence", () => {
    const single = resolveField(field, [claim({ id: "a", fieldKey: field.key, value: "X" })], NOW);
    const double = resolveField(
      field,
      [claim({ id: "a", fieldKey: field.key, value: "X", evidence: [ev({ sourceId: "s1" }), ev({ sourceId: "s2" })] })],
      NOW,
    );
    expect(double.current!.confidence).toBeGreaterThan(single.current!.confidence);
  });
});

describe("resolveField (multi)", () => {
  it("unions and dedupes by normalized value", () => {
    const f = getField("club.link");
    const r = resolveField(
      f,
      [
        claim({
          id: "a",
          fieldKey: f.key,
          value: { kind: "website", url: "https://club.org" },
          normalizedValue: { kind: "website", url: "https://club.org" },
        }),
        claim({
          id: "b",
          fieldKey: f.key,
          value: { kind: "website", url: "https://club.org/" },
          normalizedValue: { kind: "website", url: "https://club.org" },
        }),
        claim({
          id: "c",
          fieldKey: f.key,
          value: { kind: "instagram", url: "https://instagram.com/club" },
          normalizedValue: { kind: "instagram", url: "https://instagram.com/club" },
        }),
      ],
      NOW,
    );
    expect(r.values).toHaveLength(2);
  });
});

describe("field registry", () => {
  it("validates and normalizes values", () => {
    expect(parseFieldValue("club.link", { kind: "website", url: "https://WWW.Club.org/?utm_source=x" })).toMatchObject({
      ok: true,
      normalized: { kind: "website", url: "https://club.org" },
    });
    expect(parseFieldValue("club.member_count", { kind: "range", min: 50, max: 10 }).ok).toBe(false);
    expect(parseFieldValue("club.nope", 1).ok).toBe(false);
  });
  it("every field has a schema and subject type", () => {
    for (const f of Object.values(FIELDS)) {
      expect(f.schema).toBeDefined();
      expect(["club", "recruiting_cycle"]).toContain(f.subjectType);
    }
  });
});

describe("recruiting cycle status", () => {
  const d = (at: string) => ({ at, precision: "date" as const });
  it("open when opened and before deadline (date-only deadline ends at campus midnight)", () => {
    expect(computeCycleStatus({ opensAt: d("2026-09-01"), deadline: d("2026-09-30"), statedStatus: null }, NOW)).toBe(
      "open",
    );
  });
  it("closed after deadline", () => {
    expect(computeCycleStatus({ opensAt: null, deadline: d("2026-09-29"), statedStatus: null }, NOW)).toBe("closed");
  });
  it("upcoming before open", () => {
    expect(computeCycleStatus({ opensAt: d("2026-10-05"), deadline: d("2026-10-20"), statedStatus: null }, NOW)).toBe(
      "upcoming",
    );
  });
  it("deadline_ahead when only a future deadline is known (no inferred 'open')", () => {
    expect(computeCycleStatus({ opensAt: null, deadline: d("2026-10-20"), statedStatus: null }, NOW)).toBe(
      "deadline_ahead",
    );
  });
  it("unknown without dates", () => {
    expect(computeCycleStatus({ opensAt: null, deadline: null, statedStatus: null }, NOW)).toBe("unknown");
  });
  it("date-only deadline on the same day is still open late evening campus time", () => {
    const lateEvening = new Date("2026-10-01T03:30:00Z"); // 23:30 EDT on Sep 30
    expect(computeCycleStatus({ opensAt: null, deadline: d("2026-09-30"), statedStatus: null }, lateEvening)).toBe(
      "deadline_ahead",
    );
  });
});

describe("selectivity", () => {
  it("computes a rate only from valid stated counts", () => {
    expect(computeAcceptanceRate(120, 20)).toBeCloseTo(0.1667, 3);
    expect(computeAcceptanceRate(null, 20)).toBeNull();
    expect(computeAcceptanceRate(10, 20)).toBeNull();
    expect(computeAcceptanceRate(0, 0)).toBeNull();
  });
  it("derives a label only with enough applicants", () => {
    expect(deriveSelectivityLabel(120, 20)).toBe("selective");
    expect(deriveSelectivityLabel(200, 10)).toBe("highly_selective");
    expect(deriveSelectivityLabel(5, 1)).toBeNull();
    expect(deriveSelectivityLabel(null, null)).toBeNull();
  });
});

describe("resolver audit (ADR 0033)", () => {
  const official = (over: Partial<EvidenceInput> = {}) =>
    ev({ sourceId: "club-site", sourceType: "club_website", trustTier: 2, ...over });
  const wikipedia = (over: Partial<EvidenceInput> = {}) =>
    ev({
      sourceId: "wiki",
      sourceType: "public_web",
      trustTier: 8,
      confidence: 0.45,
      sourceUrl: "https://en.wikipedia.org/wiki/X",
      ...over,
    });

  it("does not let a freshly re-crawled Wikipedia article outrank the club's current page", () => {
    // Both observed this month: when a page was fetched is not when its fact applied.
    const r = resolveField(
      getField("club.member_count"),
      [
        claim({
          id: "w",
          fieldKey: "club.member_count",
          value: { kind: "exact", count: 35 },
          evidence: [wikipedia({ observedAt: new Date("2026-09-25T00:00:00Z") })],
        }),
        claim({
          id: "o",
          fieldKey: "club.member_count",
          value: { kind: "exact", count: 50 },
          evidence: [official({ observedAt: new Date("2026-09-10T00:00:00Z") })],
        }),
      ],
      NOW,
    );
    expect(r.current?.claimId).toBe("o");
    // Priority fields never let a lower tier win on recency either.
    const d = resolveField(
      getField("club.short_description"),
      [
        claim({
          id: "w",
          fieldKey: "club.short_description",
          value: "Wiki text",
          evidence: [wikipedia({ observedAt: NOW })],
        }),
        claim({
          id: "o",
          fieldKey: "club.short_description",
          value: "Club text",
          evidence: [official({ observedAt: new Date("2026-03-01T00:00:00Z") })],
        }),
      ],
      NOW,
    );
    expect(d.current?.claimId).toBe("o");
  });

  it("favors newer evidence when it is genuinely newer (a stated as-of date or a later window)", () => {
    const r = resolveField(
      getField("club.member_count"),
      [
        claim({
          id: "old",
          fieldKey: "club.member_count",
          value: { kind: "exact", count: 35 },
          evidence: [official({ observedAt: new Date("2025-01-10T00:00:00Z") })],
        }),
        claim({
          id: "new",
          fieldKey: "club.member_count",
          value: { kind: "exact", count: 50 },
          evidence: [wikipedia({ observedAt: new Date("2026-09-20T00:00:00Z") })],
        }),
      ],
      NOW,
    );
    expect(r.current?.claimId).toBe("new");
  });

  it("does not let a stale recruiting deadline win over a fresh one, and drops expired ones", () => {
    const f = getField("cycle.deadline");
    const r = resolveField(
      f,
      [
        claim({
          id: "stale",
          fieldKey: "cycle.deadline",
          value: { at: "2026-09-05", precision: "date" },
          evidence: [official({ observedAt: new Date("2026-05-01T00:00:00Z") })],
        }),
        claim({
          id: "fresh",
          fieldKey: "cycle.deadline",
          value: { at: "2026-09-12", precision: "date" },
          evidence: [official({ sourceId: "form", observedAt: new Date("2026-09-25T00:00:00Z") })],
        }),
        claim({
          id: "expired",
          fieldKey: "cycle.deadline",
          value: { at: "2026-09-20", precision: "date" },
          validUntil: new Date("2026-09-01T00:00:00Z"),
          evidence: [official({ sourceId: "x", observedAt: NOW })],
        }),
      ],
      NOW,
    );
    expect(r.current?.claimId).toBe("fresh");
    expect(r.alternatives.map((a) => a.claimId)).not.toContain("expired");
  });

  it("resolves conflicts the same way whatever order the claims arrive in", () => {
    const f = getField("club.member_count");
    const cs = [
      claim({
        id: "b",
        fieldKey: "club.member_count",
        value: { kind: "exact", count: 40 },
        evidence: [official({ sourceId: "p2" })],
      }),
      claim({
        id: "a",
        fieldKey: "club.member_count",
        value: { kind: "exact", count: 45 },
        evidence: [official({ sourceId: "p1" })],
      }),
      claim({
        id: "c",
        fieldKey: "club.member_count",
        value: { kind: "exact", count: 41 },
        evidence: [official({ sourceId: "p3" })],
      }),
    ];
    const winners = [cs, [...cs].reverse(), [cs[1]!, cs[2]!, cs[0]!]].map(
      (order) => resolveField(f, order, NOW).current?.claimId,
    );
    expect(new Set(winners).size).toBe(1);
    expect(resolveField(f, cs, NOW).conflict).toBe(true);
  });

  it("never shows a rejected fact, and keeps every observation of the winner", () => {
    const f = getField("club.short_description");
    const rejected = claim({
      id: "r",
      fieldKey: "club.short_description",
      value: "Junk",
      status: "rejected",
      evidence: [official({ observedAt: NOW })],
    });
    const kept = claim({
      id: "k",
      fieldKey: "club.short_description",
      value: "Good",
      evidence: [
        official({ observedAt: new Date("2025-02-01T00:00:00Z") }),
        ev({
          sourceId: "dir",
          sourceType: "harvard_official",
          trustTier: 1,
          observedAt: new Date("2024-02-01T00:00:00Z"),
        }),
      ],
    });
    const input = [rejected, kept];
    const r = resolveField(f, input, NOW);
    expect(r.current?.claimId).toBe("k");
    expect(r.alternatives).toHaveLength(0);
    // Historical evidence stays attached: both sources, oldest included.
    expect(r.current?.sources.map((s) => s.sourceId).sort()).toEqual(["club-site", "dir"]);
    // The resolver is pure: the rejected claim is still in the input, untouched.
    expect(input[0]?.status).toBe("rejected");
  });
});

describe("member count: the club's own pages first (ADR 0044 amendment)", () => {
  const field = getField("club.member_count");
  const official = (id: string, count: number, at: string) =>
    claim({
      id,
      fieldKey: "club.member_count",
      value: { kind: "range", min: count, max: null },
      evidence: [ev({ sourceId: id, sourceType: "harvard_official", trustTier: 1, observedAt: new Date(at) })],
    });
  const own = (id: string, count: number, at: string) =>
    claim({
      id,
      fieldKey: "club.member_count",
      value: { kind: "range", min: count, max: null },
      evidence: [ev({ sourceId: id, observedAt: new Date(at) })],
    });

  it("beats a Harvard directory seen in the same window", () => {
    const r = resolveField(
      field,
      [official("dir", 700, "2026-09-28T00:00:00Z"), own("site", 400, "2026-09-29T00:00:00Z")],
      NOW,
    );
    expect(r.current?.claimId).toBe("site");
  });

  it("still loses to a newer stated count", () => {
    const newer = { ...official("dir", 700, "2026-09-28T00:00:00Z"), asOfDate: new Date("2026-09-20T00:00:00Z") };
    const older = { ...own("site", 400, "2026-09-29T00:00:00Z"), asOfDate: new Date("2025-09-01T00:00:00Z") };
    expect(resolveField(field, [older, newer], NOW).current?.claimId).toBe("dir");
  });

  it("doesn't apply to fields without the flag", () => {
    const f = getField("club.hours_per_week");
    expect(f.ownSourceFirst).toBeFalsy();
  });
});

describe("club name after a merge: the survivor's own name first (resolver-v9, ADR 0019 amendment)", () => {
  const field = getField("club.name");
  const SURVIVOR = "club-survivor";
  const ABSORBED = "club-absorbed";
  const soco = (id: string, value: string, subjectId: string) =>
    claim({
      id,
      subjectId,
      fieldKey: "club.name",
      value,
      normalizedValue: value.toLowerCase(),
      evidence: [ev({ sourceId: `soco-${id}`, sourceType: "harvard_official", trustTier: 1 })],
    });
  const own = (id: string, value: string) =>
    claim({ id, subjectId: SURVIVOR, fieldKey: "club.name", value, normalizedValue: value.toLowerCase() });

  it("keeps the survivor's own name over a higher-tier name made about the absorbed listing", () => {
    const claims = [own("a", "ApiChorus A Cappella"), soco("b", "ApiChorus: Hillel A Capella Group", ABSORBED)];
    expect(resolveField(field, claims, NOW, SURVIVOR).current?.value).toBe("ApiChorus A Cappella");
    // Without the subject (pre-v9 behavior) the tier-1 listing would win.
    expect(resolveField(field, claims, NOW).current?.value).toBe("ApiChorus: Hillel A Capella Group");
  });

  it("still ranks the survivor's own claims among themselves by tier", () => {
    const claims = [
      own("a", "Leaders"),
      soco("b", "Leaders! Program", SURVIVOR),
      soco("c", "PBHA's LEADERS! Summer Program", ABSORBED),
    ];
    expect(resolveField(field, claims, NOW, SURVIVOR).current?.value).toBe("Leaders! Program");
  });

  it("falls back to the absorbed club's name when the survivor has none", () => {
    const claims = [soco("b", "Southie After School", ABSORBED)];
    expect(resolveField(field, claims, NOW, SURVIVOR).current?.value).toBe("Southie After School");
  });

  it("ignores a rejected own name when choosing the pool", () => {
    const claims = [{ ...own("a", "Wrong Name"), status: "rejected" as const }, soco("b", "Right Name", ABSORBED)];
    expect(resolveField(field, claims, NOW, SURVIVOR).current?.value).toBe("Right Name");
  });

  it("keeps the absorbed listing's names as aliases, without the displayed name or duplicates", () => {
    const claims = [
      own("a", "BRYE Summer"),
      soco("b", "PBHA's Boston Refugee Youth Enrichment Summer Program", ABSORBED),
      soco("c", "PBHA’s Boston Refugee Youth Enrichment Summer Program", ABSORBED),
      soco("d", "BRYE Summer", ABSORBED),
    ];
    const aliases = absorbedNameAliases(field, claims, NOW, SURVIVOR).map((a) => a.value);
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatch(/Boston Refugee Youth Enrichment/);
  });

  it("yields no aliases when the absorbed name is the one displayed", () => {
    const claims = [soco("b", "Southie After School", ABSORBED)];
    expect(absorbedNameAliases(field, claims, NOW, SURVIVOR)).toEqual([]);
  });

  it("applies only to fields with the flag", () => {
    expect(getField("club.name").survivorFirst).toBe(true);
    expect(getField("club.short_description").survivorFirst).toBeFalsy();
  });
});
