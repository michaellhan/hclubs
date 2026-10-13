import { describe, expect, it } from "vitest";
import { experienceValueScoped, statesNoExperience } from "../src/experience";
import { deriveJoining } from "../src/joining";
import type { ResolvedValue } from "../src/resolve/resolver";

/** "No experience needed" statements (ADR 0042), on quotes taken from real club pages. */
describe("statesNoExperience", () => {
  it.each([
    "No experience necessary!",
    "You do not need any previous experience to join.",
    "No previous debate experience is necessary — only intellectual promise and demonstrated commitment to the team.",
    "We hold no auditions and require no prior experience.",
    "We don't require any previous expereince or training!",
    "No background in global health, engineering, or computer science is required—we are looking for students with a passion to learn.",
    "open to any member of the Harvard community regardless of race, gender identity, or prior experience",
    "No matter your background or prior experience, there’s a space for you at HUSO.",
    "We welcome players at every level, from complete beginners to seasoned competitors.",
    "Beginners and interested individuals with any level of knowledge are welcome!",
    "All backgrounds and levels of experience are welcome.",
    "No experience is necessary — we'll teach you everything.",
    "The program is intentionally accessible to students with no prior finance experience",
    "No. Most members join with little or no formal PM background.",
  ])("yes: %s", (q) => expect(statesNoExperience(q)).toBe(true));

  it.each([
    // Inferences, not statements.
    "Many of our fastest racers began as complete novices.",
    "interested in athletics at all levels. This includes Varsity, club, intramural, and recreational athletes.",
    // Requirements and audition prep.
    "Each auditionee will be asked to prepare two contrasting selections from your instrument's standard repertoire.",
    "Knowledge of JavaScript/TypeScript is required.",
    "we provide a space for trained individuals to learn, grow, and be inspired by other talented dancers",
    // One role or event, not joining.
    "Arranging or student conducting (no experience required)",
    "No prior experience required, just come with a charged cell phone to the Earth Week event.",
    // Not about experience at all.
    "While many of our tutors speak Mandarin or Cantonese, Chinese-speaking ability is not required.",
    null,
  ])("no: %s", (q) => expect(statesNoExperience(q)).toBe(false));

  it("a paraphrase narrowed to one event doesn't count", () => {
    expect(experienceValueScoped("No laboratory experience necessary (for the BioHackathon)")).toBe(true);
    expect(experienceValueScoped("No experience needed; beginners are welcome.")).toBe(false);
  });
});

function rv(value: unknown, quote: string): ResolvedValue<unknown> {
  return {
    value,
    claimId: `c-${quote.length}`,
    badge: "verified",
    confidence: 0.9,
    assertionKind: "stated",
    bestTier: 2,
    observedAt: "2026-09-30T00:00:00Z",
    asOf: null,
    stale: false,
    sources: [
      {
        sourceId: "s",
        sourceType: "club_website",
        url: "https://club.example.invalid/join",
        title: null,
        observedAt: "2026-09-30T00:00:00Z",
        isFixture: true,
        quote,
      },
    ],
  };
}
const base = {
  joinModes: [],
  freshmenEligible: [],
  eligibleClasses: [],
  cycleEligibleClasses: [],
  dues: null,
  tags: [],
};

describe("joining.noExperience", () => {
  it("yes from the verbatim quote, with its page as basis", () => {
    const j = deriveJoining({ ...base, experienceRequired: [rv("No experience required", "No experience required.")] });
    expect(j.noExperience).toBe(true);
    expect(j.basis.noExperience?.rule).toBe("stated_no_experience");
    expect(j.basis.noExperience?.sources[0]?.url).toBe("https://club.example.invalid/join");
  });
  it("the paraphrase alone never makes it yes", () => {
    const j = deriveJoining({
      ...base,
      experienceRequired: [
        rv(
          "No experience needed; many racers began as complete novices.",
          "Many of our fastest racers began as complete novices.",
        ),
      ],
    });
    expect(j.noExperience).toBeNull();
  });
  it("a requirement is unknown, never no", () => {
    const j = deriveJoining({
      ...base,
      experienceRequired: [rv("Trained dancers", "we provide a space for trained individuals")],
    });
    expect(j.noExperience).toBeNull();
    expect(deriveJoining(base).noExperience).toBeNull();
  });
});

