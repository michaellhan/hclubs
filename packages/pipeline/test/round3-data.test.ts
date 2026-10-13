import { describe, expect, it } from "vitest";
import { extractDeterministic, extractStages } from "../src/extract/deterministic";
import {
  conferenceRegistrationProblem,
  governanceActivityProblem,
  hoursProblem,
  inferredYearProblem,
  joinModeProblem,
} from "../src/extract/evidence-rules";
import { pastCycleNamed, urlTermCode } from "../src/audit/checks/links";
import { htmlToDocument } from "../src/parse/document";
import { pressMentionProblem } from "../src/stages/crimson";
import { factProblem } from "../src/stages/facts";

/**
 * Data fixes from student testing round 3 (2026-10-12). Pages are fictional clubs with the
 * layout of the page that went wrong.
 */

// --- Conference registration pages (HMUN, HNMUN) ------------------------------------------------

/** HMUN's application-process layout: high-school delegations register; college students can't. */
const HIGH_SCHOOL_CONFERENCE = `<html><body><main>
  <h1>Application Process</h1>
  <p>Example MUN is committed to serving the future leaders of the world. We welcome and encourage all students to apply for this educational experience!</p>
  <p>Please note that due to the competitive nature of Example MUN applications, acceptance to the conference is not guaranteed.</p>
  <h3>Registration Timeline</h3>
  <p>Registration Opens: June 1, 2026</p>
  <p>General Registration Deadline: October 1, 2026</p>
  <h3>Eligibility</h3>
  <p>In order to be eligible to apply, applicants must be enrolled in a high school during the time of the conference. In particular, college students are not eligible to apply for Example MUN 2027.</p>
  <p>Once accepted, students must be accompanied by a faculty advisor.</p>
  <h3>Registration Fees</h3>
  <ul><li>US $115 per Delegate</li><li>US $115 per Delegation</li></ul>
</main></body></html>`;

/** HNMUN's how-to-apply layout: university delegations, a conference system, rolling review. */
const UNIVERSITY_CONFERENCE = `<html><body><main>
  <h2>Guide to Applying</h2>
  <p>Please note that we only accept applications submitted directly via our conference registration system, MUNager, which is linked below.</p>
  <h2>3. Review of application on a rolling basis.</h2>
  <p>Please expect to receive a decision within a few weeks.</p>
</main></body></html>`;

const extract = (html: string, url: string) =>
  extractDeterministic({
    doc: htmlToDocument(html, url),
    role: "recruiting",
    fetchedAt: new Date("2026-10-12T16:00:00Z"),
    clubNames: ["Example Model United Nations"],
    clubAcronyms: ["EMUN"],
  });

describe("conference registration pages (round 3)", () => {
  it("gives no join modes, eligibility, seasons, dates or selectivity", () => {
    for (const [html, url] of [
      [HIGH_SCHOOL_CONFERENCE, "https://example-mun.test/application-process"],
      [UNIVERSITY_CONFERENCE, "https://example-mun.test/how-to-apply"],
    ] as const) {
      const fields = extract(html, url).map((c) => c.fieldKey);
      for (const f of [
        "club.join_mode",
        "club.eligible_classes",
        "club.freshmen_eligible",
        "club.recruiting_seasons",
        "cycle.deadline",
        "cycle.opens_at",
        "club.self_described_selectivity",
      ])
        expect(fields).not.toContain(f);
    }
  });

  it("is judged on the whole page", () => {
    const text = htmlToDocument(HIGH_SCHOOL_CONFERENCE, "https://example-mun.test/a").text;
    expect(conferenceRegistrationProblem(text)?.check).toBe("conference_registration");
    expect(joinModeProblem("application", "Application Process", text)?.check).toBe("conference_registration");
    expect(conferenceRegistrationProblem("MUNager is our registration system.")).not.toBe(null);
  });

  it("keeps pages that recruit the club's own staff, and ordinary club pages", () => {
    expect(
      conferenceRegistrationProblem(
        "Delegates from high schools attend each January; registration deadlines are on our site. Staff applications are open: use the IRC Common App.",
      ),
    ).toBe(null);
    expect(
      conferenceRegistrationProblem(
        "Our traveling team sends delegates to conferences across the country. Applications are due September 12.",
      ),
    ).toBe(null);
  });
});

