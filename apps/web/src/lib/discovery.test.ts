import { describe, expect, it } from "vitest";
import { MIN_INTENT_CLUBS, mobileHiddenGroups } from "./discovery";

describe("mobileHiddenGroups", () => {
  it("hides groups that start after the first dozen tiles", () => {
    expect(mobileHiddenGroups([5, 5, 5, 4])).toEqual([false, false, false, true]);
    expect(mobileHiddenGroups([12, 1])).toEqual([false, true]);
    expect(mobileHiddenGroups([3, 2])).toEqual([false, false]);
  });
  it("hides thin intents", () => {
    expect(MIN_INTENT_CLUBS).toBe(6);
  });
});
