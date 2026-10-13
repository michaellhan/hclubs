import { describe, expect, it } from "vitest";
import {
  aboutTextProblem,
  eventRecapProblem,
  notAboutClubProblem,
  noticeProblem,
  welcomeLetterProblem,
} from "../src/extract/evidence-rules";
import { extractDeterministic } from "../src/extract/deterministic";
import { htmlToDocument } from "../src/parse/document";
import { articleSignals, pressMentionProblem } from "../src/stages/crimson";

/** Student testing round 4: About text that isn't about the club, and press that isn't about it. */

describe("About text rules", () => {
  it("rejects welcome and invitation letters to conference delegates", () => {
    expect(
      welcomeLetterProblem(
        "It is my honor to welcome you to our seventy-fourth session of Harvard Model United Nations, set to take place from Thursday, January 28th, 2027, to Sunday, January 31st, 2027, in Boston, Massachusetts.",
      )?.check,
    ).toBe("welcome_letter");
    expect(
      welcomeLetterProblem(
        "On behalf of our Secretariat, it is with great pleasure that I invite you to the 73rd Annual Session of Harvard National Model United Nations (HNMUN). We are thrilled to welcome you to the Boston Marriott Copley Place.",
      )?.check,
    ).toBe("welcome_letter");
  });
  it("keeps a club welcoming new members and a description of a conference", () => {
    expect(
      welcomeLetterProblem(
        "On behalf of the staff and board of HURA, we would like to welcome you to join our community of undergraduate researchers.",
      ),
    ).toBeNull();
    expect(
      welcomeLetterProblem(
        "Harvard Model United Nations (HMUN) is a four-day international relations simulation for high school students held annually in Boston.",
      ),
    ).toBeNull();
  });

  it("rejects a recap of one event", () => {
    expect(
      eventRecapProblem(
        'Women in Medicine hosted a Women’s Week Career Panel, "Bites and Insights," featuring female healthcare professionals discussing their careers.',
      )?.check,
    ).toBe("event_recap");
    expect(
      eventRecapProblem(
        "With the new academic year underway, the Behavioral Insights Group hosted its fourth annual kick-off at Harvard Kennedy School.",
      )?.check,
    ).toBe("event_recap");
  });
  it("keeps descriptions that mention past events", () => {
    expect(
      eventRecapProblem("We have hosted speakers from across the medical field and run a mentorship program."),
    ).toBeNull();
    expect(
      eventRecapProblem("Women in Medicine hosted a career panel last fall and holds weekly study breaks for members."),
    ).toBeNull();
    expect(eventRecapProblem("The Harvard Glee Club is the oldest college chorus in America.")).toBeNull();
  });

  it("rejects notices to visitors", () => {
    expect(
      noticeProblem(
        "**Please note! As of Spring 2025 the Cycling Club is in the process of being restarted. We are not currently using our old Cat1/2/3 membership system so do not purchase these from our site.",
      )?.check,
    ).toBe("notice");
    expect(noticeProblem("As of 2024, practices have moved to the MAC.")?.check).toBe("notice");
    expect(noticeProblem("Memberships are sold online; please do not purchase two.")?.check).toBe("notice");
    expect(noticeProblem("Ride with us! The Cycling Club races road and mountain bikes. All are welcome!")).toBeNull();
    expect(aboutTextProblem("As one of the oldest clubs, we race every spring.")).toBeNull();
  });

  it("rejects generic text whose only “our” is a call to action", () => {
    const hups =
      "From picking courses and choosing a major to finding research opportunities, being a pre-med student requires substantial commitment. Luckily, Harvard has many resources available, among them the Office of Career Services and URAF. Click the links below to check out these resources and make sure to join our mailing list for information about events.";
    expect(notAboutClubProblem(hups, ["Harvard Premedical Society", "HUPS"])?.check).toBe("not_about_club");
    // Naming the club, a distinctive word of its name, or speaking as "we" elsewhere passes.
    expect(notAboutClubProblem(`${hups} HUPS hosts panels.`, ["Harvard Premedical Society", "HUPS"])).toBeNull();
    expect(
      notAboutClubProblem(
        "Harvard Synapse is a student-run chapter of a national nonprofit. For more info, visit our site.",
        ["Harvard Undergraduate Synapse Chapter"],
      ),
    ).toBeNull();
    expect(
      notAboutClubProblem("We mentor first-generation students. Join our mailing list.", ["Harvard First Gen Mentors"]),
    ).toBeNull();
  });
});

