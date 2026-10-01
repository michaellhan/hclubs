import { describe, expect, it } from "vitest";
import { sitemapHintUrls, sitemapLocs } from "../src/crawl/sitemap";
import { htmlToDocument } from "../src/parse/document";
import { formDescriptionDoc, isFormUrl } from "../src/parse/forms";

describe("sitemaps", () => {
  it("reads page and index sitemaps", () => {
    expect(
      sitemapLocs(
        `<urlset><url><loc>https://club.test/comp</loc></url><url><loc> https://club.test/a?x=1&amp;y=2 </loc></url></urlset>`,
      ),
    ).toEqual({ pages: ["https://club.test/comp", "https://club.test/a?x=1&y=2"], sitemaps: [] });
    expect(
      sitemapLocs(`<sitemapindex><sitemap><loc>https://club.test/page-sitemap.xml</loc></sitemap></sitemapindex>`),
    ).toEqual({
      pages: [],
      sitemaps: ["https://club.test/page-sitemap.xml"],
    });
  });
  it("keeps same-site joining/recruiting/FAQ/about pages, best first", () => {
    expect(
      sitemapHintUrls("https://club.test/", [
        "https://club.test/blog/2024/recap",
        "https://club.test/about-us",
        "https://club.test/apply",
        "https://other.test/apply",
        "https://club.test/faq",
      ]),
    ).toEqual(["https://club.test/apply", "https://club.test/faq", "https://club.test/about-us"]);
  });
});

describe("application forms", () => {
  it("recognizes form hosts", () => {
    expect(isFormUrl("https://docs.google.com/forms/d/e/abc/viewform")).toBe(true);
    expect(isFormUrl("https://forms.gle/abc")).toBe(true);
    expect(isFormUrl("https://docs.google.com/document/d/abc")).toBe(false);
    expect(isFormUrl("https://club.test/apply")).toBe(false);
  });
  it("reduces a form page to its title and public description (never its questions)", () => {
    const html = `<html><head><title>HUMG Associate Application - Google Forms</title>
      <meta property="og:title" content="HUMG Associate Application">
      <meta property="og:description" content="Thank you for your interest in HUMG!
Please fill out the form to apply. Due 9/11 by 5 PM."></head>
      <body><main><p>What is your email address?</p><p>Why do you want to join?</p></main></body></html>`;
    const doc = formDescriptionDoc(htmlToDocument(html, "https://docs.google.com/forms/d/e/x/viewform"));
    expect(doc.title).toBe("HUMG Associate Application");
    expect(doc.text).toContain("Due 9/11 by 5 PM.");
    expect(doc.text).not.toContain("Why do you want to join");
    expect(doc.links).toEqual([]);
  });
});

describe("recruiting season", () => {
  it("is mid-August to October and mid-January to February, Boston time", async () => {
    const { inRecruitingSeason } = await import("../src/crawl/site");
    expect(inRecruitingSeason(new Date("2026-09-30T16:00:00Z"))).toBe(true);
    expect(inRecruitingSeason(new Date("2026-11-15T16:00:00Z"))).toBe(false);
    expect(inRecruitingSeason(new Date("2027-02-01T16:00:00Z"))).toBe(true);
    expect(inRecruitingSeason(new Date("2027-07-01T16:00:00Z"))).toBe(false);
    // 1 a.m. UTC on Nov 1 is still Oct 31 in Boston.
    expect(inRecruitingSeason(new Date("2026-11-01T01:00:00Z"))).toBe(true);
  });
});

