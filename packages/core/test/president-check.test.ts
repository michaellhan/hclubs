import { describe, expect, it } from "vitest";
import { DuesValue, dedupeNearDuplicates, normalizeUrl, withoutTrackingParams } from "../src";

/** A club president checked live profiles against the clubs' own sites (2026-10-13). */

describe("a Google Form's editor address is shown as the form", () => {
  it("rewrites /edit to /viewform for display only", () => {
    const edit = "https://docs.google.com/forms/d/1yJ7NH6ZNb96LaqJcY03_o7kA1M1VQonbV9ePJWK3tdU/edit";
    expect(withoutTrackingParams(edit)).toBe(
      "https://docs.google.com/forms/d/1yJ7NH6ZNb96LaqJcY03_o7kA1M1VQonbV9ePJWK3tdU/viewform",
    );
    expect(withoutTrackingParams("https://docs.google.com/forms/d/e/abc_D-1/edit?usp=sharing")).toBe(
      "https://docs.google.com/forms/d/e/abc_D-1/viewform",
    );
    // Stored identity is unchanged.
    expect(normalizeUrl(edit)).toBe(edit);
  });
  it("leaves Docs and Sheets editor links and other hosts alone", () => {
    for (const u of [
      "https://docs.google.com/document/d/abc/edit",
      "https://docs.google.com/spreadsheets/d/abc/edit",
      "https://example.org/forms/d/abc/edit",
    ])
      expect(withoutTrackingParams(u)).toBe(u);
  });
});

describe("activity lists of the same event kinds fold (resolver-v22)", () => {
  const shown = (v: string[]) => dedupeNearDuplicates(v).map((i) => v[i]);
  it("keeps one of HCS's two lines", () => {
    expect(shown(["Workshops, talks, and socials", "Workshops and faculty talks"])).toEqual([
      "Workshops, talks, and socials",
    ]);
  });
  it("keeps lines that share event kinds but say different things", () => {
    expect(shown(["Coding workshops for beginners", "Design workshops for beginners"])).toHaveLength(2);
    expect(shown(["Weekly rehearsals and concerts", "Weekly rehearsals and tours"])).toHaveLength(2);
  });
});

describe("dues can say what the amount covers", () => {
  it("accepts an optional period", () => {
    expect(DuesValue.parse({ hasDues: true, amountUsd: 20, period: "6 months" }).period).toBe("6 months");
    expect(DuesValue.parse({ hasDues: true, amountUsd: 20 }).period).toBeUndefined();
  });
});
