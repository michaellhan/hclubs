import { describe, expect, it } from "vitest";
import {
  nextStepText,
  openJoinLinkText,
  openJoinTarget,
  primaryProcess,
  startedProfileText,
  type CycleStatus,
  type DateValue,
  type JoinMode,
} from "../src";

/** Next-step wording on the recruiting board: the process's own verb, never an invented time. */
const fmt = (d: DateValue) => (d.precision === "date" ? d.at : `${d.at} (timed)`);
const step = (
  status: CycleStatus,
  c: { opens?: DateValue | null; deadline?: DateValue | null; processTypes?: JoinMode[] },
  clubModes: JoinMode[] = [],
) =>
  nextStepText(
    { status, opens: c.opens ?? null, deadline: c.deadline ?? null, processTypes: c.processTypes ?? [] },
    clubModes,
    fmt,
  );
const day = (at: string): DateValue => ({ at, precision: "date" });
const timed = (at: string): DateValue => ({ at, precision: "datetime" });

describe("primaryProcess", () => {
  it("prefers the cycle's own process, then the club's", () => {
    expect(primaryProcess(["comp"], ["application"])).toBe("comp");
    expect(primaryProcess([], ["audition", "open"])).toBe("audition");
    expect(primaryProcess([], ["open"])).toBeNull();
  });
  it("names the application when a club both applies and comps", () => {
    expect(primaryProcess(["comp", "application"])).toBe("application");
  });
});

describe("nextStepText", () => {
  it("phrases a deadline by process", () => {
    expect(step("deadline_ahead", { deadline: day("2026-10-09"), processTypes: ["application"] })).toBe(
      "Apply by 2026-10-09",
    );
    expect(step("open", { deadline: day("2026-10-09"), processTypes: ["comp"] })).toBe("Comp deadline 2026-10-09");
    expect(step("open", { deadline: day("2026-10-09") }, ["tryout"])).toBe("Tryout deadline 2026-10-09");
    expect(step("open", { deadline: day("2026-10-09") })).toBe("Deadline 2026-10-09");
  });

  it("passes a date-only deadline through as a date (no invented 11:59 PM)", () => {
    expect(step("open", { deadline: day("2026-10-09") }, ["application"])).not.toMatch(/timed|PM/);
    expect(step("open", { deadline: timed("2026-10-09T23:59:00-04:00") }, ["application"])).toBe(
      "Apply by 2026-10-09T23:59:00-04:00 (timed)",
    );
  });

  it("says when an upcoming round starts, and falls back to its deadline", () => {
    expect(step("upcoming", { opens: day("2026-10-05"), processTypes: ["audition"] })).toBe(
      "Auditions start 2026-10-05",
    );
    expect(step("upcoming", { deadline: day("2027-02-01"), processTypes: ["comp"] })).toBe("Comp deadline 2027-02-01");
    // An opening after the deadline is ignored (contradictory sources).
    expect(
      step("upcoming", { opens: day("2027-03-01"), deadline: day("2027-02-01"), processTypes: ["application"] }),
    ).toBe("Apply by 2027-02-01");
  });

  it("flags a started round with no deadline, and an open one with none", () => {
    expect(step("unknown", { opens: day("2026-09-06"), processTypes: ["comp"] })).toBe(
      "Comp started 2026-09-06 · no deadline listed",
    );
    expect(step("open", {}, ["application"])).toBe("Applications open now · no deadline listed");
  });

  it("closed rounds say when they closed", () => {
    expect(step("closed", { deadline: day("2026-09-12") })).toBe("Closed 2026-09-12");
    expect(step("closed", {})).toBe("Closed");
  });
});

describe("nextStepText with no dates", () => {
  it("an upcoming round with neither date says so, not a bare 'Opens'", () => {
    expect(step("upcoming", {})).toBe("Dates not listed");
  });
});

describe("startedProfileText", () => {
  it("uses the board's started wording and says what to do about the missing end", () => {
    expect(startedProfileText({ opens: day("2026-09-06"), processTypes: ["comp"] }, [], fmt)).toBe(
      "Comp started 2026-09-06 · no end date listed, check their site",
    );
    expect(startedProfileText({ opens: day("2026-09-05"), processTypes: [] }, ["audition"], fmt)).toBe(
      "Auditions started 2026-09-05 · no end date listed, check their site",
    );
    // Board and profile agree on the prefix.
    expect(step("unknown", { opens: day("2026-09-06"), processTypes: ["comp"] })).toMatch(/^Comp started 2026-09-06/);
  });
});

describe("openJoinTarget", () => {
  const w = { kind: "website", url: "https://www.cyclingclub.org/join" };
  const ig = { kind: "instagram", url: "https://instagram.com/cyc" };
  const em = { kind: "email", url: "mailto:cyc@example.org" };
  it("prefers website, then Instagram, then email, and never invents one", () => {
    expect(openJoinTarget([ig, em, w])?.text).toBe("Visit cyclingclub.org to join");
    expect(openJoinTarget([em, ig])?.text).toBe("Join via Instagram");
    expect(openJoinTarget([em])?.text).toBe("Email to join");
    expect(openJoinTarget([{ kind: "linkedin", url: "https://linkedin.com/x" }])).toBeNull();
    expect(openJoinTarget([])).toBeNull();
  });
  it("names the destination of a featured sign-up link", () => {
    expect(openJoinLinkText("https://forms.gle/abc")).toBe("Join via sign-up form");
    expect(openJoinLinkText("https://www.pokerclub.org/signup")).toBe("Join at pokerclub.org");
    expect(openJoinLinkText("nonsense")).toBe("Join");
  });
});
