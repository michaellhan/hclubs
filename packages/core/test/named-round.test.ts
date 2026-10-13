import { describe, expect, it } from "vitest";
import { namedRoundOver, termNamedInText } from "../src";

describe("termNamedInText", () => {
  it.each([
    ["Fill out the interest form here | The Harvard Independent Fall 2026 Comp Interest Form", "2026-fall"],
    ["Spring 2026 Comp Interest Form", "2026-spring"],
    ["Spring '26 Application", "2026-spring"],
    ["Fall Comp 2026", "2026-fall"],
    ["2026 Fall recruitment", "2026-fall"],
    ["Autumn 2025 auditions", "2025-fall"],
    ["Winter 2027 auditions", "2027-spring"],
    ["Spring 2026 recap | Fall 2026 Analyst Application", "2026-fall"],
  ])("%s → %s", (text, term) => expect(termNamedInText(text)).toBe(term));

  it.each([
    "Apply now",
    "Leadership Team Application (2025)",
    "Due January 5, 2026",
    "Fall 12 members",
    "Applications for 2024-2025",
    "Fall comp interest form",
  ])("%s names no term (no year guessed)", (text) => expect(termNamedInText(text)).toBeNull());
});

describe("namedRoundOver (injected now, America/New_York)", () => {
  it("an earlier term is over", () => {
    expect(namedRoundOver("2026-spring", new Date("2026-09-02T12:00:00Z"))).toBe(true);
    expect(namedRoundOver("2025-fall", new Date("2026-02-01T12:00:00Z"))).toBe(true);
  });
  it("a later term is not", () => {
    expect(namedRoundOver("2027-spring", new Date("2026-10-12T12:00:00Z"))).toBe(false);
  });
  it("the current fall term's round is over from October 1, New York time", () => {
    expect(namedRoundOver("2026-fall", new Date("2026-09-10T12:00:00Z"))).toBe(false);
    // 11:30 PM Sep 30 in New York is already Oct 1 in UTC: still September on campus.
    expect(namedRoundOver("2026-fall", new Date("2026-10-01T03:30:00Z"))).toBe(false);
    expect(namedRoundOver("2026-fall", new Date("2026-10-01T04:30:00Z"))).toBe(true);
    expect(namedRoundOver("2026-fall", new Date("2026-10-12T16:00:00Z"))).toBe(true);
  });
  it("the current spring term's round is over from March 1 (EST, before the DST change)", () => {
    expect(namedRoundOver("2027-spring", new Date("2027-02-15T12:00:00Z"))).toBe(false);
    expect(namedRoundOver("2027-spring", new Date("2027-03-01T04:59:00Z"))).toBe(false);
    expect(namedRoundOver("2027-spring", new Date("2027-03-01T05:00:00Z"))).toBe(true);
  });
});
