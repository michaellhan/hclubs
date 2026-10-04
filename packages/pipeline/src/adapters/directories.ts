import * as cheerio from "cheerio";
import { normalizeUrl, slugify } from "@hci/core";
import { cleanText } from "../parse/html";
import type { DiscoveredOrganization, DiscoveryAdapter, PageContent, ParsedPage } from "../types";
import { collect, lastSegment, listedOrg, unwrapRedirect } from "./common";

/**
 * Directory adapters for public Harvard pages (surveyed 2026-09-30; see
 * docs/sources/*.md). Each parse() is pure and covered by fixture tests.
 */

const abs = (href: string | undefined, base: string) => (href ? normalizeUrl(unwrapRedirect(href), base) : null);

// --- SOCO club sports ---------------------------------------------------------------------------

const SOCO_CLUB_SPORTS_URL = "https://soco.college.harvard.edu/clubsports/club-sport-organizations/";

export function parseSocoClubSports(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const orgs: (DiscoveredOrganization | null)[] = [];
  $("table.table--alternate-row tbody td").each((i, td) => {
    const raw = cleanText($(td).text());
    if (!raw) return;
    // Legend: "M" = men's, "W" = women's (stated in the table header).
    const m = /^(.*?)\s+([MW])$/.exec(raw);
    const sport = m?.[1] ?? raw;
    const gender = m?.[2] === "M" ? "Men's" : m?.[2] === "W" ? "Women's" : null;
    const name = gender ? `${sport} (${gender} Club Sport)` : `${sport} (Club Sport)`;
    const org = listedOrg({
      system: "soco-club-sports",
      name,
      orgType: "club_sport",
      categories: ["athletics-recreation"],
      directoryUrl: SOCO_CLUB_SPORTS_URL,
      directoryLabel: "Harvard club sports list",
      locator: { selector: "table.table--alternate-row td", index: i, raw },
    });
    if (org) {
      org.claims.push({
        fieldKey: "club.alias",
        value: { name: raw, kind: "alternate" },
        assertionKind: "stated",
        isDirect: true,
        extractionMethod: "html_parse",
        quote: raw,
      });
      org.claims.push({
        fieldKey: "club.org_type",
        value: "club_sport",
        assertionKind: "stated",
        isDirect: true,
        extractionMethod: "html_parse",
        quote: "Club Sport Organizations",
      });
    }
    orgs.push(org);
  });
  return collect(orgs, page, { title: cleanText($("title").text()) });
}

export const socoClubSportsAdapter: DiscoveryAdapter = {
  name: "soco-club-sports",
  version: "1.0.0",
  description: "Harvard College club sports list (Student Organization Center at Hilles)",
  sourceType: "harvard_official",
  publisher: "Harvard College Student Organization Center (SOCO)",
  maxPages: 1,
  seeds: () => [
    {
      url: SOCO_CLUB_SPORTS_URL,
      sourceType: "harvard_official",
      title: "Club Sport Organizations",
      publisher: "Harvard College SOCO",
    },
  ],
  parse: parseSocoClubSports,
};

// --- SEAS-affiliated student organizations --------------------------------------------------------

const SEAS_URL = "https://seas.harvard.edu/student-organizations";

export function parseSeasStudentOrgs(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const recognized =
    /SEAS-Affiliated Student Organizations are[^.]*Harvard College student organizations registered/i.test(
      cleanText($(".office-service__summary").text()),
    );
  const orgs: (DiscoveredOrganization | null)[] = [];
  $(".office-service__summary h4 + ul > li").each((i, li) => {
    const a = $(li).find("a").first();
    orgs.push(
      listedOrg({
        system: "seas-orgs",
        name: cleanText($(li).text()),
        url: abs(a.attr("href"), page.finalUrl),
        categories: ["academic-stem"],
        tags: ["SEAS-affiliated"],
        ...(recognized ? { recognition: "recognized" as const } : {}),
        locator: { selector: ".office-service__summary h4 + ul > li", index: i },
      }),
    );
  });
  return collect(orgs, page, { title: cleanText($("title").text()) });
}

