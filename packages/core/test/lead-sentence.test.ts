import { describe, expect, it } from "vitest";
import { describingClause, leadSentence, oneLineDescription, oneLineFromResolved } from "../src";

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

describe("one-liners from cut-off and over-long descriptions (resolver-v14)", () => {
  it("reads a trailing '...' as a cut-off excerpt and uses its describing sentence", () => {
    expect(
      oneLineDescription(
        "Established in 1976, The Harvard-Radcliffe Modern Dance Company (HRMDC) is the oldest dance organization at Harvard College. We are a contemporary dance group that welcomes a wide variety of dance...",
      ),
    ).toBe(
      "Established in 1976, The Harvard-Radcliffe Modern Dance Company (HRMDC) is the oldest dance organization at Harvard College.",
    );
  });
  const paragraph =
    "The Harvard Computing Contest Club (formerly known as the Harvard ACM Team) sends at least two teams of 3 undergraduates every year to compete in an preliminary computing contest. The team that does best, if it does well enough, goes on to complete in the regional contest, and if that team does well enough there, it goes on to the ICPC World Finals";
  const seas =
    "Sends at least two teams of 3 undergraduates every year to compete in the International Collegiate Programming Contest (ICPC), an algorithmic programming contest for college students";
  it("uses a competing one-liner of the same tier when the shown text is an over-long paragraph", () => {
    expect(oneLineFromResolved({ value: paragraph, bestTier: 1 }, [{ value: seas, bestTier: 1 }])).toBe(seas);
  });
  it("never takes a lower tier's text, and keeps a shown one-liner", () => {
    expect(oneLineFromResolved({ value: paragraph, bestTier: 1 }, [{ value: seas, bestTier: 8 }])).toBe(paragraph);
    expect(oneLineFromResolved({ value: seas, bestTier: 2 }, [{ value: "Another one-line text.", bestTier: 1 }])).toBe(
      seas,
    );
    expect(oneLineFromResolved(null, [{ value: seas, bestTier: 1 }])).toBeNull();
  });
});

describe("excerpt headings (resolver-v15)", () => {
  it("drops a section heading a WordPress excerpt glued to the first sentence", () => {
    expect(
      oneLineDescription(
        "About Us Founded in 2016, TAPAS is a nonhierarchical, student-driven organization where advocacy, scholarship, and community intersect. We create space […]",
      ),
    ).toBe(
      "Founded in 2016, TAPAS is a nonhierarchical, student-driven organization where advocacy, scholarship, and community intersect.",
    );
  });
  it("keeps names that begin like a heading word", () => {
    const text =
      "About Face Theater is a student theater group that performs new plays by undergraduates every semester at Harvard. More text follows here to make this longer than two hundred characters in total, so the excerpt path is taken […]";
    expect(oneLineDescription(text)).toBe(
      "About Face Theater is a student theater group that performs new plays by undergraduates every semester at Harvard.",
    );
  });
});

describe("home-page announcements (resolver-v17)", () => {
  it("never takes news or an event pitch as the one line when another description reads as one", () => {
    const polo = {
      value: "Harvard Polo Club is excited to welcome Team Oxford for the 2025 International Invitational!",
      bestTier: 2,
    };
    const hmca = {
      value:
        "Harvard Model Congress Asia HMCA 2027 will take place from January 11-13, 2027 at the University of Seoul! Registration is now open.",
      bestTier: 2,
    };
    const jam = { value: "Come to our Fall 2026 Jam!!! Tickets can be purchased at the door.", bestTier: 2 };
    const about = {
      value: "A student-run polo team that competes in the Northeast and teaches beginners to ride.",
      bestTier: 2,
    };
    for (const pitch of [polo, hmca, jam]) expect(oneLineFromResolved(pitch, [about])).toBe(about.value);
    // With nothing better, a club keeps its only text.
    expect(oneLineFromResolved(polo, [])).toBe(polo.value);
    // A description that merely mentions a proud history is not an announcement.
    const plain = "The Harvard Krokodiloes are Harvard's oldest a cappella group, founded in 1946.";
    expect(oneLineDescription(plain)).toBe(plain);
  });
});