describe("logos", () => {
  it("prefers structured and header logos, skips university marks, banners and tiny favicons", async () => {
    const { pickLogo } = await import("../src/extract/deterministic");
    const doc = htmlToDocument(
      `<html><head><link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
       <meta property="og:image" content="https://club.test/banner-photo.jpg"></head>
       <body><header><img src="/img/harvard-shield.png" alt="Harvard shield"><img src="/img/club-logo.png" alt="HPC logo"></header>
       <main><p>Hello</p></main></body></html>`,
      "https://club.test/",
    );
    expect(pickLogo(doc.logoCandidates)?.url).toBe("https://club.test/img/club-logo.png");
    expect(pickLogo(doc.logoCandidates.filter((c) => c.kind !== "header_img"))?.url).toBe(
      "https://club.test/apple.png",
    );
    expect(pickLogo([{ url: "https://club.test/favicon.ico", kind: "icon", size: null }])).toBeNull();
    expect(pickLogo([{ url: "https://club.test/banner.jpg", kind: "og_image", size: null }])).toBeNull();
    expect(pickLogo([{ url: "https://club.test/img/sponsors/acme-logo.png", kind: "img", size: null }])).toBeNull();
    expect(
      pickLogo([
        { url: "https://static.wixstatic.com/media/x.png/v1/fill/w_32,h_32/logo.png", kind: "header_img", size: null },
      ]),
    ).toBeNull();
    // URL-encoded white variants ("White Round HCDU logo") are skipped too.
    expect(
      pickLogo([
        { url: "https://cdn.test/v1/White+Round+HCDU+logo+%283%29.png?format=1500w", kind: "img", size: null },
      ]),
    ).toBeNull();
    expect(pickLogo([{ url: "https://club.test/img/lighthouse-logo.png", kind: "img", size: null }])?.url).toBe(
      "https://club.test/img/lighthouse-logo.png",
    );
    // "Background" in a logo's file name doesn't make it a photo; a plain background image is.
    const sq = "https://images.squarespace-cdn.com/content/v1/abc";
    expect(
      pickLogo([{ url: `${sq}/Official+AADT+Logo+Black+-+Transparent+Background.png`, kind: "og_image", size: null }]),
    ).not.toBeNull();
    expect(pickLogo([{ url: "https://club.test/img/hero-background.jpg", kind: "img", size: null }])).toBeNull();
    // Squarespace serves the uploaded icon at 100px; a named logo icon counts; a bare favicon doesn't.
    expect(pickLogo([{ url: `${sq}/favicon.ico?format=100w`, kind: "icon", size: null }])).not.toBeNull();
    expect(pickLogo([{ url: "https://club.test/assets/img/logo.webp", kind: "icon", size: null }])).not.toBeNull();
    expect(pickLogo([{ url: "https://club.test/favicon.png", kind: "icon", size: null }])).toBeNull();
    // Site-builder default icons and Harvard marks with underscores in the name.
    for (const url of [
      "https://static.parastorage.com/client/pfavico.ico",
      "https://s2.wp.com/i/webclip.png?m=1713868326i",
      "https://club.weebly.com/upload/image_upload_1_Harvard_College_Signature_Horizontal_Large.jpeg",
    ])
      expect(pickLogo([{ url, kind: "apple_touch_icon", size: 180 }])).toBeNull();
    // A club site on a Harvard server may use its own images; other harvard.edu images are marks.
    const own = { url: "https://ai.hcs.harvard.edu/branding/logo.png", kind: "header_img" as const, size: null };
    expect(pickLogo([own], "https://ai.hcs.harvard.edu/")).not.toBeNull();
    expect(pickLogo([own], "https://club.test/")).toBeNull();
    expect(
      pickLogo(
        [{ url: "https://www.college.harvard.edu/logo.png", kind: "header_img", size: null }],
        "https://www.college.harvard.edu/",
      ),
    ).toBeNull();
  });
});

describe("club sport summaries", () => {
  it("states only what the club-sports list says", async () => {
    const { clubSportSummary } = await import("../src/stages/summarize");
    expect(clubSportSummary("Archery (Club Sport)")).toBe("Harvard club sports team for archery.");
    expect(clubSportSummary("Lacrosse (Women's Club Sport)")).toBe("Harvard women's club sports team for lacrosse.");
    expect(clubSportSummary("Ice Hockey (Men's Club Sport)")).toBe("Harvard men's club sports team for ice hockey.");
    expect(clubSportSummary("Harvard Poker Club")).toBeNull();
  });
});
