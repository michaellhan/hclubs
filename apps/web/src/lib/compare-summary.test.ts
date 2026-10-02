import { describe, expect, it } from "vitest";
import { compareSummary, listNames, nextChanceText, type SummaryClub } from "./compare-summary";

const now = new Date("2026-10-01T12:00:00-04:00");
const club = (name: string, over: Partial<SummaryClub> = {}): SummaryClub => ({
  name,
  joinModes: [],
  hours: null,
  seasons: [],
  cycle: null,
  firstYears: null,
  ...over,
});

describe("compareSummary", () => {
  it("states each club's facts and who doesn't publish them, without judging", () => {
    const lines = compareSummary(
      [
        club("Alpha", {
          joinModes: ["comp"],
          cycle: { status: "closed", termKey: "2026-fall", deadline: { at: "2026-09-05", precision: "date" } },
        }),
        club("Beta", { joinModes: ["application"], hours: { min: 3, max: 5 }, seasons: ["fall"] }),
        club("Gamma"),
      ],
      now,
    );
    expect(lines).toEqual([
      "Alpha uses a comp; Beta uses an application. Gamma doesn't say how to join.",
      "Alpha's Fall 2026 recruiting closed Sep 5. Beta usually recruits in fall, with no current dates on record.",
      "Beta reports 3–5 h/week; Alpha and Gamma don't publish one.",
    ]);
    expect(lines.join(" ")).not.toMatch(/better|easier|harder|best|selective/i);
  });

  it("names open and attendance-based membership as membership, never as a process", () => {
    expect(
      compareSummary(
        [club("A", { joinModes: ["open", "attendance_based"] }), club("B", { joinModes: ["application"] })],
        now,
      )[0],
    ).toBe("A uses open, attendance-based membership; B uses an application.");
  });

  it("groups clubs that join the same way", () => {
    expect(
      compareSummary([club("A", { joinModes: ["audition"] }), club("B", { joinModes: ["audition"] })], now)[0],
    ).toBe("A and B both use an audition.");
  });

  it("says nothing for a single club", () => {
    expect(compareSummary([club("A", { joinModes: ["open"] })], now)).toEqual([]);
  });

  it("lists names naturally", () => {
    expect(listNames(["A", "B", "C"])).toBe("A, B and C");
  });

  it("names the clubs that usually recruit again next term, only when not all do", () => {
    const lines = compareSummary(
      [
        club("HUCBE", { joinModes: ["application"], seasons: ["fall", "spring"] }),
        club("HDAG", { joinModes: ["application"], seasons: ["fall"] }),
      ],
      now,
    );
    expect(lines).toContain("Only HUCBE usually recruits in spring.");
    expect(
      compareSummary([club("A", { seasons: ["spring"] }), club("B", { seasons: ["fall", "spring"] })], now).join(" "),
    ).not.toMatch(/Only/);
  });

  it("says who doesn't say about first-years when the others do", () => {
    expect(compareSummary([club("A", { firstYears: true }), club("B")], now)).toContain(
      "A takes first-years; B doesn't say.",
    );
  });
});

describe("nextChanceText", () => {
  const closedFall = {
    status: "closed" as const,
    termKey: "2026-fall",
    deadline: { at: "2026-09-05", precision: "date" as const },
  };
  it("follows the board: open round, open membership, rolling, next usual term", () => {
    expect(
      nextChanceText(
        {
          cycle: { status: "deadline_ahead", termKey: "2026-fall", deadline: { at: "2026-10-09", precision: "date" } },
          seasons: [],
        },
        now,
      ),
    ).toBe("Recruiting now · due Oct 9");
    expect(nextChanceText({ cycle: null, seasons: ["fall"], openAccess: true }, now)).toBe(
      "Join anytime (open membership)",
    );
    expect(nextChanceText({ cycle: closedFall, seasons: ["rolling"] }, now)).toBe("Recruits on a rolling basis");
    expect(nextChanceText({ cycle: closedFall, seasons: ["fall", "spring"] }, now)).toBe(
      "Usually recruits again in Spring",
    );
    expect(nextChanceText({ cycle: null, seasons: ["fall"] }, now)).toBe("Usually recruits this fall; no dates yet");
    expect(nextChanceText({ cycle: closedFall, seasons: ["fall"] }, now)).toBeNull();
    expect(nextChanceText({ cycle: null, seasons: [] }, now)).toBeNull();
  });

  it("looks to fall from spring", () => {
    expect(nextChanceText({ cycle: null, seasons: ["fall"] }, new Date("2027-03-01T12:00:00-05:00"))).toBe(
      "Usually recruits again in Fall",
    );
  });
});
