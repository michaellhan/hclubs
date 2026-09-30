import * as cheerio from "cheerio";
import type { Element } from "domhandler";

import { cleanText } from "../parse/html";
import type { DiscoveredOrganization, DiscoveryAdapter, PageContent, ParsedPage } from "../types";
import { collect, listedOrg } from "./common";

/**
 * Wikipedia lists of Harvard organizations, fetched as ordinary /wiki/ article pages
 * (Wikipedia's robots.txt disallows /w/, which includes api.php, so we don't use the API). Tier 8 ("public web"): useful for discovery breadth and
 * aliases, never authoritative — entries include historical/defunct groups, and every
 * claim from here displays as "Reported". Content is CC BY-SA 4.0; we store names and
 * short excerpts with attribution (source URL on every claim).
 */

const WIKI = "https://en.wikipedia.org/wiki/";
const LIST_PAGE = "List_of_Harvard_College_undergraduate_organizations";
const SOCIAL_PAGE = "Harvard_College_social_clubs";

const SECTION_CATEGORY: Record<string, string[]> = {
  performing_arts: ["performing-arts"],
  publications_and_media: ["publications-media"],
  service: ["public-service"],
  political: ["political-advocacy"],
  academic: ["academic-stem"],
  "pre-professional": ["pre-professional"],
  unrecognized_student_groups: [],
  recognized_student_groups: [],
};
const SUBSECTION_CATEGORY: [RegExp, string][] = [
  [/a cappella/i, "a-cappella"],
  [/dance/i, "dance"],
  [/theat(er|re)|drama/i, "theater"],
  [/orchestra|band|opera|music|choral|chorus|glee/i, "music"],
];

function htmlFromBody(body: string): string {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{")) {
    const json = JSON.parse(trimmed) as { parse?: { text?: string } };
    return json.parse?.text ?? "";
  }
  return body;
}

const NAME_CONNECTORS = new Set([
  "of",
  "the",
  "and",
  "for",
  "on",
  "in",
  "at",
  "de",
  "del",
  "la",
  "le",
  "du",
  "y",
  "&",
  "to",
  "des",
]);

/**
 * "Name, a description…" / "Name performs …" → name + description. A proper name is the
 * leading run of Capitalized tokens (plus connectors like "of", "and", "&", parenthetical
 * acronyms); it ends at the first lowercase word or comma. Heuristic, so names parsed
 * from prose carry lower confidence.
 */
