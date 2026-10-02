import { describe, expect, it } from "vitest";
import { calendarDaysUntil, formatDateValue, relativeDateValue } from "./format";

const edt = (local: string) => new Date(`${local}-04:00`);

describe("formatDateValue", () => {
  it("omits the year only for the current campus year, for dates and times alike", () => {
    const now = edt("2026-10-01T12:00:00");
    expect(formatDateValue({ at: "2026-10-04", precision: "date" }, now)).toBe("Oct 4");
    expect(formatDateValue({ at: "2025-10-04", precision: "date" }, now)).toBe("Oct 4, 2025");
    expect(formatDateValue({ at: "2025-09-13T23:59:00-04:00", precision: "datetime" }, now)).toMatch(/^Sep 13, 2025/);
    expect(formatDateValue({ at: "2026-09-13T23:59:00-04:00", precision: "datetime" }, now)).toBe(
      "Sep 13, 11:59 PM EDT",
    );
  });
  it("uses the campus year on New Year's Eve evening", () => {
    // 9 PM Dec 31 in Boston is already Jan 1 in UTC.
    const now = new Date("2026-12-31T21:00:00-05:00");
    expect(formatDateValue({ at: "2026-12-31", precision: "date" }, now)).toBe("Dec 31");
  });
  it("never invents a time for a date-only value", () => {
    expect(formatDateValue({ at: "2026-10-04", precision: "date" }, edt("2026-10-01T12:00:00"))).not.toMatch(/PM|AM/);
  });
});

describe("relativeDateValue", () => {
  it("counts campus calendar days", () => {
    const morning = edt("2026-10-01T09:00:00");
    expect(relativeDateValue({ at: "2026-10-01T23:59:00-04:00", precision: "datetime" }, morning)).toBe("today");
    expect(relativeDateValue({ at: "2026-10-02", precision: "date" }, morning)).toBe("tomorrow");
    expect(relativeDateValue({ at: "2026-10-04", precision: "date" }, morning)).toBe("in 3 days");
    expect(relativeDateValue({ at: "2026-09-29", precision: "date" }, morning)).toBe("2 days ago");
  });
  it("is right late at night, when UTC is already tomorrow", () => {
    const lateNight = edt("2026-10-01T22:30:00");
    expect(relativeDateValue({ at: "2026-10-01", precision: "date" }, lateNight)).toBe("today");
    expect(relativeDateValue({ at: "2026-10-02T09:00:00-04:00", precision: "datetime" }, lateNight)).toBe("tomorrow");
  });
});

describe("calendarDaysUntil", () => {
  it("counts Boston calendar days, so a 5 PM deadline three days out is 3, not 3.2", () => {
    const now = new Date("2026-09-08T12:00:00-04:00");
    expect(calendarDaysUntil({ at: "2026-09-11T17:00:00-04:00", precision: "datetime" }, now)).toBe(3);
    expect(calendarDaysUntil({ at: "2026-09-08", precision: "date" }, now)).toBe(0);
    expect(calendarDaysUntil({ at: "2026-09-07", precision: "date" }, now)).toBe(-1);
  });
});
