import * as cheerio from "cheerio";
import { classifyLink, normalizeUrl } from "@hci/core";
import { cleanText } from "../parse/html";
import type { DiscoveredOrganization, DiscoveryAdapter, PageContent, ParsedPage } from "../types";
import { collect, listedOrg, unwrapRedirect } from "./common";

const abs = (href: string | undefined, base: string) => (href ? normalizeUrl(unwrapRedirect(href), base) : null);

/**
 * Harvard Hillel — student groups and initiatives (docs/sources/hillel-student-groups.md).
 * Each group is a tile with a modal: name (h2), a student contact (h4; personal — never
 * stored), description paragraphs, and a `p.group-social` row of the group's own links.
 */
export function parseHillelGroups(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const orgs: (DiscoveredOrganization | null)[] = [];
  $("h2.mb-1").each((i, h) => {
    const modal = $(h).closest(".container");
    const name = cleanText($(h).text());
    const description = cleanText(modal.find("p").not(".group-social").first().text());
    const links = modal
      .find("p.group-social a[href]")
      .map((_, a) => abs($(a).attr("href"), page.finalUrl))
      .get()
      .filter((u): u is string => !!u && !/^mailto:/i.test(u)); // contacts are individual students
    const website = links.find((u) => classifyLink(u)?.kind === "website") ?? links[0] ?? null;
    const org = listedOrg({
      system: "hillel-groups",
      name,
      description,
      url: website,
      categories: ["religious-spiritual"],
      tags: ["jewish life"],
      locator: { selector: "h2.mb-1", index: i },
    });
    if (org) {
      for (const u of links) {
        if (u === website) continue;
        const c = classifyLink(u);
        if (!c || c.isPersonal || c.isContentItem || c.kind === "email") continue;
        org.claims.push({
          fieldKey: "club.link",
          value: { kind: c.kind, url: c.url, ...(c.handle ? { handle: c.handle } : {}) },
          assertionKind: "stated",
          isDirect: true,
          extractionMethod: "html_parse",
          quote: u,
          locator: { selector: "p.group-social a", group: name },
        });
        org.identity.urls.push(c.url);
      }
    }
    orgs.push(org);
  });
  return collect(orgs, page, { title: cleanText($("title").text()) });
}

export const hillelAdapter: DiscoveryAdapter = {
  name: "hillel-student-groups",
  version: "1.1.0",
  description: "Harvard Hillel — student groups and initiatives",
  sourceType: "harvard_related_other",
  publisher: "Harvard Hillel",
  maxPages: 1,
  seeds: () => [
    {
      url: "https://hillel.harvard.edu/jewish-life/student-groups-initiatives/",
      sourceType: "harvard_related_other",
      title: "Student Groups and Initiatives",
      publisher: "Harvard Hillel",
    },
  ],
  parse: parseHillelGroups,
};
