import { describe, expect, it } from "vitest";
import { classifyLink } from "@hci/core";
import {
  aboutTextProblem,
  conferenceRegistrationProblem,
  joinModeProblem,
  noticeProblem,
  programApplicationProblem,
} from "../src/extract/evidence-rules";
import { extractDeterministic } from "../src/extract/deterministic";
import { groundExtraction, type LlmPage } from "../src/extract/llm/extractor";
import type { LlmExtraction } from "../src/extract/llm/schema";
import { htmlToDocument } from "../src/parse/document";
import { factProblem } from "../src/stages/facts";
import { checkLinks } from "../src/audit/checks/links";
import type { AuditClub, AuditData, AuditLink } from "../src/audit/types";

/** Student testing round 6 (2026-10-13): HMMT, HUMIC, HUQT, AIST and HUSAI. */

// Trimmed from hmmt.org/rg/nu, the tournament's team and coach registration.
const HMMT_REGISTRATION = [
  "# Register for HMMT",
  "- An accredited school's math team",
  "- A math group not affiliated with an accredited school",
  "Register a new organization",
  "Early application deadline:",
  "the deadline for submitting early applications to this tournament, including applications for the registration lottery.",
  "Confirmation deadline:",
  "the deadline for accepted applications to confirm their attendance in the tournament; accepted teams must have a minimum number of students listed on the team roster in order to be confirmed",
  "##### Remember to invite your students if they're not listed here!",
  "#### HMMT Financial Aid Application",
  "We are pleased to announce this year's financial aid application, made possible by our generous sponsors.",
  "The aid will come in the form of HMMT-sponsored hotel rooms for students and one adult chaperone, as well as waived registration fees.",
].join("\n");

const HMMT_SCAM =
  "HMMT does not partner with any organizations connected to competing teams. Any non-HMMT person or group claiming to represent HMMT is untruthful, especially if they claim to represent HMMT in a specific country. Please report all such organizations to us at [email protected].";

