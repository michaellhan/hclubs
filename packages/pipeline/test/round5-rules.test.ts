import { describe, expect, it } from "vitest";
import {
  aboutTextProblem,
  announcementProblem,
  auditionPrepProblem,
  socialFollowProblem,
  stageKindFromLabel,
} from "../src/extract/evidence-rules";

/** Student testing round 5: announcements and follow-us notices as About text; stage kinds. */

describe("announcements are never About text", () => {
  it("rejects an event announcement in the first sentence (VCG's mission)", () => {
    const vcg =
      "The Harvard Undergraduate Venture Capital Group (VCG) is excited to announce our second ever High School Pitch Competition! Teams of high school students pitch their startup ideas.";
    expect(announcementProblem(vcg)?.check).toBe("announcement");
    expect(aboutTextProblem(vcg)?.check).toBe("announcement");
    expect(announcementProblem("Save the date: our spring showcase is April 4.")?.check).toBe("announcement");
    expect(announcementProblem("Registration is now open for HMCA 2027.")?.check).toBe("announcement");
  });
  it("keeps a description that mentions an event later on", () => {
    expect(
      announcementProblem(
        "The Venture Capital Group connects founders with investors. Each spring we are excited to host a pitch competition.",
      ),
    ).toBeNull();
    expect(announcementProblem("We are a group of students excited about venture capital.")).toBeNull();
  });
});

describe("follow-us notices are never About text", () => {
  it("rejects the Ballroom team's social media notice", () => {
    const ballroom =
      "Stay up to date with the team and our events by following us on social media. We're active on both Instagram and Facebook under the handle @harvardballroom.";
    expect(socialFollowProblem(ballroom)?.check).toBe("social_follow");
    expect(aboutTextProblem(ballroom)?.check).toBe("social_follow");
    expect(socialFollowProblem("Follow us on Instagram @harvardknits for updates!")?.check).toBe("social_follow");
  });
  it("keeps a description that ends by inviting readers to follow", () => {
    expect(
      socialFollowProblem(
        "The Harvard Ballroom Dance Team is a competitive and social dance team open to all students. Follow us on Instagram for updates.",
      ),
    ).toBeNull();
    expect(socialFollowProblem("We stay connected with alumni through mentorship and annual reunions.")).toBeNull();
  });
});

describe("audition instructions are not experience requirements", () => {
  it("rejects HRO's and G&S's audition instructions", () => {
    expect(
      auditionPrepProblem(
        "Prepare two contrasting pieces that reflect current technical ability; excerpts from longer works acceptable; no sight reading, scales, or specific excerpts required",
      )?.check,
    ).toBe("audition_prep");
    expect(auditionPrepProblem("No monologue needed; prepare 1-2 minutes of a song of your choice")?.check).toBe(
      "audition_prep",
    );
  });
  it("keeps experience statements, even beside audition advice", () => {
    expect(auditionPrepProblem("No prior experience necessary")).toBeNull();
    expect(auditionPrepProblem("No experience needed; prepare a short song")).toBeNull();
    expect(auditionPrepProblem("All experience levels welcome")).toBeNull();
    // An instrument requirement is one, even beside the audition's repertoire.
    expect(
      auditionPrepProblem("Must play violin, viola, cello, or bass; the audition includes a piece from the repertoire"),
    ).toBeNull();
  });
});

describe("stage kinds follow their labels", () => {
  it("reads an unlabeled case or technical interview as an interview", () => {
    expect(stageKindFromLabel("case_interview", "Second Round Interview")).toBe("interview");
    expect(stageKindFromLabel("technical_interview", "Final Interview")).toBe("interview");
    expect(stageKindFromLabel("case_interview", "Case Interview")).toBe("case_interview");
    expect(stageKindFromLabel("technical_interview", "Coding interview")).toBe("technical_interview");
    expect(stageKindFromLabel("audition", "Callbacks")).toBe("audition");
  });
});
