import { describe, expect, it } from "vitest";
import { pickLinkBar, pickQuickLinks, socialHandle, type RankableLink } from "../src/local/links";

const link = (over: Partial<RankableLink> & Pick<RankableLink, "kind" | "url">): RankableLink => ({
  handle: null,
  label: null,
  status: "verified",
  confidence: 0.95,
  ...over,
});

describe("pickLinkBar", () => {
  it("shows unconfirmed links, one per kind, best status first", () => {
    const links = [
      link({ kind: "instagram", url: "https://instagram.com/b", status: "unverified", confidence: 0.35 }),
      link({ kind: "instagram", url: "https://instagram.com/a", status: "probable", confidence: 0.7 }),
      link({ kind: "linkedin", url: "https://linkedin.com/company/x", status: "unverified", confidence: 0.35 }),
      link({ kind: "harvard_directory", url: "https://college.harvard.edu/x" }),
    ];
    const bar = pickLinkBar(links);
    expect(bar.icons.map((l) => l.url)).toEqual(["https://instagram.com/a", "https://linkedin.com/company/x"]);
    // Directory listings and the losing Instagram go to "More links".
    expect(bar.rest.map((l) => l.url)).toEqual(["https://instagram.com/b", "https://college.harvard.edu/x"]);
  });

  it("keeps two websites only when they are different sites", () => {
    const same = pickLinkBar([
      link({ kind: "website", url: "https://club.org" }),
      link({ kind: "website", url: "https://www.club.org/about", status: "probable" }),
    ]);
    expect(same.icons.map((l) => l.url)).toEqual(["https://club.org"]);
    const different = pickLinkBar([
      link({ kind: "website", url: "https://club.org" }),
      link({ kind: "website", url: "https://conference.org", status: "probable" }),
    ]);
    expect(different.icons.map((l) => l.url)).toEqual(["https://club.org", "https://conference.org"]);
  });

  it("features one application link, preferring the current cycle's and apply-like labels", () => {
    const links = [
      link({ kind: "application_page", url: "https://club.org/events", label: "Speaker series" }),
      link({ kind: "application_form", url: "https://forms.example/x", label: "Comp interest form" }),
    ];
    expect(pickLinkBar(links).apply?.url).toBe("https://forms.example/x");
    expect(pickLinkBar(links, "https://club.org/events").apply?.url).toBe("https://club.org/events");
    expect(pickLinkBar(links).rest.map((l) => l.url)).toEqual(["https://club.org/events"]);
  });

  it("prefers a generic club mailbox", () => {
    const bar = pickLinkBar([
      link({ kind: "email", url: "mailto:sg@club.org", handle: "sg@club.org" }),
      link({ kind: "email", url: "mailto:info@club.org", handle: "info@club.org" }),
    ]);
    expect(bar.icons.map((l) => l.url)).toEqual(["mailto:info@club.org"]);
  });
});

describe("pickQuickLinks / socialHandle", () => {
  it("returns the best website and Instagram, or null", () => {
    expect(
      pickQuickLinks([
        link({ kind: "instagram", url: "https://instagram.com/club", status: "unverified" }),
        link({ kind: "facebook", url: "https://facebook.com/club" }),
      ]),
    ).toEqual({ website: null, instagram: "https://instagram.com/club" });
  });

  it("derives @handles", () => {
    expect(socialHandle("https://www.instagram.com/harvardpoker/")).toBe("@harvardpoker");
    expect(socialHandle("https://www.linkedin.com/company/harvardfac", "harvardfac")).toBe("@harvardfac");
    expect(socialHandle("https://www.linkedin.com/company/harvardfac")).toBe("@harvardfac");
    expect(socialHandle("not a url")).toBeNull();
  });
});

describe("website roots", () => {
  it("links a deep page's site home page and prefers real home pages", async () => {
    const { isSiteRoot, pickQuickLinks, siteRootOf } = await import("../src/local/links");
    expect(isSiteRoot("https://hastypudding.org/")).toBe(true);
    expect(isSiteRoot("https://hastypudding.org/index.php?id=2")).toBe(false);
    expect(siteRootOf("https://kuumbasingers.org/earlyyears.php")).toBe("https://kuumbasingers.org/");
    expect(siteRootOf("https://sites.google.com/view/myclub/about")).toBe("https://sites.google.com/view/myclub/");
    const link = (url: string) => ({
      kind: "website" as const,
      url,
      handle: null,
      label: null,
      status: "unverified" as const,
      confidence: 0.5,
    });
    expect(pickQuickLinks([link("https://kuumbasingers.org/alums.php")]).website).toBe("https://kuumbasingers.org/");
  });

  // Audit regression (ADR 0033): profiles showed "sites.harvard.edu", "hbs.edu" and
  // "hcs.harvard.edu" as clubs' websites because a deep page was cut to its host.
  it("keeps a page on a shared host as it is, never its host's root", async () => {
    const { isSiteRoot, pickQuickLinks, siteRootOf } = await import("../src/local/links");
    expect(siteRootOf("https://sites.harvard.edu/stahr")).toBe("https://sites.harvard.edu/stahr");
    expect(isSiteRoot("https://hcs.harvard.edu/~seds")).toBe(true);
    expect(siteRootOf("https://2015.igem.org/Team:Harvard_BioDesign")).toBe(
      "https://2015.igem.org/Team:Harvard_BioDesign",
    );
    expect(siteRootOf("https://crimsonigem.wixsite.com/home/about")).toBe("https://crimsonigem.wixsite.com/home/");
    const { siteLabel } = await import("../src/local/links");
    expect(siteLabel("https://sites.harvard.edu/stahr")).toBe("sites.harvard.edu/stahr");
    expect(siteLabel("https://www.kuumbasingers.org/")).toBe("kuumbasingers.org");
    const site = (url: string) => ({
      kind: "website" as const,
      url,
      handle: null,
      label: null,
      status: "verified" as const,
      confidence: 0.9,
    });
    expect(
      pickQuickLinks([site("https://hbs.edu/mba/student-life/activities-government-and-clubs/student-clubs/x-club")])
        .website,
    ).toBe("https://hbs.edu/mba/student-life/activities-government-and-clubs/student-clubs/x-club");
  });
});