describe("a tournament's team registration is not how members join (HMMT)", () => {
  it("reads the registration page as one", () => {
    expect(conferenceRegistrationProblem(HMMT_REGISTRATION)?.check).toBe("conference_registration");
    expect(joinModeProblem("application", "Early application deadline:", HMMT_REGISTRATION)).not.toBeNull();
  });
  it("leaves a club page that mentions competing teams alone", () => {
    const club =
      "Our members write problems for the tournament and run it on contest day. Over 1,000 competing teams attend.";
    expect(conferenceRegistrationProblem(club)).toBeNull();
    // A page that recruits the club's own staff is not a registration page.
    expect(
      conferenceRegistrationProblem(
        `${HMMT_REGISTRATION}\nInterested in joining our staff? Staff applications are open.`,
      ),
    ).toBeNull();
  });
  it("the deterministic extractor gives no join modes from it", () => {
    const html = `<html><body><main>${HMMT_REGISTRATION.split("\n")
      .map((l) => `<p>${l.replace(/^#+\s*/, "")}</p>`)
      .join("")}</main></body></html>`;
    const doc = htmlToDocument(html, "https://hmmt.org/rg/nu");
    const claims = extractDeterministic({
      doc,
      role: "join",
      clubNames: ["Harvard-MIT Mathematics Tournament"],
      clubAcronyms: ["HMMT"],
      fetchedAt: new Date("2026-10-12T12:00:00Z"),
    } as Parameters<typeof extractDeterministic>[0]);
    expect(claims.filter((c) => c.fieldKey === "club.join_mode" || c.fieldKey.startsWith("cycle."))).toEqual([]);
  });
  it("LLM activities read off it are rejected (g23)", () => {
    const page: LlmPage = { url: "https://hmmt.org/rg/nu", role: "join", snapshotId: "s1", text: HMMT_REGISTRATION };
    const out = {
      short_description: null,
      mission: null,
      join_modes: [],
      eligible_classes: null,
      prior_experience: null,
      hours_per_week: null,
      member_count: null,
      dues: null,
      recruiting: [],
      recruiting_seasons: null,
      selectivity: [],
      activities: [
        {
          value: "Offering financial aid to accepted teams",
          quote:
            "We are pleased to announce this year's financial aid application, made possible by our generous sponsors.",
        },
      ],
      sponsors: [],
    } as LlmExtraction;
    const r = groundExtraction(out, [page], new Date("2026-10-12T12:00:00Z"));
    expect(r.claims).toEqual([]);
    expect(r.rejected.join(" ")).toContain("registration page");
  });
  it("an impostor warning with an obfuscated address is never About text", () => {
    expect(noticeProblem(HMMT_SCAM)?.why).toContain("impostors or scams");
    expect(aboutTextProblem("Questions? Reach out to us via email ([email protected]) any time.")?.why).toContain(
      "obfuscated email",
    );
    expect(noticeProblem("HMMT is one of the largest high school math competitions in the world.")).toBeNull();
    expect(
      noticeProblem(
        "Full refunds will be provided for requests received no later than two weeks prior to the start of the program.",
      )?.check,
    ).toBe("notice");
  });
});

describe("a program's applications aren't the club's (HUMIC)", () => {
  it("an incubator or project-team application is a program's", () => {
    expect(programApplicationProblem("Apply to be a member for one our Spring 2026 projects here")).not.toBeNull();
    expect(programApplicationProblem("AI Project Incubator Member Applications Deadline")).not.toBeNull();
    expect(joinModeProblem("application", "Apply to be a member for one our Spring 2026 projects here")).not.toBeNull();
  });
  it("joining applications stay", () => {
    expect(programApplicationProblem("Membership applications for intro fellows are now live!")).toBeNull();
    expect(programApplicationProblem("Apply to become a member of HUMIC by September 10.")).toBeNull();
    expect(programApplicationProblem("Our fellowship application is due Friday.")).toBeNull();
  });
});

describe("page text keeps a list item's heading apart from its paragraph (HUQT)", () => {
  it("separates block elements inside one list item", () => {
    const html = `<html><body><main><ol>
      <li><div><h3>Application Submission</h3><p>Submit your application, including your resume.</p></div></li>
      <li><div><h3>Interview Process</h3><p>Participate in a behavioral and technical interview with current members.</p></div></li>
    </ol><h2>Ready to<span> </span>Join HUQT?</h2><h2>Ready to<br>apply</h2><p>Fly<em>ing</em> high</p></main></body></html>`;
    const doc = htmlToDocument(html, "https://huqt.example/apply");
    expect(doc.text).toContain("- Application Submission Submit your application, including your resume.");
    expect(doc.text).toContain("- Interview Process Participate in a behavioral and technical interview");
    expect(doc.text).toContain("Ready to Join HUQT?");
    // Inline elements still join their words.
    expect(doc.text).toContain("Flying high");
  });
  it("editor-read stages must use the page's words, in order, for the named round", () => {
    const quote =
      "Application Submission Submit your application. - Interview Process Participate in a behavioral and technical interview with current members. Applications open in the spring.";
    const fact = (
      value: { order: number; kind: "written_application" | "interview" | "case_interview"; label: string }[],
      term = "2027-spring",
    ) => factProblem({ field: "cycle.stages", term, value, quote }, quote);
    expect(
      fact([
        { order: 1, kind: "written_application", label: "Application Submission" },
        { order: 2, kind: "interview", label: "behavioral and technical interview" },
      ]),
    ).toBeNull();
    expect(fact([{ order: 1, kind: "interview", label: "behavioral and technical interview" }], "2026-fall")).toContain(
      "fall",
    );
    expect(
      fact([
        { order: 1, kind: "interview", label: "behavioral and technical interview" },
        { order: 2, kind: "written_application", label: "Application Submission" },
      ]),
    ).toContain("in this order");
    expect(fact([{ order: 1, kind: "case_interview", label: "Interview Process" }])).toContain("case interview");
  });
});

describe("a Substack post is never the club's newsletter (AIST)", () => {
  it("classifies posts as content items, publications as newsletters", () => {
    for (const u of [
      "https://aiwhistleblowerinitiative.substack.com/p/the-ai-whistleblower-protection-act",
      "https://substack.com/@romeodean/p-161526332",
      "https://nanransohoff.substack.com/p/the-third-wave-of-american-philanthropy",
    ])
      expect(classifyLink(u)?.isContentItem, u).toBe(true);
    expect(classifyLink("https://harvardclub.substack.com")).toMatchObject({
      kind: "newsletter",
      isContentItem: false,
    });
    expect(classifyLink("https://substack.com/@harvardclub")?.isContentItem).toBe(false);
  });
  it("the deterministic extractor skips them", () => {
    const html = `<html><body><main><p>Reading list: <a href="https://nanransohoff.substack.com/p/the-third-wave">The third wave of American philanthropy</a></p>
      <p>Subscribe to <a href="https://aisst.substack.com">our newsletter</a></p></main></body></html>`;
    const doc = htmlToDocument(html, "https://aisst.example/");
    const links = extractDeterministic({
      doc,
      role: "home",
      clubNames: ["AI Safety Student Team"],
      clubAcronyms: ["AISST"],
      fetchedAt: new Date("2026-10-12T12:00:00Z"),
    } as Parameters<typeof extractDeterministic>[0])
      .filter((c) => c.fieldKey === "club.link")
      .map((c) => (c.value as { url: string }).url);
    expect(links.some((u) => u.includes("/p/"))).toBe(false);
  });
  it("the audit rejects stored ones", () => {
    const club: AuditClub = {
      id: "aist",
      slug: "ai-safety-student-team",
      name: "AI Safety Student Team",
      acronym: null,
      aliases: [],
      projectedAliases: [],
      college: true,
      affiliation: "harvard_college",
      topCategories: [],
      categories: [],
      displayedClaimIds: new Set(),
      shortDescription: null,
      joining: null,
      activityStatus: "active",
    };
    const link = (url: string): AuditLink => ({
      clubId: club.id,
      kind: "newsletter",
      url,
      normalizedUrl: url.toLowerCase(),
      handle: null,
      label: null,
      status: "unverified",
      discoveredVia: ["club_website"],
      claimIds: [url],
      pageTitle: null,
      lastFetch: null,
      lastSnapshot: null,
      formClosed: false,
    });
    const data: AuditData = {
      now: new Date("2026-10-13T12:00:00Z"),
      clubs: new Map([[club.id, club]]),
      claims: [],
      rejectedLinkClaims: [],
      rejectedDatePages: new Map(),
      links: [link("https://substack.com/@romeodean/p-161526332"), link("https://aisst.substack.com")],
      cycles: [],
      decidedPairs: new Set(),
      snapshotText: new Map(),
      categoryTop: new Map(),
      articleText: new Map(),
      dismissed: new Set(),
      formState: new Map(),
    };
    const found = checkLinks(data).filter((f) => f.check === "link.newsletter_post");
    expect(found).toHaveLength(1);
    expect(found[0]?.fix?.kind).toBe("reject_claims");
  });
});
