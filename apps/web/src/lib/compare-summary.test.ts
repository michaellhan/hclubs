import { describe, expect, it } from "vitest";
import {
  NO_NEXT_ROUND,
  compareSummary,
  listNames,
  nextChanceText,
  usualRoundTerm,
  type SummaryClub,
} from "./compare-summary";

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
      "Alpha's Fall 2026 recruiting closed Sep 5. Beta usually recruits in fall, with no dates yet.",
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

  it("counts rolling recruiting as a way to join now, not as silence", () => {
    const lines = compareSummary(
      [club("HPR", { seasons: ["rolling"] }), club("B", { joinModes: ["application"], seasons: ["fall"] })],
      now,
    );
    expect(lines[0]).toBe("Can join now: HPR (recruits on a rolling basis).");
    expect(lines.join(" ")).not.toMatch(/HPR doesn't say/);
    expect(lines.join(" ")).not.toMatch(/HPR usually recruits/);
  });

  it("groups clubs that join the same way", () => {
    expect(
      compareSummary([club("A", { joinModes: ["audition"] }), club("B", { joinModes: ["audition"] })], now)[0],
    ).toBe("A and B both use an audition.");
  });

  it("names an ended club once and leaves it out of the other sentences", () => {
    const lines = compareSummary(
      [
        club("Council", { joinModes: ["application"], ended: true, firstYears: true }),
        club("Dins", { joinModes: ["audition"] }),
      ],
      now,
    );
    expect(lines[0]).toBe("Council is no longer active.");
    expect(lines.slice(1).join(" ")).not.toContain("Council");
  });

  it("says nothing for a single club", () => {
    expect(compareSummary([club("A", { joinModes: ["open"] })], now)).toEqual([]);
  });

  it("lists names naturally", () => {
    expect(listNames(["A", "B", "C"])).toBe("A, B and C");
  });

  it("doesn't repeat a pattern the recruiting line already states", () => {
    const lines = compareSummary(
      [
        club("HUCBE", { joinModes: ["application"], seasons: ["fall", "spring"] }),
        club("HDAG", { joinModes: ["application"], seasons: ["fall"] }),
      ],
      now,
    );
    expect(lines.join(" ")).toContain("HUCBE usually recruits in fall and spring");
    expect(lines.join(" ")).not.toMatch(/also usually|Only/);
  });

  it("names a club with a closed round that usually recruits again next term", () => {
    const closed = { status: "closed" as const, termKey: "2026-fall", deadline: null };
    const lines = compareSummary(
      [club("A", { cycle: closed, seasons: ["fall", "spring"] }), club("B", { cycle: closed, seasons: ["fall"] })],
      now,
    );
    expect(lines).toContain("A also usually recruits in spring.");
  });

  it("uses an announced later round instead of the usual seasons or 'doesn't say'", () => {
    const lines = compareSummary(
      [
        club("Pitches", {
          joinModes: ["audition"],
          seasons: ["spring"],
          later: { termKey: "2027-fall", processTypes: ["audition"] },
        }),
        club("HCDU", {
          joinModes: ["application"],
          later: { termKey: "2027-spring", processTypes: [] },
        }),
      ],
      now,
    );
    const text = lines.join(" ");
    expect(text).toContain("Pitches (next auditions: Fall 2027)");
    expect(text).toContain("HCDU (next applications: Spring 2027)");
    expect(text).not.toMatch(/usually recruits|don't say when|doesn't say when/);
  });

  it("says a club has no comp without naming a source", () => {
    const lines = compareSummary([club("A", { joinModes: ["audition"] }), club("B", { noComp: true })], now);
    expect(lines[0]).toBe("A uses an audition. B has no comp.");
    expect(lines.join(" ")).not.toMatch(/directory/i);
  });

  it("says who doesn't say about first-years when the others do", () => {
    expect(compareSummary([club("A", { firstYears: true }), club("B")], now)).toContain(
      "A takes first-years; B doesn't say.",
    );
  });
});

