import { describe, expect, it } from "vitest";
import { pathScopedRoot, sameSite } from "../src/crawl/site";
import { crawlableClubSite, directorySourceType } from "../src/stages/enrich";

const names = (name: string, acronym: string | null = null) => ({ name, acronym, aliases: [] });

/**
 * Club sites on Harvard hosts (ADR 0040 amendment, 2026-10-13): a club's own subdomain of
 * seas.harvard.edu, a club-specific harvard.edu host and a sites.harvard.edu folder are
 * crawled when verified; offices, portals and the bare shared hosts never are.
 */
describe("crawlableClubSite on Harvard hosts", () => {
  it("crawls a verified club subdomain of seas.harvard.edu", () => {
    expect(crawlableClubSite("https://hces.seas.harvard.edu", "verified")).toBe(true);
    expect(crawlableClubSite("https://photonics.seas.harvard.edu/", "verified")).toBe(true);
    // Only when a Harvard page listed it for the club.
    expect(crawlableClubSite("https://hces.seas.harvard.edu", "probable")).toBe(false);
  });

  it("never crawls SEAS itself or its office subdomains", () => {
    expect(crawlableClubSite("https://seas.harvard.edu/student-organizations", "verified")).toBe(false);
    expect(crawlableClubSite("https://www.seas.harvard.edu/office-student-organizations", "verified")).toBe(false);
    expect(crawlableClubSite("https://csadvising.seas.harvard.edu/opportunities/clubs/", "verified")).toBe(false);
    expect(crawlableClubSite("https://events.seas.harvard.edu/", "verified")).toBe(false);
  });

  it("crawls a sites.harvard.edu folder, never the bare host", () => {
    expect(crawlableClubSite("https://sites.harvard.edu/classicalclub", "verified")).toBe(true);
    expect(crawlableClubSite("https://sites.harvard.edu/foreign-policy", "verified")).toBe(true);
    expect(crawlableClubSite("https://sites.harvard.edu/stahr/", "verified")).toBe(true);
    expect(crawlableClubSite("https://sites.harvard.edu/", "verified")).toBe(false);
    expect(crawlableClubSite("https://sites.harvard.edu/stahr", "unverified")).toBe(false);
  });

  it("crawls the Wireless Club's own harvard.edu host, not office hosts", () => {
    expect(crawlableClubSite("http://w1af.harvard.edu/php/index.php", "verified")).toBe(true);
    for (const office of [
      "https://iop.harvard.edu",
      "https://hillel.harvard.edu",
      "https://dunster.harvard.edu",
      "https://college.harvard.edu/student-life",
      "https://harvard.edu",
    ])
      expect(crawlableClubSite(office, "verified")).toBe(false);
  });

  it("keeps portals and other schools' directories out", () => {
    expect(crawlableClubSite("https://thehub.college.harvard.edu/organization/x", "verified")).toBe(false);
    expect(crawlableClubSite("https://engage.sph.harvard.edu/organization/phit", "verified")).toBe(false);
    expect(crawlableClubSite("https://soco.college.harvard.edu/club_signup", "verified")).toBe(false);
    expect(crawlableClubSite("https://careerservices.fas.harvard.edu/organizations/x", "verified")).toBe(false);
    expect(crawlableClubSite("https://fap.fas.harvard.edu/", "verified")).toBe(false);
  });

  it("leaves the rules for other hosts as they were", () => {
    expect(crawlableClubSite("https://ewb.hsites.harvard.edu/home", "verified")).toBe(true);
    expect(crawlableClubSite("https://socialgood.hcs.harvard.edu", "unverified")).toBe(true);
    expect(crawlableClubSite("https://hodp.org", "probable")).toBe(true);
    expect(crawlableClubSite("https://instagram.com/x", "verified")).toBe(false);
  });

  it("doesn't change which SEAS pages the directory pass reads", () => {
    expect(directorySourceType("https://hces.seas.harvard.edu")).toBeNull();
    expect(directorySourceType("https://sites.harvard.edu/latinx/latinx-organizations/")).toBe("harvard_official");
  });
});

describe("pathScopedRoot on sites.harvard.edu", () => {
  const stahr = "https://sites.harvard.edu/stahr";
  it("scopes a folder to itself, even when the club is named in it", () => {
    expect(pathScopedRoot(stahr, names("Student Astronomers at Harvard-Radcliffe", "STAHR"))).toBe(true);
    expect(pathScopedRoot("https://sites.harvard.edu/classicalclub", names("Harvard Classical Club"))).toBe(true);
    expect(sameSite(stahr, "https://sites.harvard.edu/stahr/about/", true)).toBe(true);
    expect(sameSite(stahr, "https://sites.harvard.edu/stahr", true)).toBe(true);
    // A sibling folder or the host's root is another site.
    expect(sameSite(stahr, "https://sites.harvard.edu/latinx/latinx-organizations/", true)).toBe(false);
    expect(sameSite(stahr, "https://sites.harvard.edu/stahrgazers/", true)).toBe(false);
    expect(sameSite(stahr, "https://sites.harvard.edu/", true)).toBe(false);
  });
  it("keeps the folder from a deeper first page", () => {
    const deep = "https://sites.harvard.edu/foreign-policy/join-our-policy-program";
    expect(pathScopedRoot(deep, names("Harvard Undergraduate Foreign Policy Initiative"))).toBe(true);
    expect(sameSite(deep, "https://sites.harvard.edu/foreign-policy/about/", true)).toBe(true);
    expect(sameSite(deep, "https://sites.harvard.edu/math-community/", true)).toBe(false);
  });
  it("leaves club subdomains whole", () => {
    expect(pathScopedRoot("https://hces.seas.harvard.edu", names("Harvard College Engineering Society", "HCES"))).toBe(
      false,
    );
  });
});
