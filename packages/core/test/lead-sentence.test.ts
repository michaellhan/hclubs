import { describe, expect, it } from "vitest";
import { leadSentence } from "../src";

describe("leadSentence (ADR 0038)", () => {
  it("takes a self-describing first sentence verbatim", () => {
    expect(
      leadSentence(
        "The Fictional Minyan is a fully student-run minyan with egalitarian services. Everyone is invited to take part.",
      ),
    ).toBe("The Fictional Minyan is a fully student-run minyan with egalitarian services.");
    expect(
      leadSentence("Example Group seeks to promote awareness of regional issues in the Harvard community. More text."),
    ).toBe("Example Group seeks to promote awareness of regional issues in the Harvard community.");
  });
  it("leaves unknown anything that isn't a plain description", () => {
    expect(leadSentence("Apply by Friday! Applications for the fall cohort are open now to everyone.")).toBeNull();
    expect(leadSentence("Welcome!")).toBeNull();
    expect(leadSentence("Find us at https://example.org where we post weekly updates for members.")).toBeNull();
    expect(leadSentence(null)).toBeNull();
    // Too long to be a one-liner.
    expect(leadSentence(`The Example Society is a group that ${"does many things ".repeat(20)}.`)).toBeNull();
  });
  it("doesn't cut a sentence at an abbreviation", () => {
    expect(
      leadSentence("The Example Club is a chess group for U.S. citizens and others who love chess. Join us."),
    ).toBe("The Example Club is a chess group for U.S. citizens and others who love chess.");
  });
});