describe("extractor 1.16.39: About paragraphs", () => {
  const about = (paragraphs: string[], clubNames: string[]) =>
    extractDeterministic({
      doc: htmlToDocument(
        `<html><head><title>About</title></head><body><main>${paragraphs.map((p) => `<p>${p}</p>`).join("")}</main></body></html>`,
        "https://example-club.test/about",
      ),
      role: "about",
      fetchedAt: new Date("2026-10-13T03:00:00Z"),
      clubNames,
      clubAcronyms: [],
    }).find((c) => c.fieldKey === "club.long_description")?.value;

  it("skips a notice to visitors for the club's own paragraph", () => {
    expect(
      about(
        [
          "**Please note! As of Spring 2025 the Example Cycling Club is in the process of being restarted. We are not currently using our old membership system so do not purchase these from our site. Thank you!",
          "Ride with us! The Example Cycling Club races road and mountain bikes across New England every spring and fall, and our weekly group rides are open to riders of every level. All are welcome!",
        ],
        ["Example Cycling Club"],
      ),
    ).toMatch(/^Ride with us!/);
  });
  it("skips a delegate welcome letter and generic advising text", () => {
    expect(
      about(
        [
          "It is my honor to welcome you to our seventy-fourth session of Example Model United Nations, set to take place from Thursday, January 28th, 2027, to Sunday, January 31st, 2027, in Boston.",
        ],
        ["Example Model United Nations"],
      ),
    ).toBeUndefined();
    expect(
      about(
        [
          "From picking courses to finding research opportunities, being a pre-med student requires substantial commitment and good long-term planning. Luckily, Harvard has many resources, among them the Office of Career Services and URAF. Make sure to join our mailing list for information about events.",
        ],
        ["Example Premedical Society"],
      ),
    ).toBeUndefined();
  });
});

const article = (blocks: string[]) =>
  htmlToDocument(
    `<html><head><title>Story | News | The Harvard Crimson</title></head><body><article>${blocks.map((b) => `<p>${b}</p>`).join("")}</article></body></html>`,
    "https://www.thecrimson.com/article/2025/1/30/story/",
  );