describe("nextChanceText", () => {
  const early = new Date("2026-09-20T12:00:00-04:00");
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
      "Usually recruits again in Spring 2027",
    );
    expect(nextChanceText({ cycle: null, seasons: ["fall"] }, early)).toBe("Usually recruits this fall; no dates yet");
    expect(nextChanceText({ cycle: closedFall, seasons: ["fall"] }, early)).toBe("Usually recruits again in Fall 2027");
    expect(nextChanceText({ cycle: closedFall, seasons: ["fall"] }, now)).toBe("Usually recruits again in Fall 2027");
    expect(nextChanceText({ cycle: closedFall, seasons: ["fall", "spring"] }, early)).toBe(
      "Usually recruits again in Spring 2027",
    );
    expect(nextChanceText({ cycle: null, seasons: [] }, now)).toBeNull();
    expect(nextChanceText({ cycle: closedFall, seasons: [] }, now)).toBe(NO_NEXT_ROUND);
  });

  it("from Oct 1 a fall pattern with no round on record says the next round, not 'this fall'", () => {
    // The Crimson on Oct 4, 2026: fall and spring pattern, no dated round.
    const oct4 = new Date("2026-10-04T12:00:00-04:00");
    expect(nextChanceText({ cycle: null, seasons: ["fall", "spring"] }, oct4)).toBe(
      "Next round likely in Spring 2027",
    );
    expect(nextChanceText({ cycle: null, seasons: ["fall", "spring"] }, early)).toBe(
      "Usually recruits this fall; no dates yet",
    );
    expect(nextChanceText({ cycle: null, seasons: ["fall"] }, oct4)).toBe(
      "Next round likely in Fall 2027",
    );
    // An earlier term's closed round isn't this term's: the pattern still speaks.
    const lastFall = {
      ...closedFall,
      termKey: "2025-fall",
      deadline: { at: "2025-09-05", precision: "date" as const },
    };
    expect(nextChanceText({ cycle: lastFall, seasons: ["fall", "spring"] }, oct4)).toBe(
      "Next round likely in Spring 2027",
    );
  });

  it("in summer, points to fall (summer is never 'this term's round')", () => {
    const june = new Date("2027-06-15T12:00:00-04:00");
    const july = new Date("2027-07-20T12:00:00-04:00");
    expect(nextChanceText({ cycle: null, seasons: ["summer", "fall"] }, june)).toBe(
      "Next round likely in Fall 2027",
    );
    expect(nextChanceText({ cycle: null, seasons: ["summer", "fall"] }, july)).toBe(
      "Next round likely in Fall 2027",
    );
    expect(nextChanceText({ cycle: null, seasons: ["fall"] }, july)).toBe("Usually recruits again in Fall 2027");
    expect(nextChanceText({ cycle: null, seasons: ["summer"] }, july)).toBeNull();
  });

  it("looks to fall from spring", () => {
    expect(nextChanceText({ cycle: null, seasons: ["fall"] }, new Date("2027-03-01T12:00:00-05:00"))).toBe(
      "Usually recruits again in Fall 2027",
    );
  });
});

describe("nextChanceText with an announced later round (ADR 0051 amendment)", () => {
  const oct12 = new Date("2026-10-12T12:00:00-04:00");
  it("outranks the usual seasons", () => {
    expect(
      nextChanceText(
        {
          cycle: null,
          seasons: ["fall", "spring"],
          openAccess: false,
          later: { termKey: "2027-fall", processTypes: [] },
          joinModes: ["audition"],
        },
        oct12,
      ),
    ).toBe("Next auditions: Fall 2027");
  });
  it("says no cuts when the announced round's own facts say so", () => {
    const later = { termKey: "2027-spring", processTypes: ["comp"] as const, noCuts: true };
    expect(nextChanceText({ cycle: null, seasons: [], openAccess: false, later }, oct12)).toBe(
      "Next comp: Spring 2027, no cuts",
    );
  });
  it("never outranks open membership or a live round", () => {
    const later = { termKey: "2027-fall", processTypes: [] };
    expect(nextChanceText({ cycle: null, seasons: [], openAccess: true, later }, oct12)).toBe(
      "Join anytime (open membership)",
    );
  });
});