export const seasStudentOrgsAdapter: DiscoveryAdapter = {
  name: "seas-student-orgs",
  version: "1.0.0",
  description: "Harvard SEAS-affiliated student organizations",
  sourceType: "harvard_official",
  publisher: "Harvard John A. Paulson School of Engineering and Applied Sciences",
  maxPages: 1,
  seeds: () => [
    { url: SEAS_URL, sourceType: "harvard_official", title: "SEAS Student Organizations", publisher: "Harvard SEAS" },
  ],
  parse: parseSeasStudentOrgs,
};

// --- SEAS orgs by concentration -------------------------------------------------------------------

const SEAS_CONC_URL = "https://seas.harvard.edu/office-student-organizations/find-seas-affiliated-student-organization";
const CONCENTRATION_TAG: Record<string, string> = {
  "applied mathematics": "applied mathematics",
  "computer science": "computer science",
  engineering: "engineering",
};

export function parseSeasByConcentration(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const orgs: (DiscoveredOrganization | null)[] = [];
  let i = 0;
  $(".accordion-content .field-item h2").each((_, h2) => {
    const heading = cleanText($(h2).text()).toLowerCase();
    const tag = CONCENTRATION_TAG[heading] ?? heading;
    $(h2)
      .nextUntil("h2", "ul")
      .children("li")
      .each((__, li) => {
        const a = $(li).children("a").first();
        const name = cleanText(a.text()) || cleanText($(li).text()).split(/\s+-\s+/)[0] || "";
        const rest = cleanText($(li).children("span").last().text());
        // "(HUMA) - Dedicated to …" → acronym suffix belongs to the name, the rest is the description.
        const acr = /^\(([^)]+)\)/.exec(rest)?.[0] ?? "";
        const desc = rest.replace(/^\([^)]*\)\s*/, "").replace(/^[-–]\s*/, "");
        orgs.push(
          listedOrg({
            system: "seas-orgs",
            name: acr ? `${name} ${acr}` : name,
            description: desc,
            url: abs(a.attr("href"), page.finalUrl),
            categories: ["academic-stem"],
            tags: ["SEAS-affiliated", tag],
            locator: { section: heading, index: i++ },
          }),
        );
      });
  });
  // Community / project sections: name + link only.
  $(".accordion-content .field-item p a").each((_, a) => {
    if ($(a).closest("li").length) return;
    const name = cleanText($(a).text());
    if (name.length < 3 || /^(click|here|link)$/i.test(name)) return;
    orgs.push(
      listedOrg({
        system: "seas-orgs",
        name,
        url: abs($(a).attr("href"), page.finalUrl),
        categories: ["academic-stem"],
        tags: ["SEAS-affiliated"],
        locator: { section: "community/projects", index: i++ },
      }),
    );
  });
  return collect(orgs, page, { title: cleanText($("title").text()) });
}

export const seasByConcentrationAdapter: DiscoveryAdapter = {
  name: "seas-orgs-by-concentration",
  version: "1.0.0",
  description: "SEAS-affiliated student organizations grouped by concentration, with descriptions",
  sourceType: "harvard_official",
  publisher: "Harvard John A. Paulson School of Engineering and Applied Sciences",
  maxPages: 1,
  seeds: () => [
    {
      url: SEAS_CONC_URL,
      sourceType: "harvard_official",
      title: "Find a SEAS-affiliated student organization",
      publisher: "Harvard SEAS",
    },
  ],
  parse: parseSeasByConcentration,
};

// --- Institute of Politics ------------------------------------------------------------------------

const IOP_URLS = ["https://iop.harvard.edu/programs", "https://iop.harvard.edu/programs/iop-coalitions"];

