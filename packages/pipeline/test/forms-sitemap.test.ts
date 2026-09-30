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