describe("compareSummary closed round with an announced next one", () => {
  it("says when to try again", () => {
    const lines = compareSummary(
      [
        club("HCDU", {
          joinModes: ["comp"],
          cycle: { status: "closed", termKey: "2026-fall", deadline: { at: "2026-09-12", precision: "date" } },
          later: { termKey: "2027-spring", processTypes: ["comp"] },
        }),
        club("Other"),
      ],
      now,
    );
    expect(lines.join(" ")).toContain("HCDU's Fall 2026 recruiting closed Sep 12; next comp: Spring 2027");
  });
});

describe("compareSummary: round 5 (who can join now first)", () => {
  const oct = new Date("2026-10-13T12:00:00-04:00");
  it("leads with who can be joined now and groups the clubs that join the same way", () => {
    const lines = compareSummary(
      [
        club("Kuumba", { joinModes: ["open"], openAccess: true }),
        club("HRO", { joinModes: ["audition"], seasons: ["fall"] }),
        club("Pitches", { joinModes: ["audition"], later: { termKey: "2027-fall", processTypes: ["audition"] } }),
        club("Band", { joinModes: ["open", "audition"], openAccess: true, noCuts: true, seasons: ["fall"] }),
      ],
      oct,
    );
    expect(lines[0]).toBe("Can join now: Kuumba (open membership); Band (open membership, an audition with no cuts).");
    expect(lines[1]).toBe("HRO and Pitches both use an audition.");
    expect(lines[2]).toBe("Pitches (next auditions: Fall 2027); HRO usually recruits in fall.");
    expect(lines.join(" ")).not.toMatch(/uses an audition; .* uses an audition/);
  });

  it("names a live round among those that can be joined now, once", () => {
    const lines = compareSummary(
      [
        club("A", {
          joinModes: ["comp"],
          cycle: { status: "open", termKey: "2026-fall", deadline: { at: "2026-10-20", precision: "date" } },
        }),
        club("B", { joinModes: ["comp"] }),
      ],
      oct,
    );
    expect(lines[0]).toBe("Can join now: A (applications due Oct 20).");
    expect(lines.join(" ")).not.toContain("A is recruiting");
  });

  it("says when a club last recruited, as history (HIA)", () => {
    const last = { termKey: "2026-spring", processTypes: [] };
    const lines = compareSummary([club("HIA", { joinModes: ["comp"], last }), club("B")], oct);
    expect(lines.join(" ")).toContain("No dates yet; HIA (last comp: Spring 2026).");
    expect(
      nextChanceText({ cycle: null, seasons: [], openAccess: false, later: null, joinModes: ["comp"], last }, oct),
    ).toBe("Last comp: Spring 2026; no next round known");
  });
});

describe("usualRoundTerm", () => {
  it("names the term, not 'next fall'", () => {
    const oct = new Date("2026-10-13T12:00:00-04:00");
    const mar = new Date("2027-03-15T12:00:00-04:00");
    const jul = new Date("2027-07-20T12:00:00-04:00");
    expect(usualRoundTerm({ season: "fall", nextYear: true }, oct)).toBe("Fall 2027");
    expect(usualRoundTerm({ season: "spring", nextYear: false }, oct)).toBe("Spring 2027");
    expect(usualRoundTerm({ season: "fall", nextYear: false }, mar)).toBe("Fall 2027");
    expect(usualRoundTerm({ season: "spring", nextYear: true }, mar)).toBe("Spring 2028");
    expect(usualRoundTerm({ season: "fall", nextYear: false }, jul)).toBe("Fall 2027");
    expect(usualRoundTerm({ season: "spring", nextYear: true }, jul)).toBe("Spring 2028");
  });
});