export function parseIop(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const coalition = page.url.includes("coalitions");
  const orgs: (DiscoveredOrganization | null)[] = [];
  $(".text-content h4").each((i, h4) => {
    const a = $(h4).find("a").first();
    const name = cleanText($(h4).find("strong").first().text() || a.text());
    if (!name) return;
    const href = abs(a.attr("href"), "https://iop.harvard.edu/");
    orgs.push(
      listedOrg({
        system: "iop",
        key: lastSegment(href) ?? slugify(name),
        name,
        description: cleanText($(h4).next("p").text()),
        directoryUrl: href && href.includes("iop.harvard.edu") ? href : null,
        url: href && !href.includes("iop.harvard.edu") ? href : null,
        directoryLabel: "IOP program page",
        categories: ["political-advocacy"],
        tags: [coalition ? "IOP coalition" : "IOP program"],
        locator: { selector: ".text-content h4", index: i, page: coalition ? "coalitions" : "programs" },
      }),
    );
  });
  return collect(orgs, page, { title: cleanText($("title").text()) });
}

export const iopAdapter: DiscoveryAdapter = {
  name: "iop-programs",
  version: "1.0.0",
  description: "Harvard Institute of Politics student programs and coalitions",
  sourceType: "harvard_official",
  publisher: "Harvard Kennedy School Institute of Politics",
  maxPages: 2,
  seeds: () =>
    IOP_URLS.map((url) => ({
      url,
      sourceType: "harvard_official" as const,
      title: "IOP Programs",
      publisher: "Institute of Politics",
    })),
  parse: parseIop,
};

// --- CS advising: clubs ---------------------------------------------------------------------------

export function parseCsClubs(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const orgs: (DiscoveredOrganization | null)[] = [];
  $("main#R-body-inner article > ul > li").each((i, li) => {
    const p = $(li).children("p").first();
    const a = p.children("a").first();
    const name = cleanText(a.text());
    const desc = cleanText(p.text()).slice(name.length);
    orgs.push(
      listedOrg({
        system: "cs-advising",
        name,
        description: desc,
        url: abs(a.attr("href"), page.finalUrl),
        categories: ["academic-stem", "technology"],
        tags: ["computer science"],
        locator: { selector: "article > ul > li", index: i },
      }),
    );
  });
  return collect(orgs, page, { title: cleanText($("title").text()) });
}

export const csClubsAdapter: DiscoveryAdapter = {
  name: "dept-computer-science",
  version: "1.0.0",
  description: "Harvard CS advising — student clubs",
  sourceType: "harvard_official",
  publisher: "Harvard SEAS Computer Science advising",
  maxPages: 1,
  seeds: () => [
    {
      url: "https://csadvising.seas.harvard.edu/opportunities/clubs/",
      sourceType: "harvard_official",
      title: "CS clubs",
      publisher: "Harvard CS Advising",
    },
  ],
  parse: parseCsClubs,
};

// --- MCB / Neuroscience student groups -----------------------------------------------------------------

export function parseMcbNeuro(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const orgs: (DiscoveredOrganization | null)[] = [];
  const container = $('ul.accordion[data-category="groupsandevents"] .accordion__content-wrapper').first();
  const para = container.find("h3").first().next("p");
  // Entries are "<strong><a>NAME</a></strong> description<br>" — split the paragraph on <br>.
  const html = para.html() ?? "";
  html.split(/<br\s*\/?>/i).forEach((chunk, i) => {
    const $c = cheerio.load(`<div>${chunk}</div>`);
    const a = $c("a").first();
    const name = cleanText(a.text());
    if (!name) return;
    const desc = cleanText($c("div").text()).slice(name.length);
    orgs.push(
      listedOrg({
        system: "mcb-neuro",
        name,
        description: desc,
        url: abs(a.attr("href"), page.finalUrl),
        categories: ["academic-stem"],
        tags: ["neuroscience", "life sciences"],
        locator: { selector: "groupsandevents p", index: i },
      }),
    );
  });
  return collect(orgs, page, { title: cleanText($("title").text()) });
}