// --- Guessed years and past-cycle forms (Fed Challenge, HIRC) ------------------------------------

describe("applications for a named season (round 3)", () => {
  const FED = `<html><body><main>
    <h1>Example Fed Team</h1>
    <p>Each year, we compete in a national policy competition. The competition takes place each Fall, and recruitment occurs the following Spring.</p>
    <p>Applications for our 2026–27 season are now open! All applications are due February 6 at 11:59 p.m.</p>
  </main></body></html>`;

  it("dates a spring deadline to the spring before the season, not the spring inside it", () => {
    const q = "Applications for our 2026–27 season are now open! All applications are due February 6 at 11:59 p.m.";
    expect(inferredYearProblem(q, "2027-02-06T23:59:00-05:00")?.why).toContain("2026");
    expect(inferredYearProblem(q, "2026-02-06T23:59:00-05:00")).toBe(null);
    // A school year named without "applications for": spring dates are in its second year.
    expect(inferredYearProblem("Spring rehearsals for the 2026-27 school year start February 6.", "2027-02-06")).toBe(
      null,
    );
  });

  it("reads the year from the paragraph, so the extractor drops the guessed 2027 date", () => {
    const claims = extractDeterministic({
      doc: htmlToDocument(FED, "https://example-fed.test/"),
      role: "home",
      fetchedAt: new Date("2026-10-13T03:00:00Z"),
      clubNames: ["Example Fed Team"],
      clubAcronyms: [],
    });
    expect(claims.filter((c) => c.fieldKey === "cycle.deadline")).toEqual([]);
    expect(claims.find((c) => c.fieldKey === "club.recruiting_seasons")?.value).toEqual(["spring"]);
  });
});

describe("past-cycle application pages (round 3)", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("reads a past term from the page title or a term code in the address", () => {
    expect(pastCycleNamed("Apply | IRC Common App: Fall 2025 | IRC Applications", now)).toBe("Fall 2025");
    expect(urlTermCode("https://apps.example.test/f25")).toBe("Fall 2025");
    expect(urlTermCode("https://apps.example.test/spring2026/")).toBe("Spring 2026");
    expect(urlTermCode("https://apps.example.test/f2026")).toBe("Fall 2026");
    expect(pastCycleNamed(`Apply | ${urlTermCode("https://apps.example.test/f26")}`, now)).toBe(null);
    expect(urlTermCode("https://example.test/faq")).toBe(null);
    expect(urlTermCode("https://example.test/forms/s")).toBe(null);
  });
});

// --- Smaller rules (round 3) ----------------------------------------------------------------------

describe("hours: a meeting's length is not hours per week", () => {
  it("drops 'we meet every Tuesday for 1 hour', keeps weekly figures", () => {
    expect(hoursProblem("We meet every Tuesday for 1 hour to discuss topics.", [1])?.check).toBe(
      "hours_meeting_length",
    );
    expect(hoursProblem("A: We rehearse for 6 hours a week and perform every semester!", [6])).toBe(null);
    expect(hoursProblem("The Opportunes rehearse 3 times a week for a total of 7 hours", [7])).toBe(null);
    expect(hoursProblem("Typically, it’s 2-3 hours a week, which includes lesson prep.", [2, 3])).toBe(null);
  });
});

describe("activities: board elections are governance", () => {
  it.each([
    "Annual Board of Directors elections",
    "Members can run for the Board of Directors, which is elected each December",
    "Student-run Board of Directors elected each December",
  ])("drops: %s", (a) => expect(governanceActivityProblem(a)?.check).toBe("activity_governance"));
  it.each([
    "Weekly company ballet class on Tuesday evenings",
    "Election-night watch parties",
    "Choreographing on company members",
  ])("keeps: %s", (a) => expect(governanceActivityProblem(a)).toBe(null));
});

describe("stages in one paragraph take the process order", () => {
  it("info session → application → tryout, not the order of mention", () => {
    const html = `<html><body><main><h2>Our process</h2><p>Welcome to the application! For more information about the tryout process, visit our page. Our first events will be the Demo Debate and Information Session. This application form has a few pages.</p></main></body></html>`;
    const { stages } = extractStages({
      doc: htmlToDocument(html, "https://example-debate.test/join"),
      role: "join",
      fetchedAt: new Date("2026-10-12T00:00:00Z"),
      clubNames: ["Example Debating Union"],
      clubAcronyms: [],
    });
    expect(stages.map((s) => s.kind)).toEqual(["info_session", "written_application", "tryout"]);
  });
});

