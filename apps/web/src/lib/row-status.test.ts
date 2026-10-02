import { describe, expect, it } from "vitest";
import { closedRowText } from "./row-status";

const day = () => "Sep 9";
const cycle = { termKey: "2026-fall", deadline: { at: "2026-09-09", precision: "date" as const } };
const now = new Date("2026-10-02T12:00:00Z");

describe("closedRowText", () => {
  it("says what closed", () => expect(closedRowText(cycle, [], now, day)).toBe("Closed Sep 9"));
  it("adds the usual other season", () =>
    expect(closedRowText(cycle, ["spring"], now, day)).toBe("Closed Sep 9 · usually Spring"));
  it("does not say 'usually' when the closed season is also usual", () =>
    expect(closedRowText(cycle, ["fall", "spring"], now, day)).toBe("Closed Sep 9"));
  it("never says usually rolling", () => expect(closedRowText(cycle, ["rolling"], now, day)).toBe("Closed Sep 9"));
  it("drops old closures and undated ones", () => {
    expect(closedRowText(cycle, [], new Date("2027-03-01T00:00:00Z"), day)).toBeNull();
    expect(closedRowText({ ...cycle, deadline: null }, [], now, day)).toBeNull();
  });
});
