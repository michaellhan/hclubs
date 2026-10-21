import { describe, expect, it } from "vitest";
import { pickJoinPage, pickLinkBar, pickQuickLinks, socialHandle, type RankableLink } from "../src/local/links";

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

  it("drops search-matched accounts beside a verified one of the same kind", () => {
    const bar = pickLinkBar([
      link({ kind: "instagram", url: "https://instagram.com/harvardpoker", status: "unverified", confidence: 0.5 }),
      link({ kind: "instagram", url: "https://instagram.com/harvardundergradpoker" }),
      link({ kind: "linkedin", url: "https://linkedin.com/company/a", status: "probable", confidence: 0.7 }),
      link({ kind: "linkedin", url: "https://linkedin.com/company/b", status: "unverified", confidence: 0.35 }),
    ]);
    expect(bar.icons.map((l) => l.url)).toEqual([
      "https://instagram.com/harvardundergradpoker",
      "https://linkedin.com/company/a",
    ]);
    // A probable icon doesn't settle it: the other LinkedIn stays under "More links".
    expect(bar.rest.map((l) => l.url)).toEqual(["https://linkedin.com/company/b"]);
  });

  it("lists one Facebook page once, whatever address form each source used", () => {
    const bar = pickLinkBar([
      link({
        kind: "facebook",
        url: "https://www.facebook.com/p/TAMID-Group-at-Harvard-100054606782478",
        status: "unverified",
        confidence: 0.35,
      }),
      link({
        kind: "facebook",
        url: "https://www.facebook.com/p/Harvard-Undergraduate-Tamid-Chapter-100054606782478",
        status: "unverified",
        confidence: 0.35,
      }),
      link({
        kind: "facebook",
        url: "https://www.facebook.com/people/Harvard-Undergraduate-Tamid-Chapter/100054606782478",
        status: "unverified",
        confidence: 0.35,
      }),
      link({
        kind: "facebook",
        url: "https://www.facebook.com/100054606782478",
        status: "unverified",
        confidence: 0.35,
      }),
      link({
        kind: "facebook",
        url: "https://www.facebook.com/p/Another-Page-100099999999999",
        status: "unverified",
        confidence: 0.35,
      }),
    ]);
    expect(bar.icons).toHaveLength(1);
    expect(bar.rest.map((l) => l.url)).toEqual(["https://www.facebook.com/p/Another-Page-100099999999999"]);
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

  it("collapses a club's twin domains into one website", () => {
    const l = [
      link({ kind: "website", url: "https://harvardvcg.org" }),
      link({ kind: "website", url: "https://www.harvarduvcg.org/", status: "probable" }),
      link({ kind: "application_page", url: "https://harvardvcg.org/overview", label: "Comp Overview" }),
      link({ kind: "application_page", url: "https://harvarduvcg.org/overview", label: "Comp Overview" }),
    ];
    const bar = pickLinkBar(l);
    expect(bar.icons.map((x) => x.url)).toEqual(["https://harvardvcg.org"]);
    expect(bar.rest.some((x) => x.kind === "website")).toBe(false);
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

  it("never features one job's posting (HSA's instructor role, 2026-10-21)", () => {
    const jobs = ["instructor", "tour-manager", "sales-associate"].map((j) =>
      link({
        kind: "application_page",
        url: `https://work.hsa.net/jobs/${j}`,
        label: "Apply for this role",
        status: "unverified",
        confidence: 0,
      }),
    );
    expect(pickLinkBar(jobs).apply).toBeNull();
    expect(pickLinkBar(jobs).rest).toHaveLength(3);
    const general = link({
      kind: "application_page",
      url: "https://hsa.applytojob.com/apply/x/Management-Application",
      label: "Apply Now!",
    });
    expect(pickLinkBar([...jobs, general]).apply?.url).toBe(general.url);
    // One posting in a jobs folder with an ordinary label is still the club's link.
    const one = link({ kind: "application_page", url: "https://club.org/jobs/apply", label: "Apply" });
    expect(pickLinkBar([one]).apply?.url).toBe(one.url);
  });

  it("prefers a generic club mailbox", () => {
    const bar = pickLinkBar([
      link({ kind: "email", url: "mailto:sg@club.org", handle: "sg@club.org" }),
      link({ kind: "email", url: "mailto:info@club.org", handle: "info@club.org" }),
    ]);
    expect(bar.icons.map((l) => l.url)).toEqual(["mailto:info@club.org"]);
  });
});

describe("pickLinkBar with now: forms naming a round that is over (ADR 0051 amendment)", () => {
  const oct12 = new Date("2026-10-12T16:00:00Z");
  const site = link({ kind: "website", url: "https://indy.example" });
  const fallForm = link({
    kind: "application_form",
    url: "https://forms.gle/fall",
    label: "Fill out the interest form here",
    term: "2026-fall",
  });
  it("never features last round's form; it stays in More links", () => {
    const bar = pickLinkBar([site, fallForm], null, oct12);
    expect(bar.apply).toBeNull();
    expect(bar.rest.map((l) => l.url)).toEqual(["https://forms.gle/fall"]);
  });
  it("prefers the club's comp page over a stale form", () => {
    const page = link({ kind: "application_page", url: "https://indy.example/comp", label: "Comp" });
    expect(pickLinkBar([site, fallForm, page], null, oct12).apply?.url).toBe("https://indy.example/comp");
  });
  it("features it while its round may still be on, or when it is the current round's own link", () => {
    expect(pickLinkBar([site, fallForm], null, new Date("2026-09-10T16:00:00Z")).apply?.url).toBe(
      "https://forms.gle/fall",
    );
    expect(pickLinkBar([site, fallForm], "https://forms.gle/fall", oct12).apply?.url).toBe("https://forms.gle/fall");
    // Without `now` nothing changes.
    expect(pickLinkBar([site, fallForm]).apply?.url).toBe("https://forms.gle/fall");
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

describe("pickJoinPage", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const src = (url: string, lastObservedAt: string, title: string | null = null) => ({ url, title, lastObservedAt });
  it("prefers the newest comp/join page on the same site and skips old-year pages", () => {
    const sources = [
      src("https://harvardindependent.com/", "2026-10-10"),
      src("https://harvardindependent.com/join-2008", "2026-10-12"),
      src("https://harvardindependent.com/comp", "2026-10-09"),
      src("https://other.org/join", "2026-10-12"),
    ];
    expect(pickJoinPage("https://harvardindependent.com/", sources, now)).toBe("https://harvardindependent.com/comp");
    expect(pickJoinPage("https://nowhere.org/", sources, now)).toBeNull();
  });
});

describe("pickQuickLinks: interest form", () => {
  it("carries an interest-form application link", () => {
    const q = pickQuickLinks([
      link({ kind: "application_form", url: "https://forms.office.com/r/tViFu2N5zz", label: "Interest form" }),
    ]);
    expect(q.interestForm).toBe("https://forms.office.com/r/tViFu2N5zz");
  });
});
