import { describe, expect, it } from "vitest";
import { nextChanceShort } from "./compare-summary";
import { rowNextText } from "./row-status";

const day = () => "Sep 9";
const closed = {
  status: "closed" as const,
  termKey: "2026-fall",
  deadline: { at: "2026-09-09", precision: "date" as const },
};
const now = new Date("2026-10-12T12:00:00-04:00");
const base = { cycle: null, seasons: [] as never[], openAccess: false, later: null };

describe("rowNextText", () => {
  it("says what closed and when the club next recruits", () => {
    expect(rowNextText({ ...base, cycle: closed, seasons: ["spring"] }, now, day)).toBe(
      "Closed Sep 9 · next round likely in spring",
    );
  });
  it("shows the next chance alone for a club whose only evidence is a past pattern", () => {
    expect(rowNextText({ ...base, seasons: ["spring"] }, now, day)).toBe("Next round likely in spring");
  });
  it("says only what closed when no pattern points anywhere", () => {
    expect(rowNextText({ ...base, cycle: closed }, now, day)).toBe("Closed Sep 9");
  });
  it("drops old closures and says nothing when nothing is known", () => {
    expect(rowNextText({ ...base, cycle: closed }, new Date("2027-03-01T00:00:00Z"), day)).toBeNull();
    expect(rowNextText(base, now, day)).toBeNull();
  });
  it("leaves live rounds and open membership to their own pills", () => {
    expect(rowNextText({ ...base, cycle: { ...closed, status: "open" }, seasons: ["spring"] }, now, day)).toBeNull();
    expect(rowNextText({ ...base, openAccess: true, seasons: ["spring"] }, now, day)).toBeNull();
  });
  it("names a round the club announced for a later term", () => {
    expect(
      rowNextText(
        { ...base, later: { termKey: "2027-fall", processTypes: ["audition"] }, seasons: ["spring"] },
        now,
        day,
      ),
    ).toBe("Next auditions: Fall 2027");
  });
  it("agrees with the profile and compare wording (same decision as nextChanceShort)", () => {
    const input = { ...base, seasons: ["fall", "spring"] as ("fall" | "spring")[] };
    expect(rowNextText(input, now, day)).toBe(nextChanceShort(input, now, day));
  });
});