describe("one-liners that say when a group meets (round 3)", () => {
  it("takes the meeting sentence and leaves the invitation", () => {
    const text =
      "The Jewish-Christian Bible Study meets weekly over dinner to discuss Biblical texts, interpretations, and religious life – both in its surprising similarities and its thought-provoking divergences. Join us to learn from your peers, delve deeply into texts no matter how you approach them, and maybe even lead a session yourself!";
    expect(oneLineDescription(text)).toBe(
      "The Jewish-Christian Bible Study meets weekly over dinner to discuss Biblical texts, interpretations, and religious life – both in its surprising similarities and its thought-provoking divergences.",
    );
    // A meeting time alone says nothing about the group.
    expect(leadSentence("The club meets weekly on Tuesdays at 7 PM in the Science Center, room 105.")).toBe(null);
  });
});

describe("one-liners without calls to action or run-on clauses (resolver-v19)", () => {
  const jcbs =
    "The Jewish-Christian Bible Study meets weekly over dinner to discuss Biblical texts, interpretations, and religious life – both in its surprising similarities and its thought-provoking divergences. Join us to learn from your peers, delve deeply into texts no matter how you approach them, and maybe even lead a session yourself!";

  it("drops a closing call to action, keeping the club's own words verbatim", () => {
    expect(oneLineDescription(jcbs)).toBe(
      "The Jewish-Christian Bible Study meets weekly over dinner to discuss Biblical texts, interpretations, and religious life – both in its surprising similarities and its thought-provoking divergences.",
    );
    // Short texts too: under 200 characters a trailing invitation still goes.
    expect(
      oneLineDescription("The Harvard Chess Club is a community of players of every level. Come join us on Tuesdays!"),
    ).toBe("The Harvard Chess Club is a community of players of every level.");
    expect(
      oneLineDescription(
        "We are a student-run a cappella group that sings jazz and pop. Follow us on Instagram! Sign up below.",
      ),
    ).toBe("We are a student-run a cappella group that sings jazz and pop.");
    // A call to action is never the one-liner itself, and a lone one is kept (nothing better).
    expect(oneLineDescription("Join us for weekly pickup games on the quad.")).toBe(
      "Join us for weekly pickup games on the quad.",
    );
  });

  it("keeps texts whose last sentence only mentions joining", () => {
    const plain = "The Harvard Outing Club runs hiking and climbing trips. Anyone can join us on a trip.";
    expect(oneLineDescription(plain)).toBe(plain);
  });

  it("cuts one over-long describing sentence at its last clause break that fits", () => {
    const appliedMath =
      "a student group dedicated to promotion of applied mathematics within the undergraduate body, cultivating a supportive community of students interested in the field and exploration of topics within, from academic to professional.";
    expect(appliedMath.length).toBeGreaterThan(220);
    expect(oneLineDescription(appliedMath)).toBe(
      "a student group dedicated to promotion of applied mathematics within the undergraduate body.",
    );
    expect(describingClause(appliedMath)).toBe(
      "a student group dedicated to promotion of applied mathematics within the undergraduate body.",
    );
  });

  it("leaves a long sentence whole when no break leaves a description", () => {
    // PHIT: the only commas split a list, which is never cut.
    const phit =
      "The Harvard Chan Public Health Innovation x Technology Student Forum (PHIT) provides an interactive and inclusive space for students to develop knowledge, engage in thoughtful discussion, and advocate for innovations and technologies that positively impact global and domestic public health.";
    expect(describingClause(phit)).toBeNull();
    expect(oneLineDescription(phit)).toBe(phit);
    // A cut must say what the club is and must not leave a bracket open.
    expect(
      describingClause(
        "Founded in 2019 (and reorganized in 2021 — after the pandemic years, with a new board elected by members of the wider community of students who attend meetings regularly), the group runs weekly discussions, hosting speakers.",
      ),
    ).toBeNull();
    // Under 220 characters nothing is cut.
    expect(
      describingClause("A student group dedicated to applied math, cultivating a supportive community."),
    ).toBeNull();
  });

  it("prefers a competing whole one-liner over a cut sentence", () => {
    const long = {
      value:
        "a student group dedicated to promotion of applied mathematics within the undergraduate body, cultivating a supportive community of students interested in the field and exploration of topics within, from academic to professional.",
      bestTier: 2,
    };
    const other = { value: "The Applied Math Society hosts talks and problem nights for undergraduates.", bestTier: 2 };
    expect(oneLineFromResolved(long, [other])).toBe(other.value);
    expect(oneLineFromResolved(long, [])).toBe(
      "a student group dedicated to promotion of applied mathematics within the undergraduate body.",
    );
  });
});
