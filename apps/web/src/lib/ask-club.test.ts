import { describe, expect, it } from "vitest";
import { askClubPlan, askDmText, askEmail } from "./ask-club";

const known = { howKnown: true, whenKnown: true, timeKnown: false, sparse: false };
const email = { kind: "email", url: "mailto:board@club.org", status: "verified" } as const;
const ig = { kind: "instagram", url: "https://www.instagram.com/club/", status: "probable" } as const;

describe("askClubPlan", () => {
  it("stays hidden when how and when are known, even with time unknown", () => {
    expect(askClubPlan({ ...known, links: [email, ig] })).toBeNull();
  });

  it("offers both channels and asks only what's missing", () => {
    const plan = askClubPlan({ ...known, whenKnown: false, links: [email, ig] });
    expect(plan).toEqual({ email: "board@club.org", instagram: ig.url, topics: ["when", "time"] });
  });

  it("needs a channel", () => {
    expect(askClubPlan({ ...known, howKnown: false, links: [] })).toBeNull();
  });

  it("never offers an address or account found only by name", () => {
    const guessed = [{ ...ig, status: "unverified" }, { ...email, status: "unverified" }] as const;
    expect(askClubPlan({ ...known, howKnown: false, links: guessed })).toBeNull();
  });

  it("writes to the recruiting or general inbox, not alumni or sales", () => {
    const at = (local: string, status: "verified" | "probable" = "verified") =>
      ({ kind: "email", url: `mailto:${local}@club.org`, status }) as const;
    const pick = (...links: ReturnType<typeof at>[]) => askClubPlan({ ...known, howKnown: false, links })?.email;
    expect(pick(at("alumni.club"), at("sales"), at("info", "probable"))).toBe("info@club.org");
    expect(pick(at("academics"), at("copresidents"))).toBe("copresidents@club.org");
    expect(pick(at("info"), at("join", "probable"))).toBe("join@club.org");
    expect(pick(at("tours"), at("tutoring"))).toBe("tours@club.org");
    const opera = ["belonging.opera", "alumni.opera", "opera", "finance.opera"].map((l) => at(l));
    expect(pick(...opera)).toBe("opera@club.org");
    const hsa = [
      { kind: "email", url: "mailto:info@other.com", status: "verified" },
      { kind: "email", url: "mailto:info@hsa.net", status: "verified" },
      { kind: "email", url: "mailto:tours@hsa.net", status: "verified" },
    ] as const;
    expect(askClubPlan({ ...known, howKnown: false, links: hsa })?.email).toBe("info@hsa.net");
  });

  it("drops query strings from the address and rejects junk", () => {
    const plan = askClubPlan({
      ...known,
      howKnown: false,
      links: [{ kind: "email", url: "mailto:Board@Club.org?subject=hi", status: "probable" }, ig],
    });
    expect(plan?.email).toBe("Board@Club.org");
    const junk = askClubPlan({ ...known, howKnown: false, links: [{ ...email, url: "mailto:nope" }, email] });
    expect(junk?.email).toBe("board@club.org");
  });

  it("a bare page with everything else known still asks the basics", () => {
    const plan = askClubPlan({ ...known, timeKnown: true, sparse: true, links: [email] });
    expect(plan?.topics).toEqual(["how", "when"]);
  });
});

describe("messages", () => {
  const club = { name: "Harvard Example Society", slug: "example" };
  it("email leads with the question and links the profile and the officer form", () => {
    const { subject, body } = askEmail(club, ["how", "when", "time"], "https://hclubs.app");
    expect(subject).toBe("Question about joining Harvard Example Society");
    expect(body).toContain("couldn't find how to join, your recruiting timeline, or the weekly time commitment");
    expect(body).toContain("https://hclubs.app/clubs/example/");
    expect(body).toContain("https://hclubs.app/for-clubs/?club=example");
    expect(body.indexOf("Could you let me know")).toBeLessThan(body.indexOf("for-clubs"));
  });

  it("DM is two sentences with a bare host", () => {
    const text = askDmText(club, ["when"], "https://hclubs.app");
    expect(text).toBe(
      "Hi! I'm interested in joining Harvard Example Society this semester but couldn't find your recruiting timeline on hclubs.app/clubs/example. Could you tell me when your deadlines are?",
    );
  });
});