describe("press-v5: a headline about another club", () => {
  const club = { name: "Harvard College Debating Union", acronym: null, aliases: [] };
  const ctx = { otherClubNames: ["debate council", "debating union"] };
  it("drops a mention in another club's story, keeps the club's own", () => {
    expect(
      pressMentionProblem(
        club,
        {
          title: "After Years of Turmoil, Harvard’s Debate Council Faces a Reckoning",
          quote:
            "Each year, the Harvard National Speech and Debate Tournament hires members of the Harvard College Debating Union — Harvard’s parliamentary team, separate from the policy-focused HDC — to judge rounds.",
          publishedOn: "2026-05-28",
        },
        ctx,
      ),
    ).toContain("another club");
    expect(
      pressMentionProblem(
        club,
        {
          title: "Harvard Shouldn’t Fear Debate",
          quote:
            "Last month, the student organizers of a high school debate tournament hosted by the Harvard College Debating Union withdrew a motion.",
          publishedOn: "2026-04-10",
        },
        ctx,
      ),
    ).toBe(null);
  });
});

describe("editor-read round facts and one-liners", () => {
  const page = "Spring Comp: The HCDU spring comp is open and completion based for all Harvard enrolled students!!";
  it("a round's fact must name its season", () => {
    expect(factProblem({ field: "cycle.process_type", term: "2027-spring", value: "comp", quote: page }, page)).toBe(
      null,
    );
    expect(factProblem({ field: "cycle.process_type", term: "2026-fall", value: "comp", quote: page }, page)).toContain(
      "fall",
    );
  });
  it("a one-liner is a verbatim sentence span", () => {
    const quote =
      "Founded in 2012, Example Club is a student organization dedicated to running a fictional festival on campus.";
    expect(
      factProblem(
        {
          field: "club.short_description",
          value: "A student organization dedicated to running a fictional festival on campus.",
          quote,
        },
        quote,
      ),
    ).toBe(null);
    expect(
      factProblem(
        { field: "club.short_description", value: "A student organization dedicated to running a festival.", quote },
        quote,
      ),
    ).toContain("verbatim");
  });
});

describe("extractor 1.16.38: experience lines, generic link labels, short missions", () => {
  const run = (html: string, role: "home" | "join" = "home") =>
    extractDeterministic({
      doc: htmlToDocument(html, "https://example-club.test/"),
      role,
      fetchedAt: new Date("2026-10-12T00:00:00Z"),
      clubNames: ["Example Boxing Club"],
      clubAcronyms: [],
    });
  it("reads a no-experience line verbatim, never a board's", () => {
    const got = run(
      `<html><body><main><p>Practices are held four times per week. All experience levels welcome!</p></main></body></html>`,
    );
    expect(got.find((c) => c.fieldKey === "club.experience_required")?.value).toBe("All experience levels welcome!");
    const board = run(
      `<html><body><main><p>No prior experience is necessary to apply for an executive board position.</p></main></body></html>`,
    );
    expect(board.find((c) => c.fieldKey === "club.experience_required")).toBeUndefined();
  });
  it("drops 'here' as a form's label", () => {
    const got = run(
      `<html><body><main><p>Want to join? Apply <a href="https://forms.gle/exampleForm">here</a>.</p></main></body></html>`,
      "join",
    );
    const form = got.find(
      (c) => c.fieldKey === "club.link" && (c.value as { kind: string }).kind === "application_form",
    );
    expect(form && "label" in (form.value as object)).toBe(false);
  });
  it("takes the mission sentence of an essay, nothing from a list's lead-in", () => {
    const long = `This forum is a key initiative in our mission to engage students. Our mission is to represent a diverse community. ${"We keep working on it every year. ".repeat(12)}`;
    expect(
      run(`<html><body><main><p>${long}</p></main></body></html>`, "home").find((c) => c.fieldKey === "club.mission")
        ?.value,
    ).toBe("Our mission is to represent a diverse community.");
    expect(
      run(
        `<html><body><main><p>As the only boxing club on campus, we have a unique obligation to our members. To serve them well, we aim to:</p></main></body></html>`,
      ).some((c) => c.fieldKey === "club.mission"),
    ).toBe(false);
  });
});
