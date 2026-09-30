import { describe, expect, it } from "vitest";
import {
  FIELDS,
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
