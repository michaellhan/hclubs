import { describe, expect, it } from "vitest";
import { applyLinkText, type ApplyLinkState } from "./apply-link";

const base: ApplyLinkState = {
  url: "https://forms.gle/fall",
  label: "Fill out the interest form here",
  term: null,
  live: false,
  closed: false,
  open: false,
};
const oct12 = new Date("2026-10-12T16:00:00Z");
const sep10 = new Date("2026-09-10T16:00:00Z");

describe("applyLinkText", () => {
  it("a form naming a fall round reads as last round's form once October starts", () => {
    const s = { ...base, term: "2026-fall" };
    expect(applyLinkText(s, oct12)).toEqual({ text: "Last round's form", primary: false, past: true });
    expect(applyLinkText(s, sep10)).toEqual({ text: "Interest form", primary: false, past: false });
    // Before mount the build-day state stands (the build already kept stale forms out).
    expect(applyLinkText(s, null).past).toBe(false);
  });
  it("a past-round page (not a form) says to see how they recruit", () => {
    const s = { ...base, url: "https://club.example/comp", label: "Comp", term: "2026-spring" };
    expect(applyLinkText(s, oct12).text).toBe("See how they recruit");
  });
  it("a live round always wins", () => {
    expect(applyLinkText({ ...base, term: "2026-spring", live: true }, oct12)).toEqual({
      text: "Apply",
      primary: true,
      past: false,
    });
  });
  it("keeps the closed-round and open-club wording", () => {
    expect(applyLinkText({ ...base, closed: true }, oct12).text).toBe("Last round's form (closed)");
    expect(applyLinkText({ ...base, open: true }, oct12)).toEqual({
      text: "Join via sign-up form",
      primary: true,
      past: false,
    });
    expect(applyLinkText({ ...base, label: "Apply", url: "https://club.example/apply" }, oct12).text).toBe(
      "How to apply",
    );
  });
});

describe("applyLinkText without a process", () => {
  it("says How to join when no application or comp is on record", () => {
    const s = {
      url: "https://club.example/resources",
      label: null,
      term: null,
      live: false,
      closed: false,
      open: false,
    };
    expect(applyLinkText({ ...s, hasProcess: false }, null).text).toBe("How to join");
    expect(applyLinkText({ ...s, hasProcess: true }, null).text).toBe("How to apply");
  });
});
