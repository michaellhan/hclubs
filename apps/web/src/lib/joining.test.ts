import { describe, expect, it } from "vitest";
import type { JoiningSummary } from "@hci/db/local";
import { accessDisagrees, accessText } from "./joining";

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

  it("a club naming a tryout team and an open team reads both, not 'Sources differ' (Ultimate, joining-v7)", () => {
    const tracks = j({ access: "mixed", general: ["open", "tryout"] });
    expect(accessText(tracks)).toBe("Tryout or open, depending on the team");
    expect(accessDisagrees(tracks)).toBe(false);
    const differ = j({ access: "mixed", general: ["open", "tryout"], conflicts: ["access"] });
    expect(accessText(differ)).toBe("Sources differ: open or tryout");
    expect(accessDisagrees(differ)).toBe(true);
  });
});
