import { describe, expect, it } from "vitest";
import {
  classifyLink,
  dedupeUrls,
  extractDomain,
  extractInstagramHandle,
  isLinktreeUrl,
  isOwnSubdomain,
  isLinkInBioUrl,
  isSameLink,
  normalizeLinkedInUrl,
  normalizeUrl,
  withoutTrackingParams,
  isArticleUrl,
  isLegalPageUrl,
  siteKey,
  socialIdentityKey,
} from "../src";

describe("normalizeUrl", () => {
  it("canonicalizes scheme, host, trailing slash and fragment", () => {
    expect(normalizeUrl("HTTP://WWW.Example.org/About/#team")).toBe("https://example.org/About");
    expect(normalizeUrl("https://example.org/")).toBe("https://example.org");
    expect(normalizeUrl("https://example.org:443//a//b/")).toBe("https://example.org/a/b");
  });
  it("removes tracking parameters and sorts the rest", () => {
    expect(withoutTrackingParams("https://docs.google.com/forms/d/e/x/viewform?ouid=1170124238&usp=sharing")).toBe(
      "https://docs.google.com/forms/d/e/x/viewform?usp=sharing",
    );
    expect(withoutTrackingParams("https://Example.org/Join?a=1")).toBe("https://Example.org/Join?a=1");
    expect(normalizeUrl("https://docs.google.com/forms/d/e/x/viewform?ouid=1170124238&usp=sharing")).toBe(
      "https://docs.google.com/forms/d/e/x/viewform?usp=sharing",
    );
    expect(normalizeUrl("https://example.org/join?utm_source=ig&b=2&fbclid=x&a=1&igshid=abc")).toBe(
      "https://example.org/join?a=1&b=2",
    );
  });
  it("accepts scheme-less input and rejects garbage", () => {
    expect(normalizeUrl("example.org/x")).toBe("https://example.org/x");
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
  it("resolves relative URLs against a base", () => {
    expect(normalizeUrl("/programs/foo", "https://www.pbha.org/programs")).toBe("https://pbha.org/programs/foo");
  });
  it("lowercases mailto addresses", () => {
    expect(normalizeUrl("mailto:Board@Example.ORG")).toBe("mailto:board@example.org");
  });
});

describe("extractDomain / siteKey", () => {
  it("extracts bare lowercase domain", () => {
    expect(extractDomain("https://WWW.HarvardClub.org/path")).toBe("harvardclub.org");
  });
  it("uses path segments for shared hosts", () => {
    expect(siteKey("https://sites.google.com/view/myclub/home")).toBe("sites.google.com/view/myclub");
    expect(siteKey("https://www.pbha.org/programs/alzheimersbuddies")).toBe("pbha.org/programs/alzheimersbuddies");
    expect(siteKey("https://hcs.harvard.edu/~robotics/team")).toBe("hcs.harvard.edu/~robotics");
    expect(siteKey("https://myclub.org/about")).toBe("myclub.org");
  });
  it("gives no identity to generic hosts", () => {
    expect(siteKey("https://docs.google.com/forms/d/abc/viewform")).toBeNull();
    expect(siteKey("https://bit.ly/xyz")).toBeNull();
    expect(siteKey("https://sites.google.com/")).toBeNull();
  });
});

describe("Instagram", () => {
  it("extracts handles from URLs and @mentions", () => {
    expect(extractInstagramHandle("https://www.instagram.com/HarvardClub/?igshid=abc")).toBe("harvardclub");
    expect(extractInstagramHandle("instagram.com/harvard.club_1")).toBe("harvard.club_1");
    expect(extractInstagramHandle("@HarvardClub")).toBe("harvardclub");
  });
  it("ignores post and reserved paths", () => {
    expect(extractInstagramHandle("https://www.instagram.com/p/Cxyz123/")).toBeNull();
    expect(extractInstagramHandle("https://www.instagram.com/explore/tags/harvard")).toBeNull();
  });
  it("classifies posts as content items, not accounts", () => {
    expect(classifyLink("https://instagram.com/p/abc")?.isContentItem).toBe(true);
    expect(classifyLink("https://instagram.com/myclub")).toMatchObject({
      kind: "instagram",
      url: "https://www.instagram.com/myclub",
      handle: "myclub",
    });
  });
});

describe("LinkedIn", () => {
  it("normalizes company/school URLs", () => {
    expect(normalizeLinkedInUrl("https://uk.linkedin.com/company/Harvard-Club/about/?trk=x")).toEqual({
      type: "company",
      slug: "harvard-club",
      url: "https://www.linkedin.com/company/harvard-club",
    });
  });
  it("flags personal profiles so we never store them as club links", () => {
    expect(classifyLink("https://www.linkedin.com/in/some-person")?.isPersonal).toBe(true);
  });
});

describe("link-in-bio / other kinds", () => {
  it("detects Linktree and other link-in-bio hosts", () => {
    expect(isLinktreeUrl("https://linktr.ee/myclub")).toBe(true);
    expect(isLinkInBioUrl("https://beacons.ai/myclub")).toBe(true);
    expect(isLinkInBioUrl("https://myclub.carrd.co")).toBe(true);
    expect(classifyLink("https://linktr.ee/MyClub")).toMatchObject({ kind: "link_in_bio", handle: "myclub" });
  });
  it("classifies forms, mailing lists, email, x, youtube, tiktok", () => {
    expect(classifyLink("https://forms.gle/abc")?.kind).toBe("application_form");
    expect(classifyLink("https://docs.google.com/forms/d/e/xyz/viewform")?.kind).toBe("application_form");
    expect(classifyLink("https://lists.hcs.harvard.edu/mailman/listinfo/club")?.kind).toBe("mailing_list");
    expect(classifyLink("mailto:Club@Example.org")).toMatchObject({ kind: "email", handle: "club@example.org" });
    expect(classifyLink("https://twitter.com/MyClub")).toMatchObject({ kind: "x", url: "https://x.com/myclub" });
    expect(classifyLink("https://twitter.com/intent/tweet?text=hi")?.handle).toBeNull();
    expect(classifyLink("https://www.youtube.com/@MyClub")).toMatchObject({ kind: "youtube", handle: "myclub" });
    expect(classifyLink("https://www.tiktok.com/@myclub")).toMatchObject({ kind: "tiktok", handle: "myclub" });
    expect(classifyLink("https://myclub.org")?.kind).toBe("website");
  });
});

describe("duplicate detection", () => {
  it("treats equivalent social URLs as the same account", () => {
    expect(isSameLink("https://instagram.com/MyClub", "https://www.instagram.com/myclub/?hl=en")).toBe(true);
    expect(socialIdentityKey("https://x.com/myclub")).toBe("x:myclub");
    expect(isSameLink("https://twitter.com/myclub", "https://x.com/MyClub")).toBe(true);
  });
  it("treats equivalent web URLs as the same", () => {
    expect(isSameLink("http://www.myclub.org/", "https://myclub.org?utm_source=x")).toBe(true);
    expect(isSameLink("https://myclub.org/a", "https://myclub.org/b")).toBe(false);
  });
  it("dedupes a list keeping first occurrences", () => {
    expect(
      dedupeUrls([
        "https://myclub.org",
        "http://www.myclub.org/",
        "https://instagram.com/a",
        "https://www.instagram.com/A/",
      ]),
    ).toEqual(["https://myclub.org", "https://instagram.com/a"]);
  });
});

describe("Facebook page URLs (audit regression)", () => {
  it("keeps /people/<Name>/<id> pages whole instead of cutting them to /people", () => {
    const c = classifyLink("https://www.facebook.com/people/Harmony-Mentoring/100064540417581/");
    expect(c?.kind).toBe("facebook");
    expect(c?.url).toBe("https://www.facebook.com/people/Harmony-Mentoring/100064540417581");
    expect(c?.isContentItem).toBe(false);
  });
  it("treats share buttons and hashtags as not a profile", () => {
    expect(classifyLink("https://www.facebook.com/share.php?u=https://x.org")?.isContentItem).toBe(true);
    expect(classifyLink("https://www.facebook.com/hashtag/harvard")?.isContentItem).toBe(true);
    expect(classifyLink("https://www.facebook.com/people")?.isContentItem).toBe(true);
    expect(classifyLink("https://www.facebook.com/recover/initiate/")?.isContentItem).toBe(true);
    expect(classifyLink("https://www.facebook.com/p/Harvard-Futsal-Club-100083061234567/")?.url).toBe(
      "https://www.facebook.com/p/Harvard-Futsal-Club-100083061234567",
    );
  });
});

describe("isLegalPageUrl / isArticleUrl", () => {
  it("knows policy pages and posts by their path", () => {
    for (const u of [
      "https://x.example/about/privacy",
      "https://x.example/terms-of-use",
      "https://x.example/about/permissions",
    ])
      expect(isLegalPageUrl(u), u).toBe(true);
    for (const u of ["https://x.example/about", "https://x.example/join", "https://x.example/privacy-matters-club"])
      expect(isLegalPageUrl(u), u).toBe(false);
    expect(isArticleUrl("https://x.example/article/2026/10/2/story")).toBe(true);
    expect(isArticleUrl("https://x.example/about")).toBe(false);
  });
});

describe("isOwnSubdomain", () => {
  it("counts a subdomain of the club's own site, never a shared or path-scoped host's", () => {
    expect(isOwnSubdomain("https://comp.fictional.example.org/", "fictional.example.org")).toBe(true);
    expect(isOwnSubdomain("https://fictional.example.org/", "fictional.example.org")).toBe(false);
    expect(isOwnSubdomain("https://notfictional.example.org/", "fictional.example.org")).toBe(false);
    expect(isOwnSubdomain("https://apply.hbs.edu/", "hbs.edu")).toBe(false);
    // A club's own site on a school's host owns its subdomains; the school's host doesn't.
    expect(isOwnSubdomain("https://x.fictional.hcs.harvard.edu/", "fictional.hcs.harvard.edu")).toBe(true);
    expect(isOwnSubdomain("https://other.hcs.harvard.edu/", "hcs.harvard.edu")).toBe(false);
    expect(isOwnSubdomain("https://a.host.example.com/", "host.example.com/fictional")).toBe(false);
  });
});
