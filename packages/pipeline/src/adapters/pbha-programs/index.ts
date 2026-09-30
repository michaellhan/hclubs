import * as cheerio from "cheerio";
import { normalizeUrl, type FieldKey } from "@hci/core";
import { cleanText } from "../../parse/html";
import type { DiscoveredOrganization, DiscoveryAdapter, ExtractedClaim, PageContent, ParsedPage } from "../../types";

/**
 * PBHA programs directory — https://www.pbha.org/programs
 *
 * Phillips Brooks House Association is Harvard's student-run public service
 * association; its program listing is the authoritative public source for its
 * student-run programs (tier 1 per CLAUDE.md §7.1). See docs/sources/pbha-programs.md
 * for robots/ToS review, structure notes, and cadence.
 *
 * Extracts only what the page directly states: program name, program page URL,
 * description excerpt, and the site's own tags. Category mapping from tags is an
 * interpretation and is recorded as `inferred`.
 */

export const PBHA_ADAPTER_NAME = "pbha-programs";
export const PBHA_ADAPTER_VERSION = "1.0.0";
const LISTING_URL = "https://www.pbha.org/programs";

/** Tags that describe schedule/format rather than the program's topic. */
const NON_TOPICAL_TAGS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "in-person",
  "in person",
  "virtual",
  "remote",
  "weekly",
]);

/** PBHA tag → our taxonomy slug. Mapping is an interpretation ⇒ claims are `inferred`. */
const TAG_CATEGORY: Record<string, string> = {
  afterschool: "mentoring-education",
  "in-school": "mentoring-education",
  "in school": "mentoring-education",
  mentoring: "mentoring-education",
  summer: "mentoring-education",
  "adult services": "adult-services",
  housing: "adult-services",
  health: "health-service",
  advocacy: "advocacy-justice",
  immigration: "advocacy-justice",
};

/** "/programs/<slug>" → slug. Tolerates the site's occasional doubled "/programs/programs/<slug>". */
function programSlug(href: string): string | null {
  const m = /^\/programs\/(?:programs\/)?([^/?#]+)\/?$/.exec(href);
  if (!m?.[1] || m[1] === "category" || m[1] === "tag") return null;
  return decodeURIComponent(m[1]).toLowerCase();
}

export function parsePbhaListing(page: PageContent): ParsedPage {
  const $ = cheerio.load(page.body);
  const warnings: string[] = [];
  const organizations: DiscoveredOrganization[] = [];
  const seen = new Set<string>();

  $("article.blog-item").each((index, el) => {
    const article = $(el);
    const titleLink = article.find("h1.blog-title a").first();
    const name = cleanText(titleLink.text());
    const href = titleLink.attr("href") ?? "";
    const slug = programSlug(href);
    if (!name || !slug) {
      warnings.push(`entry ${index}: missing name or program link`);
      return;
    }
    if (seen.has(slug)) return;
    seen.add(slug);

    const programUrl = normalizeUrl(href, page.finalUrl) ?? `https://pbha.org/programs/${slug}`;
    const description = cleanText(article.find(".blog-excerpt .blog-excerpt-wrapper p").text()) || null;
    const rawTags = article
      .find(".blog-meta-primary a.blog-categories")
      .map((_, a) => cleanText($(a).text()))
      .get()
      .filter(Boolean);
    const tags = [...new Set(rawTags.map((t) => t.toLowerCase()))];
    const locator = { selector: "article.blog-item", index, slug };

    const claim = (
      fieldKey: FieldKey,
      value: unknown,
      quote: string | undefined,
      inferred = false,
    ): ExtractedClaim => ({
      fieldKey,
      value,
      assertionKind: inferred ? "inferred" : "stated",
      isDirect: !inferred,
      extractionMethod: "html_parse",
      ...(quote ? { quote } : {}),
      locator,
    });

    const claims: ExtractedClaim[] = [
      claim("club.name", name, name),
      claim("club.link", { kind: "harvard_directory", url: programUrl, label: "PBHA program page" }, href),
      // Listing on PBHA's program directory is what makes this a public service program.
      claim("club.org_type", "public_service_program", undefined, true),
      claim("club.category", "public-service", undefined, true),
    ];
    if (description) {
      claims.push(
        description.length <= 400
          ? claim("club.short_description", description, description)
          : claim("club.long_description", description, description),
      );
    }
    for (const tag of tags) {
      if (NON_TOPICAL_TAGS.has(tag)) continue;
      claims.push(claim("club.tag", tag, tag));
      const category = TAG_CATEGORY[tag];
      if (category) claims.push(claim("club.category", category, tag, true));
    }

    organizations.push({
      externalKey: slug,
      name,
      identity: { urls: [programUrl], externalIds: [{ system: "pbha", id: slug }] },
      claims,
    });
  });

  if (organizations.length === 0) warnings.push("no program entries found — page structure may have changed");

  const nextUrls = $('a[rel="next"]')
    .map((_, a) => $(a).attr("href") ?? "")
    .get()
    .filter((href) => href.startsWith("/programs?offset="))
    .map((href) => new URL(href, page.finalUrl).toString());

  return {
    organizations,
    nextUrls: [...new Set(nextUrls)],
    title: cleanText($("title").first().text()) || null,
    warnings,
  };
}

export const pbhaProgramsAdapter: DiscoveryAdapter = {
  name: PBHA_ADAPTER_NAME,
  version: PBHA_ADAPTER_VERSION,
  description: "Phillips Brooks House Association (PBHA) public service programs directory",
  sourceType: "harvard_official",
  publisher: "Phillips Brooks House Association",
  maxPages: 10,
  seeds: () => [
    {
      url: LISTING_URL,
      sourceType: "harvard_official",
      title: "PBHA Programs",
      publisher: "Phillips Brooks House Association",
    },
  ],
  parse: parsePbhaListing,
};
