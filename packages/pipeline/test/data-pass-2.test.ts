import { describe, expect, it } from "vitest";
import { checkContent } from "../src/audit/checks/content";
import { checkLinks } from "../src/audit/checks/links";
import { navTextProblem, outsiderLinkProblem } from "../src/extract/evidence-rules";
import { cleanLinkLabel as cleanLinkText } from "@hci/core";
import { htmlToDocument } from "../src/parse/document";
import { pressMentionProblem, redactPeople } from "../src/stages/crimson";
import type { AuditClaim, AuditClub, AuditData, AuditLink } from "../src/audit/types";

/** Regression cases from the second data pass of 2026-10-02 (profile-page UX audit). */

const NOW = new Date("2026-10-02T12:00:00Z");
const club = (name: string, slug: string): AuditClub => ({
  id: slug,
  slug,
  name,
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
});
const data = (clubs: AuditClub[], parts: Partial<AuditData> = {}): AuditData => ({
  now: NOW,
  clubs: new Map(clubs.map((c) => [c.id, c])),
  claims: [],
  rejectedLinkClaims: [],
  rejectedDatePages: new Map(),
  links: [],
  cycles: [],
  decidedPairs: new Set(),
  snapshotText: new Map(),
  categoryTop: new Map(),
  articleText: new Map(),
  dismissed: new Set(),
  ...parts,
});
const link = (c: AuditClub, url: string, label: string, kind = "application_page"): AuditLink => ({
  clubId: c.id,
  kind,
  url,
  normalizedUrl: url.toLowerCase(),
  handle: null,
  label,
  status: "unverified",
  discoveredVia: ["club_website"],
  claimIds: ["c1"],
  pageTitle: null,
  lastFetch: null,
  lastSnapshot: null,
  formClosed: false,
});

describe("link labels", () => {
  it("anchor text never includes CSS, icon classes or a builder's Folder: prefix", () => {
    const html = `<html><body><a href="/educational-partnerships"><style>#comp-kbb7ooz6 svg [data-color="1"] {fill: #951C21;}</style><svg><path/></svg></a>
      <a href="/comp"><span class="x">icon-comp Comp</span></a>
      <a href="/apply-1">Folder: Apply</a><a href="/join">Join Us</a></body></html>`;
    const doc = htmlToDocument(html, "https://club.example/");
    const text = (p: string) => doc.links.find((l) => l.url.endsWith(p))?.text;
    expect(text("/educational-partnerships")).toBe("");
    expect(text("/comp")).toBe("Comp");
    expect(text("/apply-1")).toBe("Apply");
    expect(text("/join")).toBe("Join Us");
    expect(cleanLinkText('#comp-x svg [data-color="2"] {fill: #951C21;}')).toBe("");
    expect(cleanLinkText("@UCZ4uBfFpiZ7kXZujAX_EOVw")).toBe("");
    expect(cleanLinkText("UCZ4uBfFpiZ7kXZujAX_EOVw")).toBe("");
  });
  it("audit rejects CSS labels and only reports markup labels", () => {
    const bcb = club("The Crimson: Business Board", "crimson-business-board");
    const css = link(bcb, "https://b.example/edu", '#comp-kbb7ooz6 svg [data-color="1"] {fill: #951C21;}');
    const icon = link(bcb, "https://b.example/comp", "icon-comp Comp");
    const found = checkLinks(data([bcb], { links: [css, icon] }));
    const byCheck = (c: string) => found.filter((f) => f.check === c);
    expect(byCheck("link.css_label")[0]?.fix?.kind).toBe("reject_claims");
    expect(byCheck("link.markup_label")[0]?.fix ?? null).toBeNull();
  });
});

