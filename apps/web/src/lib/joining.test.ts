import { describe, expect, it } from "vitest";
import type { JoiningSummary } from "@hci/db/local";
import { accessText } from "./joining";

const j = (over: Partial<JoiningSummary>): JoiningSummary => ({
  access: null,
  general: [],
  roles: [],
  noCuts: false,
  comp: null,
  firstYears: null,
  dues: null,
  noExperience: null,
  conflicts: [],
  ...over,
});

describe("accessText", () => {
  it("an open club whose audition cuts no one keeps the audition (Harvard University Band, joining-v5)", () => {
    expect(accessText(j({ access: "open", general: ["open", "audition"], noCuts: true }))).toBe(
      "Open membership (audition, no cuts)",
    );
  });

  it("plain open membership and a no-cut process read as before", () => {
    expect(accessText(j({ access: "open", general: ["open"] }))).toBe("Open membership");
    expect(accessText(j({ access: "process", general: ["comp"], noCuts: true }))).toBe("Comp (no cuts)");
  });
});
