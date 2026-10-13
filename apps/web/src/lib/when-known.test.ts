import { describe, expect, it } from "vitest";
import type { CycleSummary } from "@hci/db/local";
import { whenKnown } from "./when-known";

const cycle: CycleSummary = {
  id: "c",
  termKey: "2026-fall",
  track: "main",
  status: "unknown",
  statedStatus: null,
  opens: { at: "2026-09-06", precision: "date" },
  deadline: null,
  processTypes: [],
  applicationUrl: null,
  eligibleClasses: null,
  lastVerifiedAt: null,
};

describe("profile key facts: When", () => {
  it("keeps a started round with no deadline (Lampoon's 'Comp started Sep 6')", () => {
    const club = {
      currentCycle: cycle,
      joining: { access: "process" },
      joinModes: ["comp"],
      cycles: [cycle],
    } as unknown as Parameters<typeof whenKnown>[0];
    expect(whenKnown(club, [], new Date("2026-10-12T12:00:00-04:00"))).toBe(true);
  });

  it("says nothing when nothing is known", () => {
    const club = {
      currentCycle: null,
      joining: { access: null },
      joinModes: [],
      cycles: [],
    } as unknown as Parameters<typeof whenKnown>[0];
    expect(whenKnown(club, [], new Date("2026-10-12T12:00:00-04:00"))).toBe(false);
  });
});
