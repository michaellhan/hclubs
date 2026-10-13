import { describe, expect, it } from "vitest";
import { chooseOneLine, isClubSportTemplate, sameTierOneLines } from "../src";

describe("chooseOneLine (resolver-v21)", () => {
  const template = "Harvard club sports team for fencing.";
  it("recognizes the club-sport template", () => {
    expect(isClubSportTemplate(template)).toBe(true);
    expect(isClubSportTemplate("Harvard women's club sports team for rugby.")).toBe(true);
    expect(isClubSportTemplate("A fencing club open to everyone.")).toBe(false);
  });
  it("prefers the club's own describing line over the template", () => {
    const own =
      "Harvard Cheerleading is the spirit of the Crimson, bringing energy and pride to home football and basketball games.";
    expect(chooseOneLine("Harvard club sports team for cheer.", own, null)).toBe(own);
    // A schedule, a sentence leaning on an earlier one, or "a club sport at Harvard" doesn't qualify.
    const schedule = "All levels, all three weapons. Practice Tuesdays, Thursdays and Sundays at the MAC FR1!";
    const better =
      "A fencing club open to everyone, from first-timers to competitive fencers, providing all equipment and instruction.";
    expect(chooseOneLine(template, schedule, null, [better])).toBe(better);
    expect(chooseOneLine(template, schedule, null)).toBe(template);
    expect(chooseOneLine(template, "Above all, we've made it our mission to build strength and character.", null)).toBe(
      template,
    );
    expect(chooseOneLine(template, "A university-recognized club sport at Harvard University.", null)).toBe(template);
    expect(
      chooseOneLine(template, null, "The club races in the Eastern Collegiate Cycling Conference every spring."),
    ).toBe("The club races in the Eastern Collegiate Cycling Conference every spring.");
  });
  it("leaves every other summary first", () => {
    expect(chooseOneLine("Our own summary.", "Their line.", "Lead.")).toBe("Our own summary.");
    expect(chooseOneLine(null, "Their line.", "Lead.")).toBe("Their line.");
    expect(chooseOneLine(null, null, "Lead.")).toBe("Lead.");
  });
  it("lists same-or-better-tier alternatives as one-liners", () => {
    expect(
      sameTierOneLines({
        current: { bestTier: 2 },
        alternatives: [
          { value: "A tier-two one-liner about the club that reads well.", bestTier: 2 },
          { value: "A tier-eight line from a news page.", bestTier: 8 },
        ],
      }),
    ).toEqual(["A tier-two one-liner about the club that reads well."]);
    expect(sameTierOneLines(undefined)).toEqual([]);
  });
});
