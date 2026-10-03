import { leadershipApplicationProblem } from "../src/extract/evidence-rules";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyPageRole, sameSite } from "../src/crawl/site";
import {
  extractDeterministic,
  extractLinks,
  pageNamesClub,
  recruitingSeasonsIn,
  type PageRole,
} from "../src/extract/deterministic";
import { htmlToDocument } from "../src/parse/document";
import type { ExtractedClaim } from "../src/types";

const dir = fileURLToPath(new URL("./fixtures/synthetic-club-site/", import.meta.url));
const FETCHED = new Date("2026-09-30T16:00:00Z");
const page = (file: string, path: string) =>
  htmlToDocument(readFileSync(dir + file, "utf8"), `https://example-robotics.test${path}`);
const extract = (file: string, path: string, role: PageRole): ExtractedClaim[] =>
  extractDeterministic({
    doc: page(file, path),
    role,
    fetchedAt: FETCHED,
    clubNames: ["Example Robotics Collective"],
    clubAcronyms: ["ERC"],
  });
const values = (claims: ExtractedClaim[], field: string) =>
  claims.filter((c) => c.fieldKey === field).map((c) => c.value);

describe("htmlToDocument", () => {
  const doc = page("home.html", "/");
  it("drops scripts, cookie banners and nav/footer chrome from text", () => {
    expect(doc.text).not.toMatch(/cookies|window\.tracking/);
    expect(doc.text).not.toMatch(/Handbook/);
    expect(doc.text).toMatch(/^# Example Robotics Collective/m);
    expect(doc.blocks.find((b) => b.text.startsWith("Applications for Fall 2026"))?.section).toBe("Get involved");
  });
  it("keeps links (including footer socials) with absolute URLs and chrome flags", () => {
    const ig = doc.links.find((l) => l.url.includes("instagram.com/examplerobotics"));
    expect(ig?.chrome).toBe(true);
    expect(doc.links.some((l) => l.url === "https://example-robotics.test/about")).toBe(true);
  });
  it("captures title and meta description", () => {
    expect(doc.title).toBe("Example Robotics Collective | Harvard");
    expect(doc.metaDescription).toMatch(/autonomous robots/);
    expect(doc.looksJsRendered).toBe(false);
  });
  it("keeps a WordPress <main> whose id is the skip link's target, but drops the skip link", () => {
    const wp = htmlToDocument(
      '<html><body><a class="skip-link screen-reader-text" href="#wp--skip-link--target">Skip to content</a>' +
        '<main id="wp--skip-link--target"><p>A co-curricular board of 23 students.</p></main></body></html>',
      "https://news.example.test/story",
    );
    expect(wp.text).toMatch(/co-curricular board/);
    expect(wp.text).not.toMatch(/Skip to content/);
  });
  it("flags empty JS app shells", () => {
    const shell = htmlToDocument(
      '<html><body><div id="root"></div><script src="a.js"></script><script></script><script></script></body></html>',
      "https://x.test/",
    );
    expect(shell.looksJsRendered).toBe(true);
  });
});

describe("page roles and site boundaries", () => {
  it("classifies pages by URL/anchor", () => {
    expect(classifyPageRole("https://club.org/")).toBe("home");
    expect(classifyPageRole("https://club.org/apply")).toBe("recruiting");
    // Applying to lead is a role, not membership (ADR 0044).
    expect(classifyPageRole("https://club.org/membership/lead-with-us")).toBe("team");
    expect(classifyPageRole("https://club.org/board-applications")).toBe("team");
    expect(classifyPageRole("https://club.org/get-involved", "Apply to Lead")).toBe("team");
    expect(classifyPageRole("https://club.org/membership")).toBe("join");
    expect(classifyPageRole("https://paper.example/about/privacy", "About")).toBe("other");
    expect(classifyPageRole("https://paper.example/about/permissions")).toBe("other");
    expect(classifyPageRole("https://club.example/about")).toBe("about");
    expect(leadershipApplicationProblem("Step 4: Apply for our Leader Training Program in the fall.")).not.toBeNull();
    expect(classifyPageRole("https://club.org/get-involved")).toBe("join");
    expect(classifyPageRole("https://club.org/our-story")).toBe("about");
    expect(classifyPageRole("https://club.org/people")).toBe("team");
    expect(classifyPageRole("https://club.org/blog/post-1")).toBe("other");
  });
  it("stays inside the site (including shared hosts)", () => {
    expect(sameSite("https://club.org/", "https://www.club.org/about")).toBe(true);
    expect(sameSite("https://club.org/", "https://other.org/")).toBe(false);
    expect(sameSite("https://sites.google.com/view/myclub/home", "https://sites.google.com/view/myclub/join")).toBe(
      true,
    );
    expect(sameSite("https://sites.google.com/view/myclub/home", "https://sites.google.com/view/otherclub")).toBe(
      false,
    );
  });
  it("recognizes the club on its own page", () => {
    expect(pageNamesClub(page("home.html", "/"), ["Example Robotics Collective"], [])).toBe(
      "Example Robotics Collective | Harvard",
    );
    expect(pageNamesClub(page("home.html", "/"), ["Some Other Club"], ["SOC"])).toBeNull();
  });
});

describe("deterministic extraction", () => {
  const home = extract("home.html", "/", "home");
  const join = extract("join.html", "/join", "join");
  const about = extract("about.html", "/about", "about");
  const team = extract("team.html", "/team", "team");

  it("keeps the club's own socials and role email; drops institutional accounts, personal profiles and personal email", () => {
    const links = values(home, "club.link") as { kind: string; url: string }[];
    expect(links).toContainEqual(
      expect.objectContaining({ kind: "instagram", url: "https://www.instagram.com/examplerobotics" }),
    );
    expect(links).toContainEqual(expect.objectContaining({ kind: "linkedin" }));
    expect(links).toContainEqual(expect.objectContaining({ kind: "email", url: "mailto:board@examplerobotics.test" }));
    expect(links.some((l) => l.url.includes("instagram.com/harvard"))).toBe(false);
    expect(links.some((l) => l.url.includes("/in/"))).toBe(false);
    expect(links.some((l) => l.url.includes("jane_student"))).toBe(false);
    expect(links).toContainEqual(expect.objectContaining({ kind: "application_page" }));
  });

  it("extracts description and mission, never a personal bio", () => {
    expect(values(home, "club.short_description")[0]).toMatch(
      /^Example Robotics Collective is a Harvard undergraduate team/,
    );
    expect(String(values(home, "club.mission")[0])).toMatch(/Our mission is/);
    expect(values(team, "club.long_description")).toEqual([]);
    expect(JSON.stringify(team)).not.toMatch(/Dunster/);
  });

  it("extracts recruiting dates with the fetch date as the only reference", () => {
    const deadlines = join.filter((c) => c.fieldKey === "cycle.deadline");
    expect(deadlines).toHaveLength(1); // the stale spring 2024 deadline is ignored
    expect(deadlines[0]).toMatchObject({ cycleTermKey: "2026-fall", value: { at: "2026-10-03", precision: "date" } });
    expect(join.find((c) => c.fieldKey === "cycle.opens_at")?.value).toMatchObject({ at: "2026-09-01" });
    const homeDeadline = home.find((c) => c.fieldKey === "cycle.deadline");
    expect(homeDeadline?.value).toMatchObject({
      at: "2026-10-03T23:59:00-04:00",
      precision: "datetime",
      parseConfidence: "high",
    });
    expect(join.find((c) => c.fieldKey === "cycle.application_url")?.value).toBe(
      "https://forms.gle/exampleRoboticsApply",
    );
    expect(join.filter((c) => c.fieldKey === "cycle.process_type").map((c) => c.value)).toContain("application");
  });

  it("never takes a paragraph about the application as the club's mission", () => {
    const html = `<html><body><h1>Example Consulting Group</h1>
      <p>The process begins with a written portion. Here, we aim to get a sense of your motivations for applying to Example Consulting Group, and your strengths.</p>
      <p>Example Consulting Group's mission is to help local nonprofits with pro bono strategy projects.</p></body></html>`;
    const got = extractDeterministic({
      doc: htmlToDocument(html, "https://example-consulting.test/about"),
      role: "about",
      fetchedAt: FETCHED,
      clubNames: ["Example Consulting Group"],
      clubAcronyms: [],
    });
    expect(got.filter((c) => c.fieldKey === "club.mission").map((c) => c.value)).toEqual([
      "Example Consulting Group's mission is to help local nonprofits with pro bono strategy projects.",
    ]);
  });

  it("never reads a results date as the date applications open", () => {
    const html = `<html><body><h1>Example Pre-Health Conference</h1><h2>Application timeline</h2>
      <p>Application Opens: November 1, 2026 @12:00 AM ET</p>
      <p>Application Deadline: November 10, 2026 @11:59 PM ET</p>
      <p>Decision Released: November 16, 2026 @5:00 PM ET</p></body></html>`;
    const got = extractDeterministic({
      doc: htmlToDocument(html, "https://example-prehealth.test/apply"),
      role: "join",
      fetchedAt: FETCHED,
      clubNames: ["Example Pre-Health Conference"],
      clubAcronyms: [],
    });
    const opens = got.filter((c) => c.fieldKey === "cycle.opens_at").map((c) => (c.value as { at: string }).at);
    expect(opens).toEqual(["2026-11-01T00:00:00-04:00"]);
  });

  it("takes a timeline entry's own date, not the next entry's (1.12.0)", () => {
    const got = extractDeterministic({
      doc: htmlToDocument(
        "<html><body><h1>Comp</h1><p>Plan ahead. 9/11: Applications Due @ 5 PM 9/13-9/15: Interviews 9/18 Decisions + Welcome</p></body></html>",
        "https://example-marketing.test/comp-portal",
      ),
      role: "join",
      fetchedAt: new Date("2026-09-30T16:00:00Z"),
      clubNames: ["Example Marketing Group"],
      clubAcronyms: [],
    });
    const due = got.filter((c) => c.fieldKey === "cycle.deadline").map((c) => (c.value as { at: string }).at);
    expect(due).toEqual(["2026-09-11T17:00:00-04:00"]);
  });

  it("a deadline takes no time from a later date's meeting or a range's end (1.16.8)", () => {
    const run = (p: string) =>
      extractDeterministic({
        doc: htmlToDocument(`<html><body><h1>Comp</h1><p>${p}</p></body></html>`, "https://example-club.test/comp"),
        role: "join",
        fetchedAt: new Date("2026-09-30T16:00:00Z"),
        clubNames: ["Example Club"],
        clubAcronyms: [],
      })
        .filter((c) => c.fieldKey === "cycle.deadline")
        .map((c) => (c.value as { at: string }).at);
    expect(
      run(
        "The deadline to comp is EOD Friday 10/2/2026, and the first meeting is Saturday 10/3/2026, 3-4pm in Boylston.",
      ),
    ).toEqual(["2026-10-02"]);
    expect(run("Applications are due October 2, 2026 at 5-7pm.")).toEqual(["2026-10-02T17:00:00-04:00"]);
  });

  it("never reads an open mic, a renewal or a team-selection date as recruiting (1.12.0)", () => {
    const run = (p: string) =>
      extractDeterministic({
        doc: htmlToDocument(`<html><body><h1>Apply</h1><p>${p}</p></body></html>`, "https://example-club.test/apply"),
        role: "join",
        fetchedAt: new Date("2026-09-30T16:00:00Z"),
        clubNames: ["Example Club"],
        clubAcronyms: [],
      }).filter((c) => c.fieldKey === "cycle.deadline" || c.fieldKey === "cycle.opens_at");
    expect(run("Applications open with our Open Mic: Friday, September 11th, 8-10pm.")).toEqual([]);
    expect(run("Membership renewal: early renewal begins April 1 for applicants.")).toEqual([]);
    expect(run("Applications are reviewed and by Sep 22 technical teams are selected for projects.")).toEqual([]);
  });

  it("takes the first-round deadline, never a later round's or a priority one (1.13.0)", () => {
    const run = (body: string) =>
      extractDeterministic({
        doc: htmlToDocument(`<html><body><h1>Comp</h1>${body}</body></html>`, "https://example-board.test/comp-portal"),
        role: "join",
        fetchedAt: new Date("2026-09-30T16:00:00Z"),
        clubNames: ["Example Board"],
        clubAcronyms: [],
      })
        .filter((c) => c.fieldKey === "cycle.deadline")
        .map((c) => (c.value as { at: string }).at);
    // From a real comp page: label and date on separate lines; round two is for those who passed.
    expect(
      run(
        "<h3>First Round Application Due</h3><h3>Thursday, September 10th</h3><p>Applications are due at 11:59 PM on the 10th.</p>" +
          "<h2>Second Round Applications Due Thursday, September 24th</h2><p>Second Round Applications are due at 11:59PM on the 24th.</p>",
      ),
    ).toEqual(["2026-09-10"]);
    expect(
      run(
        "<p>Priority Deadline: 11:59 pm on September 12th, 2026</p><p>General Deadline: 11:59 pm on September 16th, 2026</p>",
      ),
    ).toEqual(["2026-09-16T23:59:00-04:00"]);
  });

  it("never takes accounts linked in a news post or sponsors page as the club's (1.13.1)", () => {
    const run = (url: string, role: PageRole) =>
      extractDeterministic({
        doc: htmlToDocument(
          `<html><body><main><h1>No Varsity, No Problem</h1><p>Follow <a href="https://www.instagram.com/examplesquash">the squash team</a> and <a href="https://www.instagram.com/examplepolo">polo</a>.</p></main></body></html>`,
          url,
        ),
        role,
        fetchedAt: FETCHED,
        clubNames: ["Example Independent"],
        clubAcronyms: [],
      }).filter((c) => c.fieldKey === "club.link");
    expect(run("https://example-independent.test/no-varsity-no-problem", "other")).toEqual([]);
    expect(run("https://example-independent.test/sponsors", "sponsors")).toEqual([]);
    expect(run("https://example-independent.test/", "home").length).toBe(2);
  });

  it("keeps the club's own forms in a page body, not an event's or a program's (1.13.5)", () => {
    const run = (url: string, role: PageRole, label = "Individual Application") =>
      extractDeterministic({
        doc: htmlToDocument(
          `<html><body><main><h1>Volunteer</h1><p><a href="https://docs.google.com/forms/d/e/abc/viewform">${label}</a></p></main></body></html>`,
          url,
        ),
        role,
        fetchedAt: FETCHED,
        clubNames: ["Example Shelter"],
        clubAcronyms: [],
      }).filter((c) => c.fieldKey === "club.link");
    expect(run("https://example-shelter.test/volunteer", "other").length).toBe(1);
    expect(run("https://example-shelter.test/events", "events", "Sign up now")).toEqual([]);
    expect(run("https://example-shelter.test/endorsement", "other", "2026 Endorsement Application")).toEqual([]);
  });

  it("reads a former name the club states for itself (1.14.0)", () => {
    const run = (p: string, role: PageRole = "about") =>
      extractDeterministic({
        doc: htmlToDocument(
          `<html><body><h1>About</h1><p>${p}</p></body></html>`,
          "https://example-review.test/who-we-are",
        ),
        role,
        fetchedAt: FETCHED,
        clubNames: ["Example Undergraduate Law Review"],
        clubAcronyms: ["EULR"],
      })
        .filter((c) => c.fieldKey === "club.alias")
        .map((c) => (c.value as { name: string }).name);
    expect(
      run(
        "Established in 2005, the Example Undergraduate Law Review (EULR) (formerly known as the Example College Law Review) is a student-run organization.",
      ),
    ).toEqual(["Example College Law Review"]);
    expect(run("We were formerly known as the Example Speech and Debate Society (ESDS).")).toEqual([
      "Example Speech and Debate Society",
      "ESDS",
    ]);
    // Not about the club, or not on its own identity pages.
    expect(run("Students discussed X, formerly known as Twitter, and free speech.")).toEqual([]);
    expect(run("We were formerly known as the Example Speech Society.", "events")).toEqual([]);
  });

  it("closes an audition window on its last listed day (1.13.0)", () => {
    const got = extractDeterministic({
      doc: htmlToDocument(
        "<html><body><h1>Auditions</h1><p>FALL 2026 Auditions for the Example Singers will take place: Saturday September 5, 12:30-2:30PM | Farkas Hall Sunday, September 6, 2:30-10:30PM | Memorial Hall 029</p></body></html>",
        "https://example-singers.test/auditions",
      ),
      role: "join",
      fetchedAt: new Date("2026-09-30T16:00:00Z"),
      clubNames: ["Example Singers"],
      clubAcronyms: [],
    });
    const dates = (k: string) => got.filter((c) => c.fieldKey === k).map((c) => (c.value as { at: string }).at);
    expect(dates("cycle.opens_at")).toEqual(["2026-09-05"]);
    expect(dates("cycle.deadline")).toEqual(["2026-09-06"]);
  });

  it("reads both ends of a stated process window (1.9.0)", () => {
    const got = extractDeterministic({
      doc: htmlToDocument(
        "<html><body><h1>Comp</h1><p>For Fall 2026, our completion-based comp will run from Sep. 14 to Sep. 22.</p></body></html>",
        "https://example-magazine.test/comp",
      ),
      role: "join",
      fetchedAt: new Date("2026-09-30T16:00:00Z"),
      clubNames: ["Example Magazine"],
      clubAcronyms: [],
    });
    const dates = (k: string) => got.filter((c) => c.fieldKey === k).map((c) => (c.value as { at: string }).at);
    expect(dates("cycle.opens_at")).toEqual(["2026-09-14"]);
    expect(dates("cycle.deadline")).toEqual(["2026-09-22"]);
  });

  it("never reads an application for outsiders (scholarships, contests, delegates) as recruiting", () => {
    const run = (body: string, url = "https://example-mc.test/apply") =>
      extractDeterministic({
        doc: htmlToDocument(`<html><body>${body}</body></html>`, url),
        role: "join",
        fetchedAt: FETCHED,
        clubNames: ["Example Model Congress"],
        clubAcronyms: [],
      }).filter((c) => c.fieldKey === "cycle.deadline" || c.fieldKey === "cycle.opens_at");
    // From real pages: a conference's scholarship, a high-school essay contest, attendee rounds.
    expect(run("<h1>Full scholarship</h1><p>Full Scholarship Applications are due on October 8th, 2026.</p>")).toEqual(
      [],
    );
    expect(
      run(`<h1>Legal Essay Contest</h1><p>A writing competition for high school students in grades 9–12.</p>
        <ul><li>Eligibility High school students, grades 9–12</li><li>Deadline October 2, 2026</li></ul>`),
    ).toEqual([]);
    expect(
      run(`<h1>Welcome to WPC 2027</h1><h2>Round 1 Applications</h2><ul><li>Application Opens: August 1, 2026</li>
        <li>Application Closes: October 31, 2026 @11:59 PM ET</li><li>Conference Attendance Fee: $90</li></ul>`),
    ).toEqual([]);
    // A conference that also recruits its own staff keeps the staff deadline.
    expect(
      run(`<h1>Join our staff</h1><p>We host 3,000 delegates each spring.</p>
        <p>Staff applications are due October 10, 2026.</p>`).map((c) => (c.value as { at: string }).at),
    ).toEqual(["2026-10-10"]);
  });

  it("attaches selectivity numbers only when a term is explicit", () => {
    expect(join.find((c) => c.fieldKey === "cycle.applicants")).toMatchObject({
      value: 180,
      cycleTermKey: "2025-fall",
    });
    expect(join.find((c) => c.fieldKey === "cycle.admits")).toMatchObject({ value: 30, cycleTermKey: "2025-fall" });
    // "Last year we received 180 applicants for about 30 spots." has no explicit term → nothing.
    expect(home.some((c) => c.fieldKey === "cycle.applicants")).toBe(false);
    // Qualitative language is preserved verbatim, never converted to a number.
    expect(values(join, "club.self_described_selectivity")[0]).toMatch(/highly competitive/);
  });

  it("extracts commitment, size, eligibility and dues", () => {
    expect(values(join, "club.hours_per_week")[0]).toEqual({ min: 6, max: 8 });
    expect(values(join, "club.freshmen_eligible")).toEqual([true]);
    expect(values(home, "club.member_count")[0]).toEqual({ kind: "range", min: 60, max: null });
    expect(values(team, "club.member_count")[0]).toEqual({ kind: "exact", count: 64 });
    expect(values(about, "club.eligible_classes")[0]).toEqual(["first_year", "sophomore", "junior", "senior"]);
    expect(values(about, "club.dues")[0]).toMatchObject({ hasDues: false });
    expect(values(about, "club.join_mode")).toContain("open");
  });

  it("extracts sponsors only from a sponsors page", () => {
    expect(values(extract("sponsors.html", "/sponsors", "sponsors"), "club.sponsor")).toEqual([
      "Acme Motors",
      "Widget Labs",
    ]);
    expect(values(home, "club.sponsor")).toEqual([]);
  });

  it("every claim carries a verbatim quote and a locator", () => {
    for (const c of [...home, ...join, ...about]) {
      expect(c.quote).toBeTruthy();
      expect(c.locator?.url).toMatch(/^https:\/\/example-robotics\.test/);
    }
  });

  it("on a directory's page about the club, emits the club's website only when clearly identified", () => {
    const html = `<html><body><header><a href="https://www.instagram.com/pbha">PBHA</a></header><main>
      <h1>Example Tutors</h1><p>Example Tutors runs weekly tutoring for local students.</p>
      <p><a href="https://exampletutors.org">exampletutors.org</a> · <a href="https://www.instagram.com/exampletutors">Instagram</a>
      · <a href="https://some-news-site.com/story">Press</a> · <a href="https://harvard.edu">Harvard</a>
      · <a href="https://another.org">Official website</a></p></main></body></html>`;
    const doc = htmlToDocument(html, "https://www.pbha.org/programs/exampletutors");
    const claims = extractDeterministic({
      doc,
      role: "about",
      fetchedAt: FETCHED,
      clubNames: ["Example Tutors"],
      clubAcronyms: [],
      directoryPage: true,
    });
    const links = values(claims, "club.link") as { kind: string; url: string }[];
    expect(links).toContainEqual(expect.objectContaining({ kind: "website", url: "https://exampletutors.org" })); // name token in domain
    expect(links).toContainEqual(expect.objectContaining({ kind: "website", url: "https://another.org" })); // labeled "Official website"
    expect(links).toContainEqual(
      expect.objectContaining({ kind: "instagram", url: "https://www.instagram.com/exampletutors" }),
    );
    expect(links.some((l) => l.url.includes("some-news-site") || l.url.includes("harvard.edu"))).toBe(false);
    expect(links.some((l) => l.url.includes("instagram.com/pbha"))).toBe(false); // the directory's own account
  });

  it("on directory pages, takes the website from an infobox 'Website' row (Wikipedia style) and nothing else", () => {
    const html = `<html><body><main>
      <table class="infobox"><tbody>
        <tr><th>Founded</th><td>1946</td></tr>
        <tr><th>Website</th><td><a class="external" href="http://www.kroks.example">www.kroks.example</a></td></tr>
      </tbody></table>
      <p>The Krokodiloes are an a cappella group.</p>
      <ol class="references"><li><a href="https://unrelated-blog.example/kroks-review">"Review"</a></li></ol>
    </main></body></html>`;
    const claims = extractLinks({
      doc: htmlToDocument(html, "https://en.wikipedia.org/wiki/The_Harvard_Krokodiloes"),
      role: "about",
      fetchedAt: FETCHED,
      clubNames: ["The Harvard Krokodiloes"],
      clubAcronyms: [],
      directoryPage: true,
    });
    const links = values(claims, "club.link") as { kind: string; url: string }[];
    expect(links).toEqual([expect.objectContaining({ kind: "website", url: "https://kroks.example" })]);
    expect(claims[0]?.quote).toBe("Website: www.kroks.example");
  });

  it("on directory pages, rejects the directory's own boilerplate but keeps a description that names the club", () => {
    const html = `<html><body><main><h1>Chinatown Afterschool</h1>
      <p>The Mignone Center for Career Success (MCS) is committed to ensuring access to a broad range of information. The inclusion of external content does not necessarily constitute endorsement.</p>
      <p>Chinatown Afterschool (CHAP) was founded in 1984 to meet the need for affordable, safe afterschool care for children in Boston's Chinatown.</p>
      </main></body></html>`;
    const doc = htmlToDocument(html, "https://www.pbha.org/programs/chap");
    const claims = extractDeterministic({
      doc,
      role: "about",
      fetchedAt: FETCHED,
      clubNames: ["Chinatown Afterschool Program (CHAP)"],
      clubAcronyms: [],
      directoryPage: true,
    });
    const descs = values(claims, "club.long_description") as string[];
    expect(descs).toHaveLength(1);
    expect(descs[0]).toMatch(/^Chinatown Afterschool \(CHAP\) was founded/);
  });

  it("skips subscription pitches, prices and founder notes as the club's About text", () => {
    const html = `<html><body><main><h1>The Example Lampoon</h1>
      <p>Your subscription supports The Example Lampoon, the oldest humor magazine in the state, and keeps our presses running. Direct inquiries to us.</p>
      <p>The Example Lampoon camp costs $140 for the first child and $120 for each additional sibling, with preference for returning campers.</p>
      <p>Three years ago, I co-founded The Example Lampoon with a classmate ’23 because we wanted a place for students to write humor together.</p>
      <p>The Example Lampoon is an undergraduate humor magazine that publishes five issues a year and welcomes writers and artists through a fall comp.</p>
      </main></body></html>`;
    const claims = extractDeterministic({
      doc: htmlToDocument(html, "https://lampoon.example/"),
      role: "home",
      fetchedAt: FETCHED,
      clubNames: ["The Example Lampoon"],
      clubAcronyms: [],
    });
    expect(values(claims, "club.long_description")).toEqual([
      expect.stringMatching(/^The Example Lampoon is an undergraduate humor magazine/),
    ]);
  });
});

describe("recruitingSeasonsIn", () => {
  it("reads recurring recruiting terms", () => {
    expect(recruitingSeasonsIn("We recruit new members every fall and spring.")).toEqual(["fall", "spring"]);
    expect(recruitingSeasonsIn("Our comp runs at the beginning of each semester.")).toEqual(["fall", "spring"]);
    expect(recruitingSeasonsIn("Applications open in the fall for first-years.")).toEqual(["fall"]);
    expect(recruitingSeasonsIn("We hold fall and spring comps.")).toEqual(["fall", "spring"]);
    expect(recruitingSeasonsIn("We accept applications on a rolling basis.")).toEqual(["rolling"]);
  });
  it("ignores single instances and sentences that aren't about joining", () => {
    expect(recruitingSeasonsIn("Applications for Fall 2026 are due September 12.")).toEqual([]);
    expect(recruitingSeasonsIn("We apply this fall's lessons to our work.")).toEqual([]);
    expect(recruitingSeasonsIn("Our concert is every spring in Sanders Theatre.")).toEqual([]);
  });
});

describe("posts and policy pages are not the club's own evidence (1.16.14)", () => {
  const FETCHED = new Date("2026-09-10T15:00:00Z");
  const run = (url: string, body: string, role: "about" | "other" = "about") =>
    extractDeterministic({
      doc: htmlToDocument(`<html><body><main>${body}</main></body></html>`, url),
      role,
      fetchedAt: FETCHED,
      clubNames: ["The Fictional Gazette"],
      clubAcronyms: [],
    });
  const follow = '<p>Follow <a href="https://www.instagram.com/fictionalgazette">The Fictional Gazette</a>.</p>';

  it("takes no links from a post, but still reads its recruiting dates", () => {
    const claims = run(
      "https://gazette.example/article/2026/9/1/comp-opens",
      `<h1>Comp opens</h1>${follow}<p>Applications for the Fictional Gazette fall comp are due September 20, 2026.</p>`,
    );
    expect(claims.filter((c) => c.fieldKey === "club.link")).toEqual([]);
    expect(claims.some((c) => c.fieldKey === "cycle.deadline")).toBe(true);
  });

  it("takes nothing from a privacy or permissions page", () => {
    for (const path of ["/about/privacy", "/about/permissions", "/terms-of-use"])
      expect(
        run(
          `https://gazette.example${path}`,
          `<h1>Policy</h1>${follow}<p>The Fictional Gazette welcomes all students.</p>`,
        ),
      ).toEqual([]);
  });

  it("still takes links from the club's about page", () => {
    expect(run("https://gazette.example/about", follow).some((c) => c.fieldKey === "club.link")).toBe(true);
  });
});