describe("forms that are not how members join", () => {
  it("grant, declaration and board-chat links are outsider links", () => {
    for (const label of [
      "MISSING GRANT FORM",
      "SEMESTERLY GRANT APPLICATION FORM",
      "DECLARE HERE",
      "Board Chats (Zoom):",
    ])
      expect(outsiderLinkProblem(label, "https://forms.gle/x"), label).not.toBeNull();
    expect(outsiderLinkProblem("Apply to join", "https://forms.gle/x")).toBeNull();
    expect(outsiderLinkProblem("Fall 2026 Comp Sign-Up Form", "https://docs.google.com/forms/d/e/x")).toBeNull();
  });
});

describe("navigation text in descriptions", () => {
  it("flags button labels and trailing calls to action, keeps ordinary prose", () => {
    expect(navTextProblem("LEGISLATIVE ACTIVITIES Find out what goes on behind the scenes. LEARN MORE")).not.toBeNull();
    expect(navTextProblem("We host weekly dinners for members. Learn more")).not.toBeNull();
    expect(navTextProblem("Visit our website to learn more about how we work.")).toBeNull();
    expect(navTextProblem("Our mission is to advocate for the undergraduate body.")).toBeNull();
  });
  it("audit rejects a mission with nav text", () => {
    const uc = club("Harvard Undergraduate Council", "harvard-undergraduate-council");
    const claim: AuditClaim = {
      id: "m1",
      clubId: uc.id,
      fieldKey: "club.mission",
      value: "Find out what goes on behind the scenes to fulfill our mission. LEARN MORE",
      status: "active",
      assertionKind: "stated",
      termKey: null,
      firstObservedAt: NOW,
      lastObservedAt: NOW,
      createdAt: NOW,
      evidence: [],
    };
    const f = checkContent(data([uc], { claims: [claim] })).find((x) => x.check === "description.nav_text");
    expect(f?.fix?.kind).toBe("reject_claims");
  });
});

describe("press mentions", () => {
  const bb = { name: "Best Buddies", acronym: null, aliases: [] };
  const poker = { name: "Harvard Undergraduate Poker Club", acronym: null, aliases: [] };
  const datamatch = { name: "Datamatch", acronym: null, aliases: ["Harvard Datamatch"] };
  it("drops passing mentions of generic names and old rosters", () => {
    expect(
      pressMentionProblem(bb, {
        title: "Students To Receive MBTA Discounts",
        quote: "[a student], who runs the PBHA tutoring program Best Buddies.",
        publishedOn: "2003-01-06",
      }),
    ).not.toBeNull();
    expect(
      pressMentionProblem(bb, {
        title: "Individualism and Isolation",
        quote:
          "Non-profit organizations like the JED Foundation, For All Ages, Best Buddies International, and Friends For Good serve as examples.",
        publishedOn: "2026-03-24",
      }),
    ).not.toBeNull();
    expect(
      pressMentionProblem(datamatch, {
        title: "Harvard Undergraduate Association Allocates Nearly $17,000 in Funding",
        quote:
          "The Association also approved a $6,456 grant from its Social Life Team budget to Harvard Datamatch, a service that matches students.",
        publishedOn: "2022-12-05",
      }),
    ).not.toBeNull();
  });
  it("keeps the full name, a name in the headline, and 'Harvard X' leading the sentence", () => {
    expect(
      pressMentionProblem(poker, {
        title: "From the Poker Table to the Zoom Screen",
        quote: "[a student], founder and co-president of the Harvard Undergraduate Poker Club.",
        publishedOn: "2020-11-12",
      }),
    ).toBeNull();
    expect(
      pressMentionProblem(bb, { title: "Best Buddies Hosts Friendship Walk", quote: "x", publishedOn: "2012-04-01" }),
    ).toBeNull();
    expect(
      pressMentionProblem(datamatch, {
        title: "The Modern Cupid's Arrow",
        quote: "Datamatch spreads to more schools, and Harvard Datamatch helps each new location set up a team.",
        publishedOn: "2020-02-13",
      }),
    ).toBeNull();
  });
});

describe("press quotes", () => {
  it("redacts students named with an opening-quote class year", () => {
    expect(redactPeople("I spoke with Aaron Chen \u201822, president of the club.")).toBe(
      "I spoke with [a student], president of the club.",
    );
  });
});