export const mcbNeuroAdapter: DiscoveryAdapter = {
  name: "dept-mcb-neuroscience",
  version: "1.0.0",
  description: "Harvard MCB Neuroscience — student groups",
  sourceType: "harvard_official",
  publisher: "Harvard Department of Molecular and Cellular Biology",
  maxPages: 1,
  seeds: () => [
    {
      url: "https://www.mcb.harvard.edu/undergraduate/neuroscience/student-groups-resources/",
      sourceType: "harvard_official",
      title: "Neuroscience student groups",
      publisher: "Harvard MCB",
    },
  ],
  parse: parseMcbNeuro,
};

// --- Latinx Studies: organizations ----------------------------------------------------------------------

export function parseLatinxOrgs(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const orgs: (DiscoveredOrganization | null)[] = [];
  $(".entry-content p.wp-block-paragraph").each((i, p) => {
    const strong = $(p).find("a > strong, strong > a").first();
    if (!strong.length) return;
    const a = strong.is("a") ? strong : strong.parent("a");
    const name = cleanText(strong.text());
    // Research centers and faculty/staff associations are not student organizations.
    if (/center for latin american studies|drclas|faculty|staff/i.test(name)) return;
    let next = $(p).next("p");
    while (next.length && !cleanText(next.text())) next = next.next("p");
    const href = abs(a.attr("href"), page.finalUrl);
    const hubKey = href && /\/organization\//.test(href) ? lastSegment(href) : undefined;
    orgs.push(
      listedOrg({
        system: "latinx-studies",
        ...(hubKey ? { key: hubKey } : {}),
        name,
        description: next.find("strong").length ? null : cleanText(next.text()),
        directoryUrl: href,
        directoryLabel: "Student organization page",
        categories: ["cultural-identity"],
        tags: ["latinx"],
        locator: { selector: ".entry-content p > a > strong", index: i },
      }),
    );
  });
  return collect(orgs, page, { title: cleanText($("title").text()) });
}

export const latinxAdapter: DiscoveryAdapter = {
  name: "dept-latinx-studies",
  version: "1.0.0",
  description: "Harvard Latinx Studies — student organizations",
  sourceType: "harvard_official",
  publisher: "Harvard Latinx Studies",
  maxPages: 1,
  seeds: () => [
    {
      url: "https://sites.harvard.edu/latinx/latinx-organizations/",
      sourceType: "harvard_official",
      title: "Latinx organizations",
      publisher: "Harvard Latinx Studies",
    },
  ],
  parse: parseLatinxOrgs,
};

// --- Math community groups -------------------------------------------------------------------------------

export function parseMathCommunity(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const orgs: (DiscoveredOrganization | null)[] = [];
  $(".entry-content h3")
    .first()
    .nextAll("ul.wp-block-list")
    .first()
    .children("li")
    .each((i, li) => {
      const name = cleanText($(li).children("strong").first().text());
      const text = cleanText($(li).text());
      // Only undergraduate groups (the page also lists graduate/faculty lunches).
      if (!/undergrad/i.test(text)) return;
      const desc = text.slice(name.length).replace(/^[:\s]+/, "");
      const mail = $(li).find('a[href^="mailto:"]').attr("href") ?? null;
      orgs.push(
        listedOrg({
          system: "math-community",
          name,
          description: desc,
          url: mail,
          categories: ["academic-stem"],
          tags: ["mathematics"],
          locator: { selector: ".entry-content ul li", index: i },
        }),
      );
    });
  return collect(orgs, page, { title: cleanText($("title").text()) });
}

export const mathCommunityAdapter: DiscoveryAdapter = {
  name: "dept-math-community",
  version: "1.0.0",
  description: "Harvard Mathematics community groups (undergraduate only)",
  sourceType: "harvard_official",
  publisher: "Harvard Department of Mathematics",
  maxPages: 1,
  seeds: () => [
    {
      url: "https://sites.harvard.edu/math-community/community-groups/",
      sourceType: "harvard_official",
      title: "Math community groups",
      publisher: "Harvard Mathematics",
    },
  ],
  parse: parseMathCommunity,
};

// --- Mignone Center for Career Success: student clubs -----------------------------------------------------

const MIGNONE_URL = "https://careerservices.fas.harvard.edu/organizations/?ctag[]=student-clubs";