// joining-v3 (student testing round 3): statements the profile showed as "No experience needed"
// that the filter missed. Quotes are as the pages write them.
describe("statesNoExperience (joining-v3)", () => {
  it.each([
    "No experience neededMost Crimson editors had never worked for a newspaper before their comp",
    "Q: Do I need to have a cappella experience to sing in an a cappella group?A: Not at all!",
    "Do I need teaching experience? Not at all! Many of our volunteers are new to teaching.",
    "The vast majority of our staff writers comped with no previous comedy writing experience.",
    "Singers of all musical backgrounds and experiences are invited to audition for the group.",
    "Dancers, cheerleaders, and gymnasts of all backgrounds and skill levels are encouraged to audition.",
    "We welcome players and students of all strengths to our weekly meetings.",
    "Whether you’re new to AI or an experienced ML enthusiast, we welcome you to our community!",
    "So whether you’re just getting started in computer science or already passionate, we have a place.",
    "If you’re starting out with design or just want to learn Figma, this is for you.",
    "We welcome all, from first-timers to competitive fencers",
    "And you don’t need to play an instrument to become a Bandie.",
    "We welcome both amateur and professional pianists and even non-musicians who just love music.",
    "All Harvard undergraduates are encouraged to comp the Review regardless of background.",
    "Open to everyone regardless of year or musical background!",
    "Experience with building bicycles is also a plus, but by no means required.",
    "Absolutely no requirements for comping except a willingness to engage with Harvard’s history.",
    "Club X draws students from all backgrounds and levels of exposure to finance.",
    "Most people come into the group with no clue of what consulting even is.",
    "Whether you consider yourself an artist or not, everyone is welcomed to explore.",
    // A Crimson board is the membership, not a leadership role.
    "The Tech Comp is designed to accommodate programmers with all levels of experience. Many have joined the board before even finishing CS50!",
  ])("yes: %s", (q) => expect(statesNoExperience(q)).toBe(true));

  it.each([
    // Not statements about joining: a requirement, a preference, an inference, a role.
    "No comp. Volunteers need to confirm that they have completed PBHA's volunteer training sessions.",
    "We prefer applicants with prior experience in policy research.",
    "Many of our fastest racers began as complete novices.",
    "Arranging or student conducting (no experience required)",
    "Regardless of your background or interests, there’s a seat for you.",
    "We welcome composers of all backgrounds.",
    // Implied, not stated: welcoming experienced applicants and encouraging everyone else.
    "While we welcome applicants with specific experience in a related field, any and all Harvard students with an interest in real estate are encouraged to apply.",
    "No prior experience is needed for executive board positions.",
  ])("no: %s", (q) => expect(statesNoExperience(q)).toBe(false));
});

describe("joining.noCuts from the club's own statement (joining-v3)", () => {
  const audition: ResolvedValue<unknown> = {
    ...rv("audition", "Auditions for our fall season will be held on Monday."),
    value: "audition",
  };
  it("a no-cut company with one audition has no cuts", () => {
    const j = deriveJoining({
      ...base,
      joinModes: [audition],
      experienceRequired: [rv("Welcomes a wide variety of dance styles; no-cut company.", "HRMDC is a no-cut company")],
    });
    expect(j.noCuts).toBe(true);
    expect(j.basis.noCuts?.claimIds.length).toBe(2);
  });
  it("not when the club has two processes, or none", () => {
    const comp: ResolvedValue<unknown> = { ...rv("comp", "Our comp runs four weeks."), value: "comp" };
    const stmt = rv("no-cut company", "HRMDC is a no-cut company");
    expect(deriveJoining({ ...base, joinModes: [audition, comp], experienceRequired: [stmt] }).noCuts).toBe(false);
    expect(deriveJoining({ ...base, experienceRequired: [stmt] }).noCuts).toBe(false);
  });
});