export function splitWikiEntry(text: string, linkText: string | null): { name: string; description: string } {
  if (linkText && text.startsWith(linkText)) {
    return { name: linkText, description: text.slice(linkText.length).replace(/^[\s,.;:–—-]+/, "") };
  }
  const tokens = text.split(/\s+/);
  const nameTokens: string[] = [];
  for (const raw of tokens) {
    const t = raw.replace(/[,.;:]+$/, "");
    const endsClause = raw !== t;
    const isName = /^[A-Z0-9"“'(]/.test(t) || NAME_CONNECTORS.has(t) || /^[A-Z][\w’'&.-]*-[A-Za-z]/.test(t);
    if (!isName) break;
    nameTokens.push(t);
    if (endsClause) break;
  }
  while (nameTokens.length && NAME_CONNECTORS.has(nameTokens[nameTokens.length - 1] ?? "")) nameTokens.pop();
  const name = nameTokens.join(" ");
  if (name.length < 3) return { name: text.replace(/\.$/, ""), description: "" };
  return { name, description: text.slice(text.indexOf(name) + name.length).replace(/^[\s,.;:–—-]+/, "") };
}

export function parseWikipediaList(page: PageContent): ParsedPage {
  const $ = cheerio.load(htmlFromBody(page.body));
  $("sup.reference, .mw-editsection, style").remove();
  const orgs: (DiscoveredOrganization | null)[] = [];
  const isSocial =
    page.url.includes(SOCIAL_PAGE) || (/social clubs/i.test($("h2").first().text()) && !$("#Performing_arts").length);

  let section = "";
  let subsection = "";
  let index = 0;
  const root = $(".mw-parser-output").length ? $(".mw-parser-output").first() : $("body");
  const visit = (el: Element) => {
    const $el = $(el);
    // Parsoid article HTML wraps each section in <section>; recurse.
    if ($el.is("section")) {
      $el.children().each((_, c) => visit(c as Element));
      return;
    }
    if ($el.is("div.mw-heading, h2, h3")) {
      const h = $el.is("h2, h3") ? $el : $el.find("h2, h3").first();
      const id = (h.attr("id") ?? "").toLowerCase();
      if (h.is("h2")) {
        section = id;
        subsection = "";
      } else subsection = cleanText(h.text());
      return;
    }
    if ($el.is("dl")) {
      subsection = cleanText($el.find("dt").first().text()) || subsection;
      return;
    }
    if (!$el.is("ul") || $el.hasClass("gallery")) return;
    if (["references", "see_also", "external_links", "notes", "further_reading"].includes(section)) return;
    if (isSocial && section !== "list_of_clubs") return;
    $el.children("li").each((_, li) => {
      const clone = $(li).clone();
      clone.find("ul").remove();
      const text = cleanText(clone.text());
      if (!text || text.length > 600) return;
      const first = clone.children().first();
      // First meaningful node (Parsoid HTML often starts with a whitespace text node).
      const firstNode = clone
        .contents()
        .filter((_, n) => !(n.type === "text" && !(n as unknown as { data: string }).data.trim()))
        .first();
      const startsWithLink = first.is("a") && firstNode.is("a");
      const linkText = startsWithLink ? cleanText(first.text()) : null;
      const href = first.attr("href") ?? "";
      const ARTICLE = /^(?:https:\/\/en\.wikipedia\.org\/wiki\/|\/wiki\/|\.\/)([^:#?]+)$/;
      const isArticle = ARTICLE.test(href) && !first.hasClass("new") && !/redlink=1/.test(href);
      const wikiTitle = startsWithLink && isArticle ? (ARTICLE.exec(href)?.[1] ?? null) : null;
      const { name: rawName, description } = splitWikiEntry(text, linkText);
      // Social clubs list: "Name (1791)" → strip founding year.
      const noYear = rawName.replace(/\s*\((?:est\.\s*)?\d{4}\)\s*$/, "");
      // "The FDL (formerly Kappa Kappa Gamma)" → name + former-name alias.
      const formerMatch = /^(.*?)\s*\(formerly ([^)]+)\)\s*$/i.exec(noYear);
      const name = formerMatch?.[1] ?? noYear;
      const former = formerMatch?.[2] ?? null;
      const cats = isSocial
        ? ["social"]
        : [
            ...(SECTION_CATEGORY[section] ?? []),
            ...SUBSECTION_CATEGORY.filter(([re]) => re.test(subsection)).map(([, c]) => c),
          ];
      const org = listedOrg({
        system: "wikipedia",
        // Keyed by the listed name (derived, not an identity signal); article titles are real ids.
        ...(wikiTitle
          ? { extraIds: [{ system: "wikipedia-article", id: decodeURIComponent(wikiTitle).toLowerCase() }] }
          : {}),
        name,
        description: description.length >= 12 ? description : null,
        directoryUrl: wikiTitle ? `https://en.wikipedia.org/wiki/${wikiTitle}` : null,
        directoryLabel: "Wikipedia",
        categories: cats,
        ...(isSocial ? { orgType: "social_organization" as const } : {}),
        ...(section === "unrecognized_student_groups" ? { recognition: "not_recognized" as const } : {}),
        ...(section === "recognized_student_groups" ? { recognition: "recognized" as const } : {}),
        tags: subsection ? [subsection.toLowerCase()] : [],
        locator: { section, subsection, index: index++ },
        nameConfidence: linkText ? 1 : 0.8,
      });
      // The wiki article link is an encyclopedia page, not the club's own channel.
      if (org && former) {
        org.claims.push({
          fieldKey: "club.alias",
          value: { name: former, kind: "former" },
          assertionKind: "stated",
          isDirect: true,
          extractionMethod: "html_parse",
          quote: rawName,
        });
      }
      if (org) {
        org.claims = org.claims.map((c) =>
          c.fieldKey === "club.link"
            ? { ...c, value: { ...(c.value as object), kind: "other", label: "Wikipedia article" } }
            : c,
        );
        // Descriptions on Wikipedia are often historical; keep them, but as lower-weight evidence.
        org.claims = org.claims.map((c) => (c.fieldKey.endsWith("description") ? { ...c, confidenceFactor: 0.8 } : c));
      }
      orgs.push(org);
    });
  };
  if (isSocial) {
    // Clubs are laid out in a multi-column table: <p><b>Group:</b></p><ul><li>Name (year)</li></ul>.
    $("table.col-begin td").each((_, td) => {
      let group = "";
      $(td)
        .children()
        .each((__, child) => {
          if ($(child).is("p")) group = cleanText($(child).text()).replace(/:$/, "");
          if ($(child).is("ul")) {
            section = "list_of_clubs";
            subsection = group;
            visit(child as Element);
          }
        });
    });
  } else {
    root.children().each((_, el) => visit(el as Element));
  }
  return collect(orgs, page, {
    title: isSocial ? "Harvard College social clubs" : "List of Harvard College undergraduate organizations",
  });
}

export const wikipediaAdapter: DiscoveryAdapter = {
  name: "wikipedia-harvard-orgs",
  version: "1.0.0",
  description: "Wikipedia lists of Harvard College organizations (tier 8, discovery breadth only)",
  sourceType: "public_web",
  publisher: "Wikipedia (CC BY-SA 4.0)",
  maxPages: 2,
  seeds: () => [
    {
      url: `${WIKI}${LIST_PAGE}`,
      sourceType: "public_web",
      title: "Wikipedia: List of Harvard College undergraduate organizations",
      publisher: "Wikipedia",
    },
    {
      url: `${WIKI}${SOCIAL_PAGE}`,
      sourceType: "public_web",
      title: "Wikipedia: Harvard College social clubs",
      publisher: "Wikipedia",
    },
  ],
  parse: parseWikipediaList,
};
