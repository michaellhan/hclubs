import { describe, expect, it } from "vitest";
import {
  computeConfidence,
  getField,
  resolveField,
  type ClaimInput,
  type EvidenceInput,
  type SourceType,
} from "../src";
import { SOURCE_TYPE_TIER } from "../src/enums";

/**
 * Realistic conflict scenarios for display-value selection (M2 §9). Each scenario keeps
 * every claim; only the displayed winner and the conflict flag are asserted.
 */
const NOW = new Date("2026-09-30T16:00:00Z");

let n = 0;
function claim(
  fieldKey: string,
  value: unknown,
  source: SourceType,
  opts: {
    observed?: string;
    asOf?: string;
    kind?: ClaimInput["assertionKind"];
    sourceId?: string;
    direct?: boolean;
  } = {},
): ClaimInput {
  const ev: EvidenceInput = {
    sourceId: opts.sourceId ?? `${source}-${n}`,
    sourceType: source,
    trustTier: SOURCE_TYPE_TIER[source],
    sourceUrl: `https://${source}.test`,
    sourceTitle: null,
    isFixture: false,
    extractionMethod: "html_parse",
    isDirect: opts.direct ?? opts.kind !== "inferred",
    confidence: computeConfidence({
      sourceType: source,
      extractionMethod: "html_parse",
      isDirect: opts.direct ?? opts.kind !== "inferred",
    }),
    observedAt: new Date(opts.observed ?? "2026-09-20"),
    quote: null,
  };
  return {
    id: `c${++n}`,
    fieldKey,
    value,
    normalizedValue: value,
    assertionKind: opts.kind ?? "stated",
    status: "active",
    termKey: null,
    validFrom: null,
    validUntil: null,
    asOfDate: opts.asOf ? new Date(opts.asOf) : null,
    evidence: [ev],
  };
}
const resolve = (key: string, claims: ClaimInput[]) => resolveField(getField(key), claims, NOW);

describe("reconciliation scenarios", () => {
  it("official Harvard source is the authority for recognition status over the club's own site", () => {
    const r = resolve("club.recognition_status", [
      claim("club.recognition_status", "not_recognized", "club_website"),
      claim("club.recognition_status", "recognized", "harvard_official", { observed: "2026-08-01" }),
    ]);
    expect(r.current?.value).toBe("recognized");
    expect(r.conflict).toBe(true); // disagreement between comparable sources is surfaced, not hidden
  });

  it("official club website beats an old Wikipedia description, without a spurious conflict", () => {
    const r = resolve("club.short_description", [
      claim("club.short_description", "A historic society founded in 1901.", "public_web", { observed: "2026-09-29" }),
      claim("club.short_description", "We build autonomous robots.", "club_website", { observed: "2026-09-01" }),
    ]);
    expect(r.current?.value).toBe("We build autonomous robots.");
    expect(r.current?.badge).toBe("verified");
    expect(r.conflict).toBe(false);
  });

  it("an old Crimson membership number does not overwrite a newer official one", () => {
    const r = resolve("club.member_count", [
      claim("club.member_count", { kind: "exact", count: 40 }, "harvard_crimson", {
        asOf: "2019-10-01",
        observed: "2026-09-25",
      }),
      claim("club.member_count", { kind: "exact", count: 64 }, "club_website", { asOf: "2026-09-01" }),
    ]);
    expect(r.current?.value).toEqual({ kind: "exact", count: 64 });
    expect(r.conflict).toBe(false); // the 2019 figure is history, not a live disagreement
  });

  it("a current recruiting page wins for deadlines over a stale directory entry", () => {
    const r = resolve("cycle.deadline", [
      claim("cycle.deadline", { at: "2026-09-26", precision: "date" }, "harvard_official", { observed: "2026-02-01" }),
      claim("cycle.deadline", { at: "2026-10-03", precision: "date" }, "club_recruiting_material", {
        observed: "2026-09-28",
      }),
    ]);
    expect(r.current?.value).toEqual({ at: "2026-10-03", precision: "date" });
  });

  it("an uncorroborated student submission shows as Community; official evidence supersedes it", () => {
    const alone = resolve("club.hours_per_week", [
      claim("club.hours_per_week", { min: 10, max: 15 }, "student_submission", { kind: "user_reported" }),
    ]);
    expect(alone.current?.badge).toBe("community");
    const both = resolve("club.hours_per_week", [
      claim("club.hours_per_week", { min: 10, max: 15 }, "student_submission", { kind: "user_reported" }),
      claim("club.hours_per_week", { min: 6, max: 8 }, "club_website"),
    ]);
    expect(both.current?.value).toEqual({ min: 6, max: 8 });
  });

  it("corroboration across independent sources increases confidence", () => {
    const single = resolve("club.join_mode", [claim("club.join_mode", "comp", "club_website", { sourceId: "a" })])
      .values[0];
    const c = claim("club.join_mode", "comp", "club_website", { sourceId: "a" });
    c.evidence = [...c.evidence, { ...c.evidence[0]!, sourceId: "b", sourceType: "harvard_official", trustTier: 1 }];
    const corroborated = resolve("club.join_mode", [c]).values[0];
    expect(corroborated!.confidence).toBeGreaterThan(single!.confidence);
  });

  it("a stated value beats an inferred one from an equally trusted source", () => {
    const r = resolve("club.org_type", [
      claim("club.org_type", "student_organization", "harvard_official", { kind: "inferred" }),
      claim("club.org_type", "competition_team", "harvard_official"),
    ]);
    expect(r.current?.value).toBe("competition_team");
  });

  it("inferred numbers are never displayed (fields that disallow inference)", () => {
    const r = resolve("club.member_count", [
      claim("club.member_count", { kind: "exact", count: 100 }, "harvard_official", { kind: "inferred" }),
    ]);
    expect(r.current).toBeNull();
  });

  it("time-sensitive facts go stale: a year-old official deadline claim is Reported, not Verified", () => {
    const r = resolve("cycle.deadline", [
      claim("cycle.deadline", { at: "2025-10-01", precision: "date" }, "club_website", { observed: "2025-09-15" }),
    ]);
    expect(r.current?.badge).toBe("reported");
    expect(r.current?.stale).toBe(true);
  });
});
