import { describe, expect, it } from "vitest";
import { dedupeNearDuplicates, restates } from "../src";

const shown = (v: string[]) => dedupeNearDuplicates(v).map((i) => v[i]);

describe("dedupeNearDuplicates", () => {
  it("folds synonyms and number phrasings", () => {
    expect(shown(["Spring vacation tour in Bermuda", "Spring break tour in Bermuda"])).toEqual([
      "Spring vacation tour in Bermuda",
    ]);
    expect(shown(["Performing more than 200 concerts annually", "Performing 200+ concerts annually"])).toHaveLength(1);
  });
  it("keeps the fuller value when one is contained in another", () => {
    expect(
      shown([
        "Recording albums",
        "Recording albums and videos",
        "Recording albums and videos, and performing 200+ concerts annually",
      ]),
    ).toEqual(["Recording albums and videos, and performing 200+ concerts annually"]);
  });
  it("keeps distinct activities and never lets a one-word value swallow others", () => {
    const v = [
      "Annual Winter Tour in January",
      "Recording albums and videos",
      "Tour",
      "Television and radio performances",
    ];
    expect(shown(v)).toEqual(v);
  });
});

describe("restates (retiring LLM paraphrases, 2026-10-12)", () => {
  it("treats a contained or reworded value as a restatement", () => {
    expect(restates("Yearly UN trip", "Yearly trip to the UN")).toBe(true);
    expect(restates("Publishes an Arts section on Tuesdays", "Publishing an Arts section on Tuesdays")).toBe(true);
    expect(
      restates(
        "Weekly meetings Fridays 3:30-5:30 in Boston's Chinatown",
        "Program meets Fridays 3:30-5:30 in Boston's Chinatown",
      ),
    ).toBe(true);
  });
  it("never retires the fuller wording or a different activity", () => {
    expect(restates("Black Legacy Ball, a February celebration of Black History Month", "Black Legacy Ball")).toBe(
      false,
    );
    expect(restates("Low-cost stethoscope", "Midpoint design presentations and final showcases")).toBe(false);
    expect(restates("Industry talks", "Workshops and faculty talks")).toBe(false);
    expect(restates("Tour", "Annual Winter Tour in January")).toBe(false);
    expect(restates("Starboy Pageant", "Annual Pageant and Gala")).toBe(false);
  });
});

// resolver-v18 (student testing round 3): repeated "What they do" lines.
describe("dedupeNearDuplicates: same activity in other words (resolver-v18)", () => {
  const shown = (values: string[]) => dedupeNearDuplicates(values).map((i) => values[i]);
  it("one line per named program before a colon, the fuller one", () => {
    const out = shown([
      "Startup Series: biweekly discussion of an up-and-coming startup, typically with a guest speaker Q&A",
      "Startup Series: exploring an up-and-coming startup with founder and operator Q&A",
      "Startup Trek: annual trip to visit high-growth tech startups and ecosystems",
      "Startup Trek: fully funded five-day trip to New York City",
      "10-K Reading Club analyzing annual reports of publicly-traded companies",
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toContain("biweekly discussion");
  });
  it("lines one generic noun apart, and a line mostly inside a fuller one", () => {
    expect(
      shown(["Technical theater staff positions", "Technical theater staff roles", "Technical theater staff work"]),
    ).toHaveLength(1);
    expect(
      shown([
        "Custom arrangements by members and friends",
        "Original arrangements for the group by current and previous members and friends of the group",
      ]),
    ).toEqual(["Original arrangements for the group by current and previous members and friends of the group"]);
  });
  it("keeps different activities that share words", () => {
    expect(shown(["Hosting speaker events on finance", "Hosting speaker events on tech"])).toHaveLength(2);
    expect(shown(["Fall concert in Sanders", "Spring concert in Sanders"])).toHaveLength(2);
    expect(
      shown(["Charity fundraisers and benefit concerts", "Fundraising and benefit concerts for nonprofits"]),
    ).toHaveLength(2);
  });
});
