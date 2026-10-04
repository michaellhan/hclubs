import { describe, expect, it } from "vitest";
import { leadSentence, oneLineDescription } from "../src";

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

describe("oneLineDescription (resolver-v11)", () => {
  it("keeps a real one-liner as it is", () => {
    expect(oneLineDescription("Performs Bharatanatyam.")).toBe("Performs Bharatanatyam.");
  });
  it("takes the describing sentence out of a shouted, cut-off excerpt", () => {
    expect(
      oneLineDescription(
        "GET OUTSIDE WITH HOC! The Harvard Outing Club is the perfect group for anyone interested in joining or leading trips to go hiking. Our mission is to bring people outside. “All are welcome” is our […]",
      ),
    ).toBe(
      "The Harvard Outing Club is the perfect group for anyone interested in joining or leading trips to go hiking.",
    );
  });
  it("keeps the text when no sentence describes the club", () => {
    const pitch = "Join us for the 10th iteration of HackHarvard, a 36-hour free undergraduate hackathon.";
    expect(oneLineDescription(pitch)).toBe(pitch);
  });
});

describe("leadSentence: performing groups (resolver-v12)", () => {
  it("accepts what a group performs or was founded to do", () => {
    expect(
      leadSentence(
        "Harvard’s Bhangra team combines traditional Punjabi dance with contemporary Western hip hop in their performances. More.",
      ),
    ).toBe(
      "Harvard’s Bhangra team combines traditional Punjabi dance with contemporary Western hip hop in their performances.",
    );
    expect(
      leadSentence(
        "BFA, which was founded in 1961 by undergraduates to celebrate Mexican heritage through traditional dance, is one of the oldest cultural groups on campus.",
      ),
    ).not.toBeNull();
  });
});
