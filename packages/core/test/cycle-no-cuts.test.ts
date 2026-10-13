import { describe, expect, it } from "vitest";
import { cycleNoCuts, saysNoCuts } from "../src/joining";

/** Per-round no cuts: only from the round's own facts, only for a lone comp/audition/tryout. */
describe("cycleNoCuts", () => {
  const hcdu = "Spring Comp: The HCDU spring comp is open and completion based for all Harvard enrolled students!!";

  it("reads a completion-based comp from the round's self-described selectivity", () => {
    expect(
      cycleNoCuts({
        processTypes: ["comp"],
        statements: ["open and completion based for all Harvard enrolled students", hcdu],
      }),
    ).toBe(true);
  });

  it("accepts audition and tryout rounds and the usual no-cut phrasings", () => {
    expect(cycleNoCuts({ processTypes: ["audition"], statements: ["Our auditions are no-cut."] })).toBe(true);
    expect(cycleNoCuts({ processTypes: ["tryout"], statements: ["We never cut anyone."] })).toBe(true);
    expect(
      cycleNoCuts({ processTypes: ["comp"], statements: ["Everyone who completes the comp joins the staff."] }),
    ).toBe(true);
  });

  it("never with an application beside it, or with two selective processes", () => {
    expect(cycleNoCuts({ processTypes: ["tryout", "application"], statements: [hcdu] })).toBe(false);
    expect(cycleNoCuts({ processTypes: ["comp", "audition"], statements: [hcdu] })).toBe(false);
  });

  it("never for an application-only or process-less round", () => {
    expect(cycleNoCuts({ processTypes: ["application"], statements: [hcdu] })).toBe(false);
    expect(cycleNoCuts({ processTypes: [], statements: [hcdu] })).toBe(false);
  });

  it("needs a statement: a comp alone says nothing about cuts (§9)", () => {
    expect(cycleNoCuts({ processTypes: ["comp"], statements: [] })).toBe(false);
    expect(cycleNoCuts({ processTypes: ["comp"], statements: [null, "Our comp is competitive."] })).toBe(false);
  });

  it("not when the statement negates it", () => {
    expect(saysNoCuts("This is not a completion-based comp.")).toBe(false);
    expect(cycleNoCuts({ processTypes: ["comp"], statements: ["This is not a completion based comp."] })).toBe(false);
  });

  it("reads a statement split across lines", () => {
    expect(saysNoCuts("our comp is\ncompletion\nbased")).toBe(true);
  });
});
