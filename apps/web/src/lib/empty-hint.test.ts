import { describe, expect, it } from "vitest";
import { unconfirmedHint } from "./empty-hint";

const known = {
  openJoin: { yes: 3, no: 5, unknown: 2 },
  noComp: { yes: 0, no: 7, unknown: 20 },
  noDues: { yes: 0, no: 0, unknown: 0 },
  noExperience: { yes: 0, no: 0, unknown: 4 },
};

describe("unconfirmedHint", () => {
  it("names the filter nobody is confirmed for, with the view's size", () => {
    expect(unconfirmedHint(known, { noComp: true })).toEqual({ key: "noComp", total: 27, no: 7, unknown: 20 });
  });
  it("ignores filters that are off or that still have matches", () => {
    expect(unconfirmedHint(known, { openJoin: true })).toBeNull();
    expect(unconfirmedHint(known, {})).toBeNull();
  });
  it("says nothing when the view has no clubs without the filter either", () => {
    expect(unconfirmedHint(known, { noDues: true })).toBeNull();
  });
});
