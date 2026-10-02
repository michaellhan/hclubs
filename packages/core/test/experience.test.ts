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
