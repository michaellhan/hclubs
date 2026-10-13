import { describe, expect, it } from "vitest";
import { labelSaysKind } from "./stage-label";

describe("labelSaysKind", () => {
  it("treats Information Session as Info session", () => {
    expect(labelSaysKind("Information Session", "Info session")).toBe(true);
    expect(labelSaysKind("Coffee chat round", "Interview")).toBe(false);
  });
});