export function parseMignone(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const orgs: (DiscoveredOrganization | null)[] = [];
  $(".post-wrapper > div.entry.type-organization").each((i, el) => {
    const a = $(el).find("h2.entry-title > a").first();
    const href = abs(a.attr("href"), page.finalUrl);
    const name = cleanText(a.text());
    if (/student organizations$/i.test(name) && /extension school|\bHES\b/i.test(name)) return; // umbrella listing, not one club
    orgs.push(
      listedOrg({
        system: "mignone",
        key: lastSegment(href) ?? $(el).attr("id") ?? slugify(name),
        name,
        description: cleanText($(el).find(".entry-summary p").first().text()),
        directoryUrl: href,
        directoryLabel: "Career center listing",
        categories: ["pre-professional"],
        // 1.0.1: a name that says Extension School / HES (not the College) names its school.
        ...(/\bExtension School\b|\bHES\b|\bExtension Student/i.test(name) ? { school: "extension" as const } : {}),
        tags: $(el)
          .find(".categories-list > span")
          .map((_, s) => cleanText($(s).text()))
          .get()
          .filter((t) => !/^student clubs/i.test(t)),
        locator: { selector: ".post-wrapper .type-organization", index: i, id: $(el).attr("id") },
      }),
    );
  });
  const next = $('a.next, a[href*="/organizations/page/"]')
    .map((_, a) => $(a).attr("href") ?? "")
    .get()
    .map((h) => abs(h, page.finalUrl))
    .filter((h): h is string => Boolean(h));
  // Follow only the page immediately after the current one.
  const current = Number(/\/page\/(\d+)/.exec(page.finalUrl)?.[1] ?? "1");
  const nextUrls = next.filter((u) => Number(/\/page\/(\d+)/.exec(u)?.[1] ?? "0") === current + 1).slice(0, 1);
  return collect(orgs, page, { title: cleanText($("title").text()), nextUrls });
}

export const mignoneAdapter: DiscoveryAdapter = {
  name: "mignone-student-clubs",
  version: "1.0.1",
  description: "Mignone Center for Career Success — student clubs and organizations",
  sourceType: "harvard_official",
  publisher: "Harvard FAS Mignone Center for Career Success",
  maxPages: 10,
  seeds: () => [
    {
      url: MIGNONE_URL,
      sourceType: "harvard_official",
      title: "Student clubs (career center)",
      publisher: "Mignone Center for Career Success",
    },
  ],
  parse: parseMignone,
};

// --- Harvard Innovation Labs: student groups --------------------------------------------------------------

export function parseInnovationLabs(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const orgs: (DiscoveredOrganization | null)[] = [];
  $("ul.ventures-landing__grid > li.resource-cards__card-wrapper").each((i, li) => {
    const a = $(li).find("a.resource-cards__card").first();
    orgs.push(
      listedOrg({
        system: "innovation-labs",
        name: cleanText($(li).find("h3.resource-cards__title").text()),
        description: cleanText($(li).find("p.resource-cards__desc").text()),
        url: abs(a.attr("href"), page.finalUrl),
        categories: ["entrepreneurship"],
        tags: [cleanText($(li).find("p.resource-cards__category").text())].filter(Boolean),
        locator: { selector: "li.resource-cards__card-wrapper", index: i },
      }),
    );
  });
  return collect(orgs, page, { title: cleanText($("title").text()) });
}

export const innovationLabsAdapter: DiscoveryAdapter = {
  name: "innovation-labs-student-groups",
  version: "1.0.0",
  description: "Harvard Innovation Labs — student clubs and groups (all schools)",
  sourceType: "harvard_official",
  publisher: "Harvard Innovation Labs",
  maxPages: 1,
  seeds: () => [
    {
      url: "https://innovationlabs.harvard.edu/resources/hub?externalResourceType=student-group",
      sourceType: "harvard_official",
      title: "Student groups",
      publisher: "Harvard Innovation Labs",
    },
  ],
  parse: parseInnovationLabs,
};