describe("press-v6: article signals", () => {
  const votes = { name: "Harvard Votes Challenge", acronym: null, aliases: [] };
  const filler =
    "The ceremony drew thousands of spectators to the Capitol on a cold morning, and many students watched it from campus.";
  it("counts mentions and finds the opening paragraph", () => {
    const passing = article([
      "By Jane Q. Doe, Crimson Staff Writer",
      "President Donald Trump was sworn in for his second term on Jan. 20 inside the Capitol Rotunda, a historic day.",
      filler,
      filler.replace("cold", "bright"),
      "Two co-chairs of the non-partisan Harvard Votes Challenge declined to give a statement on the inauguration.",
    ]);
    expect(articleSignals(passing, votes)).toEqual({ mentions: 1, inLead: false });
    const lead = article([
      "Photo courtesy of the Harvard Votes Challenge",
      "The Harvard Votes Challenge registered more than 500 first-years during move-in week, its organizers said.",
      filler,
    ]);
    expect(articleSignals(lead, votes)).toEqual({ mentions: 1, inLead: true });
  });
  it("counts the name without Harvard and the initials once the name is spelled out", () => {
    const psc = { name: "Harvard Undergraduate Palestine Solidarity Committee", acronym: null, aliases: [] };
    const doc = article([
      "Students gathered in the Yard on Monday afternoon for a rally that lasted several hours into the evening.",
      filler,
      "The post came from the Harvard Undergraduate Palestine Solidarity Committee and another group.",
      "The PSC later apologized, and the Palestine Solidarity Committee reposted it.",
    ]);
    expect(articleSignals(doc, psc).mentions).toBe(3);
    // Initials alone (another group may share them) never count.
    expect(
      articleSignals(article(["The PSC met on Monday to plan the semester's events and speakers."]), psc).mentions,
    ).toBe(0);
  });

  const club = { name: "Harvard Votes Challenge", acronym: null, aliases: [] };
  const base = {
    quote: "Two co-chairs of the non-partisan Harvard Votes Challenge declined to comment.",
    publishedOn: "2025-01-30",
  };
  it("drops a single passing mention, keeps repeated or opening ones", () => {
    expect(
      pressMentionProblem(club, { ...base, title: "Trump Returns to Office", article: { mentions: 1, inLead: false } }),
    ).toContain("in passing");
    expect(
      pressMentionProblem(club, { ...base, title: "Trump Returns to Office", article: { mentions: 3, inLead: false } }),
    ).toBeNull();
    expect(
      pressMentionProblem(club, { ...base, title: "Trump Returns to Office", article: { mentions: 1, inLead: true } }),
    ).toBeNull();
    // Without the stored article, the v5 rules apply (a three-word name stands).
    expect(pressMentionProblem(club, { ...base, title: "Trump Returns to Office" })).toBeNull();
    // The headline naming the club always stands.
    expect(
      pressMentionProblem(club, {
        ...base,
        title: "Harvard Votes Challenge Targets Freshmen",
        article: { mentions: 1, inLead: false },
      }),
    ).toBeNull();
  });

  it("keeps a parent organization's story off its programs' pages", () => {
    const hpr = { name: "Harvard Political Review", acronym: "HPR", aliases: [] };
    const q = { quote: "From there, she joined the Harvard Political Review.", publishedOn: "2025-11-11" };
    expect(
      pressMentionProblem(hpr, {
        ...q,
        title: "The Institute of Politics Announces its 2026 Student Executive Board",
        article: { mentions: 3, inLead: true },
      }),
    ).toContain("institute of politics");
    expect(pressMentionProblem(hpr, { ...q, title: "IOP: Internationals of Politics" })).toContain("IOP");
    const psy = { name: "Harvard Undergraduate Psychedelics Club", acronym: null, aliases: [] };
    expect(
      pressMentionProblem(psy, {
        quote: "Clubs range from the Harvard Undergraduate Beekeepers to the Harvard Undergraduate Psychedelics Club.",
        title: "How the HUA Spends Half a Million Dollars a Year",
        publishedOn: "2025-04-25",
      }),
    ).toContain("HUA");
    // The parent itself, and a program its headline names, keep the story.
    const iop = { name: "Harvard Institute of Politics", acronym: "IOP", aliases: [] };
    expect(
      pressMentionProblem(iop, { ...q, title: "The Institute of Politics Announces its 2026 Student Executive Board" }),
    ).not.toMatch(/headline is about/);
    expect(pressMentionProblem(hpr, { ...q, title: "IOP Board Picks New Harvard Political Review Editor" })).toBeNull();
  });

  it("reads a four-letter name core no other club uses in the headline", () => {
    const pops = { name: "Harvard Pops Orchestra", acronym: null, aliases: [] };
    const m = {
      quote: "The Harvard Pops Orchestra played.",
      publishedOn: "2022-04-12",
      article: { mentions: 1, inLead: false },
    };
    expect(pressMentionProblem(pops, { ...m, title: "‘Pops and the Island of Misfit Professors’ Review" })).toBeNull();
    expect(
      pressMentionProblem(pops, { ...m, title: "Pops and Misfits Review" }, { sharedNameWords: new Set(["pops"]) }),
    ).toContain("in passing");
    expect(pressMentionProblem(pops, { ...m, title: "Corn pops for breakfast" })).toContain("in passing");
  });

  it("drops 19th-century articles even when the headline names the club", () => {
    const fencing = { name: "Fencing (Club Sport)", acronym: null, aliases: [] };
    expect(
      pressMentionProblem(fencing, {
        title: "Harvard Fencing Club.",
        quote: "The Harvard Fencing Club met.",
        publishedOn: "1888-12-14",
      }),
    ).toContain("before 1990");
  });

  it("reads a one-word club as another club only in the 'Harvard X' form", () => {
    const hrc = { name: "Harvard Republican Club", acronym: null, aliases: [] };
    const ctx = { otherClubNames: ["salient", "republican club"] };
    const m = {
      quote: "Members also attended Harvard Republican Club meetings.",
      publishedOn: "2026-02-27",
      article: { mentions: 2, inLead: false },
    };
    expect(
      pressMentionProblem(
        hrc,
        { ...m, title: "After Shutdown and Scandal, The Harvard Salient Is Attempting a Comeback" },
        ctx,
      ),
    ).toContain("salient");
    expect(pressMentionProblem(hrc, { ...m, title: "A Salient Point About Campus Speech" }, ctx)).toBeNull();
  });
});
