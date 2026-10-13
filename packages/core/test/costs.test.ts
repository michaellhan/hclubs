import { describe, expect, it } from "vitest";
import { costClause, statedExtraCost } from "../src/costs";

/** Costs beyond dues, read from verbatim quotes on real club pages (student testing round 7). */
describe("statedExtraCost", () => {
  it.each([
    "If you would like to purchase a uniform (Gi) that will be at your own cost.",
    "Retreat costs are subsidized, and financial assistance is available upon request.",
    "Individual trip costs are solely for covering car rental fees and are typically $15-30 for long day trips.",
    "Members are responsible for paying for their own costumes.",
    "There is a fee for the spring tour.",
  ])("states a cost: %s", (q) => {
    expect(statedExtraCost(q)).not.toBeNull();
  });

  it.each([
    "Each summer the Krokodiloes circumnavigate the globe on an annual, self-funded world tour.",
    "the Kroks are the only a cappella group to tour the world several times every year, at no cost to their members.",
    "You will not need to pay out of pocket for your mentee.",
    "Annual tours over school breaks at no cost to students.",
    "The trip is fully subsidized by the club.",
    "No Dues Required",
    "Registration fees for delegates are listed below.",
    null,
  ])("states no member cost: %s", (q) => {
    expect(statedExtraCost(q)).toBeNull();
  });

  it("returns the sentence that states it, not the whole quote", () => {
    expect(
      statedExtraCost(
        "All of our classes are free. If you would like to purchase a uniform (Gi) that will be at your own cost.",
      ),
    ).toBe("If you would like to purchase a uniform (Gi) that will be at your own cost.");
  });
});

describe("costClause", () => {
  it("keeps the clause naming the cost and drops the free part", () => {
    expect(costClause("Classes are free with a valid MAC membership; uniform at own cost")).toBe("uniform at own cost");
    expect(costClause("Annual tours over school breaks at no cost to students")).toBeNull();
    expect(costClause("A show called Ghungroo")).toBeNull();
  });
});
