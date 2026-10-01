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
